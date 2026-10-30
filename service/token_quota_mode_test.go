package service

import (
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type retryableTokenQuotaFunding struct {
	settleCalls    int
	failNextSettle bool
	settledDeltas  []int
}

func (f *retryableTokenQuotaFunding) Source() string { return BillingSourceWallet }

func (f *retryableTokenQuotaFunding) PreConsume(int) error { return nil }

func (f *retryableTokenQuotaFunding) Settle(delta int) error {
	f.settleCalls++
	if f.failNextSettle {
		f.failNextSettle = false
		return errors.New("transient funding settlement failure")
	}
	f.settledDeltas = append(f.settledDeltas, delta)
	return nil
}

func (f *retryableTokenQuotaFunding) Refund() error { return nil }

type recordingTokenQuotaFunding struct {
	source        string
	settledDeltas []int
	settleErr     error
	refundCalls   int
}

func (f *recordingTokenQuotaFunding) Source() string { return f.source }

func (f *recordingTokenQuotaFunding) PreConsume(int) error { return nil }

func (f *recordingTokenQuotaFunding) Settle(delta int) error {
	f.settledDeltas = append(f.settledDeltas, delta)
	return f.settleErr
}

func (f *recordingTokenQuotaFunding) Refund() error {
	f.refundCalls++
	return nil
}

func newRawTokenBillingFixture(t *testing.T, tokenID, userID int, remain int) (*gin.Context, *relaycommon.RelayInfo) {
	t.Helper()
	truncate(t)
	seedUser(t, userID, 100_000)
	seedToken(t, tokenID, userID, "raw-quota-key", remain)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", tokenID).
		Update("quota_mode", model.TokenQuotaModeTokens).Error)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := &relaycommon.RelayInfo{
		TokenId:        tokenID,
		TokenKey:       "raw-quota-key",
		TokenQuotaMode: model.TokenQuotaModeTokens,
		UserId:         userID,
		RelayFormat:    relaytypes.RelayFormatOpenAI,
	}
	return ctx, info
}

func TestRawTokenQuotaSeparatesPricedFundingFromTokenUsage(t *testing.T) {
	ctx, info := newRawTokenBillingFixture(t, 801, 800, 1_000)
	info.SetEstimatePromptTokens(20)
	require.Nil(t, PreConsumeBilling(ctx, 200, info))
	assert.Equal(t, 200, info.Billing.GetPreConsumedQuota(), "wallet funding stays priced")
	assert.Equal(t, 1_000, info.TokenQuotaPreConsumed, "raw key reserves its full balance")

	actualRaw := 115
	info.TokenQuotaActual = &actualRaw
	require.NoError(t, info.Billing.Settle(300))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 801).Error)
	assert.Equal(t, 885, token.RemainQuota)
	assert.Equal(t, 115, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 800).Error)
	assert.Equal(t, 99_700, user.Quota)
}

func TestRawTokenQuotaMissingUsageFailsClosed(t *testing.T) {
	ctx, info := newRawTokenBillingFixture(t, 811, 810, 1_000)
	require.Nil(t, PreConsumeBilling(ctx, 200, info))
	// A priced settlement without a measured raw usage value must not refund the
	// hard token reservation or reinterpret priced units as raw tokens.
	require.NoError(t, info.Billing.Settle(300))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 811).Error)
	assert.Zero(t, token.RemainQuota)
	assert.Equal(t, 1_000, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 810).Error)
	assert.Equal(t, 99_700, user.Quota)
}

func TestUnlimitedRawTokenQuotaDoesNotMutateTokenCounters(t *testing.T) {
	ctx, info := newRawTokenBillingFixture(t, 816, 815, 1_000)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 816).
		Updates(map[string]interface{}{"unlimited_quota": true}).Error)
	info.SetEstimatePromptTokens(20)

	require.Nil(t, PreConsumeBilling(ctx, 200, info))
	assert.Zero(t, info.TokenQuotaPreConsumed)

	actualRaw := 115
	info.TokenQuotaActual = &actualRaw
	require.NoError(t, info.Billing.Settle(300))

	var token model.Token
	require.NoError(t, model.DB.First(&token, 816).Error)
	assert.True(t, token.UnlimitedQuota)
	assert.Equal(t, 1_000, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 815).Error)
	assert.Equal(t, 99_700, user.Quota)
}

func TestRawTokenQuotaRefundIsIdempotent(t *testing.T) {
	ctx, info := newRawTokenBillingFixture(t, 821, 820, 1_000)
	require.Nil(t, PreConsumeBilling(ctx, 200, info))
	info.Billing.Refund(ctx)
	info.Billing.Refund(ctx)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 821).Error)
	assert.Equal(t, 1_000, token.RemainQuota)
	assert.Zero(t, token.UsedQuota)
	var user model.User
	require.NoError(t, model.DB.First(&user, 820).Error)
	assert.Equal(t, 100_000, user.Quota)
}

func TestRawTokenSettlementAfterDeletionFinalizesFunding(t *testing.T) {
	for index, source := range []string{BillingSourceWallet, BillingSourceSubscription} {
		t.Run(source, func(t *testing.T) {
			tokenID := 831 + index
			userID := 830 + index
			_, info := newRawTokenBillingFixture(t, tokenID, userID, 1_000)
			require.NoError(t, model.DeleteTokenById(tokenID, userID))
			actualRaw := 115
			info.TokenQuotaActual = &actualRaw
			funding := &recordingTokenQuotaFunding{source: source}
			session := &BillingSession{
				relayInfo:        info,
				funding:          funding,
				preConsumedQuota: 200,
				tokenConsumed:    1_000,
				fullBalanceHeld:  true,
			}

			require.NoError(t, session.Settle(300))
			assert.Equal(t, []int{100}, funding.settledDeltas)
			assert.True(t, session.fundingSettled)
			assert.True(t, session.settled)
			assert.False(t, session.NeedsRefund())
		})
	}
}

func TestRawTokenSettlementFailureAfterDeletionRefundsFunding(t *testing.T) {
	for index, source := range []string{BillingSourceWallet, BillingSourceSubscription} {
		t.Run(source, func(t *testing.T) {
			tokenID := 834 + index
			userID := 833 + index
			ctx, info := newRawTokenBillingFixture(t, tokenID, userID, 1_000)
			require.NoError(t, model.DeleteTokenById(tokenID, userID))
			actualRaw := 115
			info.TokenQuotaActual = &actualRaw
			funding := &recordingTokenQuotaFunding{
				source:    source,
				settleErr: errors.New("funding settlement failed"),
			}
			session := &BillingSession{
				relayInfo:        info,
				funding:          funding,
				preConsumedQuota: 200,
				tokenConsumed:    1_000,
				fullBalanceHeld:  true,
			}
			info.Billing = session

			require.Error(t, SettleBilling(ctx, info, 300))
			assert.Equal(t, []int{100}, funding.settledDeltas)
			assert.Equal(t, 1, funding.refundCalls)
			assert.True(t, session.refunded)
			assert.False(t, session.NeedsRefund())
		})
	}
}

func TestRawTokenRefundAfterDeletionRefundsFundingOnce(t *testing.T) {
	for index, source := range []string{BillingSourceWallet, BillingSourceSubscription} {
		t.Run(source, func(t *testing.T) {
			tokenID := 837 + index
			userID := 836 + index
			ctx, info := newRawTokenBillingFixture(t, tokenID, userID, 1_000)
			require.NoError(t, model.DeleteTokenById(tokenID, userID))
			funding := &recordingTokenQuotaFunding{source: source}
			session := &BillingSession{
				relayInfo:        info,
				funding:          funding,
				preConsumedQuota: 200,
				tokenConsumed:    1_000,
				fullBalanceHeld:  true,
			}

			session.Refund(ctx)
			session.Refund(ctx)
			assert.Equal(t, 1, funding.refundCalls)
			assert.True(t, session.refunded)
			assert.False(t, session.NeedsRefund())
		})
	}
}

func TestRawTokenRefundAfterDeletionRestoresWalletBalance(t *testing.T) {
	ctx, info := newRawTokenBillingFixture(t, 841, 840, 1_000)
	require.Nil(t, PreConsumeBilling(ctx, 200, info))
	require.NoError(t, model.DeleteTokenById(841, 840))

	info.Billing.Refund(ctx)
	info.Billing.Refund(ctx)

	var user model.User
	require.NoError(t, model.DB.First(&user, 840).Error)
	assert.Equal(t, 100_000, user.Quota)
	assert.False(t, info.Billing.NeedsRefund())
}

func TestRawTokenSettlementRetriesFundingAfterTokenCommit(t *testing.T) {
	_, info := newRawTokenBillingFixture(t, 841, 840, 0)
	require.NoError(t, model.DB.Model(&model.Token{}).Where("id = ?", 841).
		Updates(map[string]interface{}{"used_quota": 1_000}).Error)
	actualRaw := 115
	info.TokenQuotaActual = &actualRaw
	funding := &retryableTokenQuotaFunding{failNextSettle: true}
	session := &BillingSession{
		relayInfo:        info,
		funding:          funding,
		preConsumedQuota: 200,
		tokenConsumed:    1_000,
		fullBalanceHeld:  true,
	}

	require.Error(t, session.Settle(300))
	assert.False(t, session.settled)
	assert.False(t, session.fundingSettled)
	assert.Equal(t, 115, session.tokenConsumed, "refund state must retain measured raw usage")
	var token model.Token
	require.NoError(t, model.DB.First(&token, 841).Error)
	assert.Equal(t, 885, token.RemainQuota)
	assert.Equal(t, 115, token.UsedQuota)

	// Retrying the same settlement must not apply the raw adjustment again; the
	// operation ledger and updated in-memory reservation reduce the token delta
	// to zero while funding retries exactly once.
	require.NoError(t, session.Settle(300))
	assert.True(t, session.settled)
	assert.Equal(t, 2, funding.settleCalls)
	require.NoError(t, model.DB.First(&token, 841).Error)
	assert.Equal(t, 885, token.RemainQuota)
	assert.Equal(t, 115, token.UsedQuota)
}
