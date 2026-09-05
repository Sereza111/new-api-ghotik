package service

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// BillingSession — 统一计费会话
// ---------------------------------------------------------------------------

// BillingSession 封装单次请求的预扣费/结算/退款生命周期。
// 实现 relaycommon.BillingSettler 接口。
type BillingSession struct {
	relayInfo        *relaycommon.RelayInfo
	funding          FundingSource
	preConsumedQuota int  // 实际预扣额度（信任用户可能为 0）
	tokenConsumed    int  // 令牌额度实际扣减量
	extraReserved    int  // 发送前补充预扣的额度（订阅退款时需要单独回滚）
	trusted          bool // 是否命中信任额度旁路
	fullBalanceHeld  bool // finite raw-token request reserved the complete token balance
	fundingSettled   bool // funding.Settle 已成功，资金来源已提交
	settled          bool // Settle 全部完成（资金 + 令牌）
	refunded         bool // Refund 已调用
	refundInFlight   bool // synchronous reseller refund is being persisted
	tokenTargetGone  bool // ordinary raw-token key was deleted while this request was in flight
	mu               sync.Mutex
	operationID      string
}

func (s *BillingSession) tokenOperationID(phase string) string {
	if strings.TrimSpace(s.operationID) == "" {
		s.operationID = common.NewRequestId()
	}
	return s.operationID + ":" + phase
}

// Settle 根据实际消耗额度进行结算。
// Raw-token allocations are adjusted before their monetary funding source.
// This ordering keeps a failed token mutation from committing a wallet charge;
// the durable operation marker makes a successful raw adjustment safe to retry.
func (s *BillingSession) Settle(actualQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settled {
		return nil
	}
	if s.refundInFlight {
		return errors.New("billing refund is in progress")
	}
	isReseller := isResellerBilling(s.relayInfo)
	tracksRaw := tracksRawTokenQuota(s.relayInfo)
	tokenActualQuota := actualQuota
	if usesRawTokenQuota(s.relayInfo) && !isReseller {
		if !tracksRaw {
			// Unlimited raw-token keys retain the ordinary monetary billing
			// semantics and never mutate the token-key counters.
			tokenActualQuota = 0
		} else if s.relayInfo.TokenQuotaActual == nil {
			// Missing raw usage must fail closed. Keeping the complete reservation
			// prevents a priced settlement value from being interpreted as tokens.
			tokenActualQuota = s.tokenConsumed
			common.SysLog(fmt.Sprintf("raw token quota settlement missing usage (userId=%d, tokenId=%d)",
				s.relayInfo.UserId, s.relayInfo.TokenId))
		} else {
			tokenActualQuota = *s.relayInfo.TokenQuotaActual
		}
	}
	if s.fullBalanceHeld && tokenActualQuota > s.tokenConsumed {
		// A prepaid generation request holds the complete allocation before it
		// reaches an upstream provider. If the provider reports more usage than
		// the allocation, consume the held balance without creating debt or
		// turning a successful request into a full refund.
		tokenActualQuota = s.tokenConsumed
	}
	fundingDelta := actualQuota - s.preConsumedQuota
	tokenDelta := tokenActualQuota - s.tokenConsumed
	if fundingDelta == 0 && tokenDelta == 0 {
		s.settled = true
		return nil
	}

	// A finite raw-token reservation is a hard cap. Apply its idempotent
	// settlement before wallet/subscription funding so a token lookup or SQL
	// failure cannot leave a committed monetary charge with no way to refund the
	// allocation. Once the adjustment succeeds, retain the measured amount in
	// tokenConsumed; this is the amount that must be credited if funding fails
	// afterward.
	rawTokenAdjusted := false
	if tracksRaw && !s.relayInfo.IsPlayground && tokenDelta != 0 {
		var tokenErr error
		if !s.tokenTargetGone {
			if isReseller {
				tokenErr = model.ApplyResellerTokenQuotaAdjustment(
					s.relayInfo.TokenId,
					s.relayInfo.TokenKey,
					-tokenDelta,
					s.tokenOperationID("settle"),
				)
			} else {
				tokenErr = model.ApplyTokenQuotaAdjustmentOnce(
					s.relayInfo.TokenId,
					s.relayInfo.TokenKey,
					-tokenDelta,
					s.tokenOperationID("settle"),
				)
			}
		}
		if !isReseller && errors.Is(tokenErr, model.ErrTokenQuotaTargetNotFound) {
			// Deleting an ordinary key also discards its remaining raw allocation.
			// There is no token balance left to reconcile, but the independent
			// wallet/subscription charge must still be settled to actual usage.
			s.tokenTargetGone = true
			tokenErr = nil
			common.SysLog(fmt.Sprintf("raw token quota target disappeared during settlement (userId=%d, tokenId=%d); continuing funding settlement",
				s.relayInfo.UserId, s.relayInfo.TokenId))
		}
		if tokenErr != nil {
			common.SysLog(fmt.Sprintf("error adjusting raw token quota during settlement (userId=%d, tokenId=%d, delta=%d): %s",
				s.relayInfo.UserId, s.relayInfo.TokenId, tokenDelta, tokenErr.Error()))
			return tokenErr
		}
		rawTokenAdjusted = true
		s.tokenConsumed = tokenActualQuota
		s.fullBalanceHeld = false
		s.syncRelayInfo()
	}

	// 1) 调整资金来源（仅在尚未提交时执行，防止重复调用）
	if !s.fundingSettled {
		if err := s.funding.Settle(fundingDelta); err != nil {
			return err
		}
		// Reseller funding is a no-op; defer the marker until the token
		// adjustment succeeds so a failed SQL settlement remains refundable.
		if !isReseller {
			s.fundingSettled = true
		}
	}
	// 2) 调整令牌额度。 Raw finite keys were handled above; retain the
	// historical funding-first ordering for ordinary money keys and for paths
	// that do not have a hard raw allocation to mutate.
	var tokenErr error
	if !rawTokenAdjusted && !s.relayInfo.IsPlayground {
		if isReseller {
			if tracksRaw && tokenDelta != 0 {
				tokenErr = model.ApplyResellerTokenQuotaAdjustment(
					s.relayInfo.TokenId,
					s.relayInfo.TokenKey,
					-tokenDelta,
					s.tokenOperationID("settle"),
				)
			}
		} else if usesRawTokenQuota(s.relayInfo) {
			if tracksRaw && tokenDelta != 0 {
				tokenErr = model.ApplyTokenQuotaAdjustmentOnce(
					s.relayInfo.TokenId,
					s.relayInfo.TokenKey,
					-tokenDelta,
					s.tokenOperationID("settle"),
				)
			}
		} else if tokenDelta > 0 {
			tokenErr = model.DecreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, tokenDelta)
		} else if tokenDelta < 0 {
			tokenErr = model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, -tokenDelta)
		}
		if tokenErr != nil {
			common.SysLog(fmt.Sprintf("error adjusting token quota after funding settlement (userId=%d, tokenId=%d, delta=%d): %s",
				s.relayInfo.UserId, s.relayInfo.TokenId, tokenDelta, tokenErr.Error()))
			return tokenErr
		}
	}
	s.fundingSettled = true
	// 3) 更新 relayInfo 上的订阅 PostDelta（用于日志）
	if s.funding.Source() == BillingSourceSubscription {
		s.relayInfo.SubscriptionPostDelta += int64(fundingDelta)
	}
	s.settled = true
	return nil
}

// Refund 退还所有预扣费，幂等安全。
//
// Wallet/subscription refunds retain their historical asynchronous behavior
// for money-denominated keys. Raw-token reservations are credited
// synchronously and idempotently before their funding is refunded so a
// transient or ambiguous database error cannot consume the full allocation.
func (s *BillingSession) Refund(c *gin.Context) {
	s.mu.Lock()
	if s.settled || s.refunded || s.refundInFlight || !s.needsRefundLocked() {
		s.mu.Unlock()
		return
	}
	isReseller := isResellerBilling(s.relayInfo)
	isRawTokenQuota := usesRawTokenQuota(s.relayInfo)
	if isRawTokenQuota {
		s.refundInFlight = true
	}
	s.refunded = !isRawTokenQuota

	// Copy values while holding the session lock.  The reseller path executes
	// the credit before releasing the in-flight marker; the other paths hand
	// them to the existing asynchronous worker.
	userID := s.relayInfo.UserId
	tokenConsumed := s.tokenConsumed
	fundingSource := s.funding.Source()
	tokenId := s.relayInfo.TokenId
	tokenKey := s.relayInfo.TokenKey
	isPlayground := s.relayInfo.IsPlayground
	extraReserved := s.extraReserved
	subscriptionId := s.relayInfo.SubscriptionId
	funding := s.funding
	tokenTargetGone := s.tokenTargetGone
	refundOperationID := ""
	if isRawTokenQuota {
		refundOperationID = s.tokenOperationID("refund")
	}
	s.mu.Unlock()

	logger.LogInfo(c, fmt.Sprintf("用户 %d 请求失败, 返还预扣费（token_quota=%s, funding=%s）",
		userID,
		logger.FormatQuota(tokenConsumed),
		fundingSource,
	))

	if isRawTokenQuota {
		var refundErr error
		if tokenConsumed > 0 && !isPlayground && tracksRawTokenQuota(s.relayInfo) && !tokenTargetGone {
			if isReseller {
				refundErr = model.ApplyResellerTokenQuotaAdjustment(tokenId, tokenKey, tokenConsumed, refundOperationID)
			} else {
				refundErr = model.ApplyTokenQuotaAdjustmentOnce(tokenId, tokenKey, tokenConsumed, refundOperationID)
			}
		}
		if !isReseller && errors.Is(refundErr, model.ErrTokenQuotaTargetNotFound) {
			// The deleted key's raw allocation no longer exists. Treat that part of
			// the refund as complete so it cannot strand the independent funding
			// precharge. Other database errors remain retryable.
			s.mu.Lock()
			s.tokenTargetGone = true
			s.mu.Unlock()
			refundErr = nil
			common.SysLog(fmt.Sprintf("raw token quota target disappeared during refund (userId=%d, tokenId=%d); continuing funding refund",
				userID, tokenId))
		}
		if refundErr != nil {
			s.mu.Lock()
			s.refundInFlight = false
			s.mu.Unlock()
			common.SysLog("error refunding raw token quota: " + refundErr.Error())
			return
		}
		s.mu.Lock()
		s.tokenConsumed = 0
		s.mu.Unlock()

		if !isReseller {
			if refundErr = funding.Refund(); refundErr == nil && extraReserved > 0 &&
				funding.Source() == BillingSourceSubscription && subscriptionId > 0 {
				refundErr = model.PostConsumeUserSubscriptionDelta(subscriptionId, -int64(extraReserved))
				if refundErr == nil {
					s.mu.Lock()
					s.extraReserved = 0
					s.mu.Unlock()
				}
			}
			if refundErr != nil {
				s.mu.Lock()
				s.refundInFlight = false
				s.mu.Unlock()
				common.SysLog("error refunding raw token funding source: " + refundErr.Error())
				return
			}
		}

		s.mu.Lock()
		s.refundInFlight = false
		s.refunded = true
		s.mu.Unlock()
		return
	}

	gopool.Go(func() {
		// 1) 退还资金来源
		if err := funding.Refund(); err != nil {
			common.SysLog("error refunding billing source: " + err.Error())
		}
		if extraReserved > 0 && funding.Source() == BillingSourceSubscription && subscriptionId > 0 {
			if err := model.PostConsumeUserSubscriptionDelta(subscriptionId, -int64(extraReserved)); err != nil {
				common.SysLog("error refunding subscription extra reserved quota: " + err.Error())
			}
		}
		// 2) 退还令牌额度
		if tokenConsumed > 0 && !isPlayground {
			if err := model.IncreaseTokenQuota(tokenId, tokenKey, tokenConsumed); err != nil {
				common.SysLog("error refunding token quota: " + err.Error())
			}
		}
	})
}

// NeedsRefund 返回是否存在需要退还的预扣状态。
func (s *BillingSession) NeedsRefund() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.needsRefundLocked()
}

func (s *BillingSession) needsRefundLocked() bool {
	if s.settled || s.refunded || s.fundingSettled {
		// fundingSettled 时资金来源已提交结算，不能再退预扣费
		return false
	}
	if s.tokenConsumed > 0 {
		return true
	}
	if wallet, ok := s.funding.(*WalletFunding); ok && wallet.consumed > 0 {
		return true
	}
	if s.extraReserved > 0 {
		return true
	}
	// 订阅可能在 tokenConsumed=0 时仍预扣了额度
	if sub, ok := s.funding.(*SubscriptionFunding); ok && sub.preConsumed > 0 {
		return true
	}
	return false
}

// GetPreConsumedQuota 返回实际预扣的额度。
func (s *BillingSession) GetPreConsumedQuota() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.preConsumedQuota
}

func (s *BillingSession) hasFullBalanceReservation() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fullBalanceHeld
}

func (s *BillingSession) Reserve(targetQuota int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.settled || s.refunded || s.trusted || targetQuota <= s.preConsumedQuota {
		return nil
	}

	delta := targetQuota - s.preConsumedQuota
	if delta <= 0 {
		return nil
	}

	if err := s.reserveFunding(delta); err != nil {
		return err
	}
	tokenDelta := delta
	if usesRawTokenQuota(s.relayInfo) {
		// Raw-token quota is reserved independently during initial pre-consume.
		// Tiered pricing may increase the monetary funding estimate without
		// changing the raw token reservation.
		tokenDelta = 0
	}
	if tokenDelta > 0 {
		if err := s.reserveToken(tokenDelta); err != nil {
			s.rollbackFundingReserve(delta)
			return err
		}
	}

	s.preConsumedQuota += delta
	s.tokenConsumed += tokenDelta
	s.extraReserved += delta
	s.syncRelayInfo()
	return nil
}

// ---------------------------------------------------------------------------
// PreConsume — 统一预扣费入口（含信任额度旁路）
// ---------------------------------------------------------------------------

// preConsume 执行预扣费：信任检查 -> 令牌预扣 -> 资金来源预扣。
// 任一步骤失败时原子回滚已完成的步骤。
func (s *BillingSession) preConsume(c *gin.Context, quota int) *types.NewAPIError {
	effectiveFundingQuota := quota

	// ---- 信任额度旁路 ----
	if s.shouldTrust(c) {
		s.trusted = true
		effectiveFundingQuota = 0
		logger.LogInfo(c, fmt.Sprintf("用户 %d 额度充足, 信任且不需要预扣费 (funding=%s)", s.relayInfo.UserId, s.funding.Source()))
	} else if effectiveFundingQuota > 0 {
		logger.LogInfo(c, fmt.Sprintf("用户 %d 需要预扣费 %s (funding=%s)", s.relayInfo.UserId, logger.FormatQuota(effectiveFundingQuota), s.funding.Source()))
	}
	tokenQuota := effectiveFundingQuota
	if usesRawTokenQuota(s.relayInfo) {
		tokenQuota = s.relayInfo.TokenQuotaPreConsumed
		if tokenQuota == 0 && isResellerBilling(s.relayInfo) && tracksRawTokenQuota(s.relayInfo) {
			tokenQuota = quota
		}
	}

	// ---- 1) 预扣令牌额度 ----
	if tokenQuota > 0 {
		if err := s.reserveToken(tokenQuota); err != nil {
			if apiErr, ok := err.(*types.NewAPIError); ok {
				return apiErr
			}
			return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		s.tokenConsumed = tokenQuota
	}

	// ---- 2) 预扣资金来源 ----
	if err := s.funding.PreConsume(effectiveFundingQuota); err != nil {
		// 预扣费失败，回滚令牌额度
		if s.tokenConsumed > 0 && !s.relayInfo.IsPlayground && tracksRawTokenQuota(s.relayInfo) {
			var rollbackErr error
			if tracksRawTokenQuota(s.relayInfo) && !isResellerBilling(s.relayInfo) {
				rollbackErr = model.ApplyTokenQuotaAdjustmentOnce(
					s.relayInfo.TokenId,
					s.relayInfo.TokenKey,
					s.tokenConsumed,
					s.tokenOperationID("preconsume_rollback"),
				)
			} else {
				rollbackErr = model.IncreaseTokenQuota(s.relayInfo.TokenId, s.relayInfo.TokenKey, s.tokenConsumed)
			}
			if rollbackErr != nil {
				common.SysLog(fmt.Sprintf("error rolling back token quota (userId=%d, tokenId=%d, amount=%d, fundingErr=%s): %s",
					s.relayInfo.UserId, s.relayInfo.TokenId, s.tokenConsumed, err.Error(), rollbackErr.Error()))
			}
			s.tokenConsumed = 0
		}
		// TODO: model 层应定义哨兵错误（如 ErrNoActiveSubscription），用 errors.Is 替代字符串匹配
		if errors.Is(err, ErrInsufficientWalletQuota) {
			userQuota, quotaErr := model.GetUserQuota(s.relayInfo.UserId, false)
			if quotaErr != nil {
				userQuota = 0
			}
			return types.NewErrorWithStatusCode(
				fmt.Errorf("用户额度不足, 剩余额度: %s", logger.FormatQuota(userQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		errMsg := err.Error()
		if strings.Contains(errMsg, "no active subscription") || strings.Contains(errMsg, "subscription quota insufficient") {
			return types.NewErrorWithStatusCode(fmt.Errorf("订阅额度不足或未配置订阅: %s", errMsg), types.ErrorCodeInsufficientUserQuota, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}

	s.preConsumedQuota = effectiveFundingQuota

	// ---- 同步 RelayInfo 兼容字段 ----
	s.syncRelayInfo()

	return nil
}

func (s *BillingSession) reserveFunding(delta int) error {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		// 与结算补扣（SettleBilling 正差额 → WalletFunding.Settle）语义一致：
		// 全额无条件扣减，余额不足的部分记为欠费（余额可为负），不中断请求，
		// 保证日志记录的预扣额度与用户余额的实际变动始终对账一致。
		// DecreaseUserQuota 仅在数据库错误时失败。
		if err := model.DecreaseUserQuota(funding.userId, delta, false); err != nil {
			return types.NewError(err, types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
		}
		funding.consumed += delta
		return nil
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, int64(delta)); err != nil {
			return types.NewErrorWithStatusCode(
				fmt.Errorf("订阅额度不足或未配置订阅: %s", err.Error()),
				types.ErrorCodeInsufficientUserQuota,
				http.StatusForbidden,
				types.ErrOptionWithSkipRetry(),
				types.ErrOptionWithNoRecordErrorLog(),
			)
		}
		return nil
	case *PrepaidTokenFunding:
		return nil
	default:
		return types.NewError(fmt.Errorf("unsupported funding source: %s", s.funding.Source()), types.ErrorCodeUpdateDataError, types.ErrOptionWithSkipRetry())
	}
}

func (s *BillingSession) rollbackFundingReserve(delta int) {
	switch funding := s.funding.(type) {
	case *WalletFunding:
		if err := model.IncreaseUserQuota(funding.userId, delta, false); err != nil {
			common.SysLog("error rolling back wallet funding reserve: " + err.Error())
		} else {
			funding.consumed -= delta
		}
	case *SubscriptionFunding:
		if err := model.PostConsumeUserSubscriptionDelta(funding.subscriptionId, -int64(delta)); err != nil {
			common.SysLog("error rolling back subscription funding reserve: " + err.Error())
		}
	case *PrepaidTokenFunding:
		return
	}
}

func (s *BillingSession) reserveToken(delta int) error {
	if delta <= 0 || s.relayInfo.IsPlayground {
		return nil
	}
	var err error
	if tracksRawTokenQuota(s.relayInfo) && !isResellerBilling(s.relayInfo) {
		err = model.ApplyTokenQuotaAdjustmentOnce(
			s.relayInfo.TokenId,
			s.relayInfo.TokenKey,
			-delta,
			s.tokenOperationID("reserve"),
		)
	} else {
		err = PreConsumeTokenQuota(s.relayInfo, delta)
	}
	if err != nil {
		return types.NewErrorWithStatusCode(err, types.ErrorCodePreConsumeTokenQuotaFailed, http.StatusForbidden, types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
	}
	return nil
}

// shouldTrust 统一信任额度检查，适用于钱包和订阅。
func (s *BillingSession) shouldTrust(c *gin.Context) bool {
	// 异步任务（ForcePreConsume=true）必须预扣全额，不允许信任旁路
	if s.relayInfo.ForcePreConsume {
		return false
	}

	trustQuota := common.GetTrustQuota()
	if trustQuota <= 0 {
		return false
	}

	// 检查令牌是否充足
	tokenTrusted := s.relayInfo.TokenUnlimited
	if !tokenTrusted {
		tokenQuota := c.GetInt("token_quota")
		tokenTrusted = tokenQuota > trustQuota
	}
	if !tokenTrusted {
		return false
	}

	switch s.funding.Source() {
	case BillingSourceWallet:
		return s.relayInfo.UserQuota > trustQuota
	case BillingSourceSubscription:
		// 订阅不能启用信任旁路。原因：
		// 1. PreConsumeUserSubscription 要求 amount>0 来创建预扣记录并锁定订阅
		// 2. SubscriptionFunding.PreConsume 忽略参数，始终用 s.amount 预扣
		// 3. 若信任旁路将 effectiveQuota 设为 0，会导致 preConsumedQuota 与实际订阅预扣不一致
		return false
	default:
		return false
	}
}

// syncRelayInfo 将 BillingSession 的状态同步到 RelayInfo 的兼容字段上。
func (s *BillingSession) syncRelayInfo() {
	info := s.relayInfo
	info.FinalPreConsumedQuota = s.preConsumedQuota
	info.TokenQuotaPreConsumed = s.tokenConsumed
	info.BillingSource = s.funding.Source()

	if sub, ok := s.funding.(*SubscriptionFunding); ok {
		info.SubscriptionId = sub.subscriptionId
		info.SubscriptionPreConsumed = sub.preConsumed + int64(s.extraReserved)
		info.SubscriptionPostDelta = 0
		info.SubscriptionAmountTotal = sub.AmountTotal
		info.SubscriptionAmountUsedAfterPreConsume = sub.AmountUsedAfter + int64(s.extraReserved)
		info.SubscriptionPlanId = sub.PlanId
		info.SubscriptionPlanTitle = sub.PlanTitle
	} else {
		info.SubscriptionId = 0
		info.SubscriptionPreConsumed = 0
	}
}

// ---------------------------------------------------------------------------
// NewBillingSession 工厂 — 根据计费偏好创建会话并处理回退
// ---------------------------------------------------------------------------

// NewBillingSession 根据用户计费偏好创建 BillingSession，处理 subscription_first / wallet_first 的回退。
func NewBillingSession(c *gin.Context, relayInfo *relaycommon.RelayInfo, preConsumedQuota int) (*BillingSession, *types.NewAPIError) {
	if relayInfo == nil {
		return nil, types.NewError(fmt.Errorf("relayInfo is nil"), types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry())
	}

	if model.IsResellerTokenKey(relayInfo.TokenKey) {
		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &PrepaidTokenFunding{},
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	pref := common.NormalizeBillingPreference(relayInfo.UserSetting.BillingPreference)

	// 钱包路径需要先检查用户额度
	tryWallet := func() (*BillingSession, *types.NewAPIError) {
		userQuota, err := model.GetUserQuota(relayInfo.UserId, false)
		if err != nil {
			return nil, types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if preConsumedQuota > 0 && userQuota <= 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("用户额度不足, 剩余额度: %s", logger.FormatQuota(userQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		if userQuota-preConsumedQuota < 0 {
			return nil, types.NewErrorWithStatusCode(
				fmt.Errorf("预扣费额度失败, 用户剩余额度: %s, 需要预扣费额度: %s", logger.FormatQuota(userQuota), logger.FormatQuota(preConsumedQuota)),
				types.ErrorCodeInsufficientUserQuota, http.StatusForbidden,
				types.ErrOptionWithSkipRetry(), types.ErrOptionWithNoRecordErrorLog())
		}
		relayInfo.UserQuota = userQuota

		session := &BillingSession{
			relayInfo: relayInfo,
			funding:   &WalletFunding{userId: relayInfo.UserId},
		}
		if apiErr := session.preConsume(c, preConsumedQuota); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	trySubscription := func() (*BillingSession, *types.NewAPIError) {
		subConsume := int64(preConsumedQuota)
		if subConsume <= 0 {
			subConsume = 1
		}
		session := &BillingSession{
			relayInfo: relayInfo,
			funding: &SubscriptionFunding{
				requestId: relayInfo.RequestId,
				userId:    relayInfo.UserId,
				modelName: relayInfo.OriginModelName,
				amount:    subConsume,
			},
		}
		// 必须传 subConsume 而非 preConsumedQuota，保证 SubscriptionFunding.amount、
		// preConsume 参数和 FinalPreConsumedQuota 三者一致，避免订阅多扣费。
		if apiErr := session.preConsume(c, int(subConsume)); apiErr != nil {
			return nil, apiErr
		}
		return session, nil
	}

	// A free model still needs a BillingSession to enforce raw token quota, but
	// it must not create a synthetic one-unit subscription charge.
	if usesRawTokenQuota(relayInfo) && !isResellerBilling(relayInfo) && preConsumedQuota == 0 {
		return tryWallet()
	}

	switch pref {
	case "subscription_only":
		return trySubscription()
	case "wallet_only":
		return tryWallet()
	case "wallet_first":
		session, err := tryWallet()
		if err != nil {
			if err.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				return trySubscription()
			}
			return nil, err
		}
		return session, nil
	case "subscription_first":
		fallthrough
	default:
		hasSub, subCheckErr := model.HasActiveUserSubscription(relayInfo.UserId)
		if subCheckErr != nil {
			return nil, types.NewError(subCheckErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		if !hasSub {
			return tryWallet()
		}
		session, apiErr := trySubscription()
		if apiErr != nil {
			if apiErr.GetErrorCode() == types.ErrorCodeInsufficientUserQuota {
				// 仅当用户的活跃订阅允许钱包回退时才回退到钱包，否则返回订阅额度不足错误
				allowOverflow, overflowErr := model.UserActiveSubscriptionsAllowWalletOverflow(relayInfo.UserId)
				if overflowErr != nil {
					return nil, types.NewError(overflowErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
				}
				if allowOverflow {
					return tryWallet()
				}
				return nil, apiErr
			}
			return nil, apiErr
		}
		return session, nil
	}
}
