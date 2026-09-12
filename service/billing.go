package service

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
)

const (
	BillingSourceWallet       = "wallet"
	BillingSourceSubscription = "subscription"
	BillingSourceReseller     = "reseller_prepaid"
)

// PreConsumeBilling 根据用户计费偏好创建 BillingSession 并执行预扣费。
// 会话存储在 relayInfo.Billing 上，供后续 Settle / Refund 使用。
func PreConsumeBilling(c *gin.Context, preConsumedQuota int, relayInfo *relaycommon.RelayInfo) *types.NewAPIError {
	if relayInfo != nil && relayInfo.QuotaClamp != nil {
		return types.NewErrorWithStatusCode(
			relayInfo.QuotaClamp,
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}
	if preConsumedQuota < 0 {
		return types.NewErrorWithStatusCode(
			fmt.Errorf("pre-consume quota cannot be negative: %d", preConsumedQuota),
			types.ErrorCodeModelPriceError,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}

	fullBalanceHeld := false
	if usesRawTokenQuota(relayInfo) {
		estimatedPromptTokens := relayInfo.GetEstimatePromptTokens()
		if estimatedPromptTokens < common.PreConsumedQuota {
			estimatedPromptTokens = common.PreConsumedQuota
		}
		var clamp *common.QuotaClamp
		rawPreConsumedQuota, clamp := resellerTokenQuota(
			estimatedPromptTokens,
			relayInfo.GetEstimateCompletionTokens(),
		)
		noteQuotaClamp(relayInfo, clamp)
		if clamp != nil {
			return types.NewErrorWithStatusCode(
				clamp,
				types.ErrorCodeModelPriceError,
				http.StatusBadRequest,
				types.ErrOptionWithSkipRetry(),
			)
		}

		// The context snapshot may be stale. Read the current allocation directly
		// from SQL before making a hard-cap reservation.
		if relayInfo.TokenId <= 0 || relayInfo.UserId <= 0 {
			return types.NewError(model.ErrTokenInvalid, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		var currentToken *model.Token
		var tokenErr error
		if isResellerImageRequest(relayInfo) {
			resellerKey, lookupErr := model.GetUserResellerKeyByTokenID(relayInfo.UserId, relayInfo.TokenId)
			tokenErr = lookupErr
			if lookupErr == nil {
				currentToken = &resellerKey.Token
				relayInfo.ResellerBaseCostPerMillion = resellerKey.Metadata.BaseCostPerMillion
			}
		} else {
			currentToken, tokenErr = model.GetTokenByIds(relayInfo.TokenId, relayInfo.UserId)
		}
		if tokenErr != nil {
			return types.NewError(tokenErr, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		}
		quotaErr := model.ErrTokenQuotaInsufficient
		if isResellerBilling(relayInfo) {
			quotaErr = model.ErrResellerTokenQuotaInsufficient
		}
		if currentToken.Key != strings.TrimPrefix(relayInfo.TokenKey, "sk-") || !currentToken.UsesTokenQuota() {
			return types.NewErrorWithStatusCode(
				quotaErr,
				types.ErrorCodePreConsumeTokenQuotaFailed,
				http.StatusForbidden,
				types.ErrOptionWithSkipRetry(),
				types.ErrOptionWithNoRecordErrorLog(),
			)
		}
		relayInfo.TokenUnlimited = currentToken.UnlimitedQuota
		if currentToken.UnlimitedQuota {
			if isResellerBilling(relayInfo) {
				// Prepaid reseller allocations are finite by construction. Refuse
				// malformed legacy rows instead of silently turning them into an
				// unmetered reseller key.
				return types.NewErrorWithStatusCode(
					quotaErr,
					types.ErrorCodePreConsumeTokenQuotaFailed,
					http.StatusForbidden,
					types.ErrOptionWithSkipRetry(),
					types.ErrOptionWithNoRecordErrorLog(),
				)
			}
			// Unlimited raw-token keys do not reserve or mutate the token-key
			// counters. Their monetary usage is still settled normally below.
			rawPreConsumedQuota = 0
		} else {
			if currentToken.RemainQuota <= 0 {
				return types.NewErrorWithStatusCode(
					quotaErr,
					types.ErrorCodePreConsumeTokenQuotaFailed,
					http.StatusForbidden,
					types.ErrOptionWithSkipRetry(),
					types.ErrOptionWithNoRecordErrorLog(),
				)
			}
			if isResellerBilling(relayInfo) {
				var requestErr error
				if isResellerImageRequest(relayInfo) {
					if !relayInfo.PriceData.UsePrice {
						requestErr = errResellerFixedPriceRequired
					} else {
						rawPreConsumedQuota, clamp, requestErr = resellerFixedPriceTokenQuota(
							preConsumedQuota,
							relayInfo.ResellerBaseCostPerMillion,
						)
					}
				} else {
					rawPreConsumedQuota, clamp, requestErr = resellerRequestMaximumTokenQuota(relayInfo)
				}
				noteQuotaClamp(relayInfo, clamp)
				if clamp != nil {
					return types.NewErrorWithStatusCode(
						clamp,
						types.ErrorCodeModelPriceError,
						http.StatusBadRequest,
						types.ErrOptionWithSkipRetry(),
					)
				}
				if requestErr != nil {
					return types.NewErrorWithStatusCode(
						requestErr,
						types.ErrorCodeInvalidRequest,
						http.StatusBadRequest,
						types.ErrOptionWithSkipRetry(),
					)
				}
			}
			if rawPreConsumedQuota > currentToken.RemainQuota {
				return types.NewErrorWithStatusCode(
					quotaErr,
					types.ErrorCodePreConsumeTokenQuotaFailed,
					http.StatusForbidden,
					types.ErrOptionWithSkipRetry(),
					types.ErrOptionWithNoRecordErrorLog(),
				)
			}
			if !isResellerBilling(relayInfo) {
				rawPreConsumedQuota = currentToken.RemainQuota
				fullBalanceHeld = true
			}
		}
		relayInfo.TokenQuotaPreConsumed = rawPreConsumedQuota
		relayInfo.TokenQuotaReservationInitialized = true
		if isResellerBilling(relayInfo) {
			preConsumedQuota = rawPreConsumedQuota
		}
	}
	session, apiErr := NewBillingSession(c, relayInfo, preConsumedQuota)
	if apiErr != nil {
		return apiErr
	}
	session.fullBalanceHeld = fullBalanceHeld
	relayInfo.Billing = session
	return nil
}

// ---------------------------------------------------------------------------
// SettleBilling — 后结算辅助函数
// ---------------------------------------------------------------------------

// SettleBilling 执行计费结算。如果 RelayInfo 上有 BillingSession 则通过 session 结算，
// 否则回退到旧的 PostConsumeQuota 路径（兼容按次计费等场景）。
func SettleBilling(ctx *gin.Context, relayInfo *relaycommon.RelayInfo, actualQuota int) error {
	if relayInfo.Billing != nil {
		preConsumed := relayInfo.Billing.GetPreConsumedQuota()
		delta := actualQuota - preConsumed

		if delta > 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后补扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else if delta < 0 {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费后返还扣费：%s（实际消耗：%s，预扣费：%s）",
				logger.FormatQuota(-delta),
				logger.FormatQuota(actualQuota),
				logger.FormatQuota(preConsumed),
			))
		} else {
			logger.LogInfo(ctx, fmt.Sprintf("预扣费与实际消耗一致，无需调整：%s（按次计费）",
				logger.FormatQuota(actualQuota),
			))
		}

		if err := relayInfo.Billing.Settle(actualQuota); err != nil {
			// A reseller response may already have been delivered by the time usage
			// settlement runs. Do not refund its reservation after a late database
			// failure, otherwise the client receives the upstream response for free.
			// Ordinary raw-token requests retain their compensating refund path.
			if usesRawTokenQuota(relayInfo) && !isResellerBilling(relayInfo) {
				relayInfo.Billing.Refund(ctx)
			}
			return err
		}

		// 发送额度通知（订阅计费使用订阅剩余额度）
		if actualQuota != 0 {
			if relayInfo.BillingSource == BillingSourceSubscription {
				checkAndSendSubscriptionQuotaNotify(relayInfo)
			} else if relayInfo.BillingSource == BillingSourceWallet {
				checkAndSendQuotaNotify(relayInfo, actualQuota-preConsumed, preConsumed)
			}
		}
		return nil
	}

	// 回退：无 BillingSession 时使用旧路径
	if usesRawTokenQuota(relayInfo) && !isResellerBilling(relayInfo) {
		return errors.New("raw token quota billing session is missing")
	}
	quotaDelta := actualQuota - relayInfo.FinalPreConsumedQuota
	if quotaDelta != 0 {
		return PostConsumeQuota(relayInfo, quotaDelta, relayInfo.FinalPreConsumedQuota, true)
	}
	return nil
}
