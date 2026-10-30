package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPurchaseResellerSubscriptionChargesOnceAndSnapshotsTerms(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	user := createReserveTestUser(t, 10_000_000)
	purchase := ResellerSubscriptionPurchase{
		UserId: user.Id, ListPrice: "10.00", DiscountPercent: 20,
		PaidPrice: "8.00", ChargedQuota: 4_000_000, DurationDays: 30,
		RequestId: "subscription-purchase-1",
	}

	created, subscription, err := PurchaseResellerSubscription(purchase)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, subscription)
	assert.Equal(t, "10.00", subscription.ListPrice)
	assert.Equal(t, "8.00", subscription.PaidPrice)
	assert.Equal(t, 20, subscription.DiscountPercent)
	assert.Equal(t, 4_000_000, subscription.ChargedQuota)
	assert.Equal(t, int64(30*24*60*60), subscription.EndTime-subscription.StartTime)
	assert.Equal(t, 6_000_000, getUserQuotaFromDB(t, user.Id))

	created, replay, err := PurchaseResellerSubscription(purchase)
	require.NoError(t, err)
	assert.False(t, created)
	require.NotNil(t, replay)
	assert.Equal(t, subscription.Id, replay.Id)
	assert.Equal(t, 6_000_000, getUserQuotaFromDB(t, user.Id))
	var count int64
	require.NoError(t, DB.Model(&ResellerSubscription{}).Where("user_id = ?", user.Id).Count(&count).Error)
	assert.EqualValues(t, 1, count)
}

func TestPurchaseResellerSubscriptionRejectsActiveOrUnaffordablePurchase(t *testing.T) {
	truncateTables(t)
	resetBatchUpdateTestState(t)
	previousQuotaPerUnit := common.QuotaPerUnit
	common.QuotaPerUnit = 500_000
	t.Cleanup(func() { common.QuotaPerUnit = previousQuotaPerUnit })
	user := createReserveTestUser(t, 4_000_000)
	purchase := ResellerSubscriptionPurchase{
		UserId: user.Id, ListPrice: "10.00", DiscountPercent: 20,
		PaidPrice: "8.00", ChargedQuota: 4_000_000, DurationDays: 30,
		RequestId: "subscription-purchase-2",
	}

	created, subscription, err := PurchaseResellerSubscription(purchase)
	require.NoError(t, err)
	require.True(t, created)
	require.NotNil(t, subscription)
	purchase.RequestId = "second-active-purchase"
	created, subscription, err = PurchaseResellerSubscription(purchase)
	assert.False(t, created)
	assert.Nil(t, subscription)
	assert.ErrorIs(t, err, ErrResellerSubscriptionAlreadyActive)
	assert.Zero(t, getUserQuotaFromDB(t, user.Id))

	other := createReserveTestUser(t, 3_999_999)
	purchase.UserId = other.Id
	purchase.RequestId = "unaffordable-purchase"
	created, subscription, err = PurchaseResellerSubscription(purchase)
	assert.False(t, created)
	assert.Nil(t, subscription)
	assert.ErrorIs(t, err, ErrResellerSubscriptionWalletInsufficient)
	assert.Equal(t, 3_999_999, getUserQuotaFromDB(t, other.Id))
}

func TestResellerSubscriptionUsesStrictActiveBounds(t *testing.T) {
	truncateTables(t)
	now := common.GetTimestamp()
	user := createReserveTestUser(t, 1)
	boundary := ResellerSubscription{
		UserId: user.Id, Status: ResellerSubscriptionStatusActive,
		StartTime: now - 100, EndTime: now,
		ListPrice: "1.00", PaidPrice: "1.00", ChargedQuota: 1,
		DurationDays: 1, RequestId: "expired-boundary", CreatedTime: now - 100,
	}
	require.NoError(t, DB.Create(&boundary).Error)

	active, err := GetActiveResellerSubscription(user.Id)
	require.NoError(t, err)
	assert.Nil(t, active, "end_time equal to now is expired")
	assert.False(t, boundary.IsActiveAt(now))

	boundary.RequestId = "future-boundary"
	boundary.Id = 0
	boundary.StartTime = now + 1
	boundary.EndTime = now + 100
	require.NoError(t, DB.Create(&boundary).Error)
	active, err = GetActiveResellerSubscription(user.Id)
	require.NoError(t, err)
	assert.Nil(t, active, "future subscriptions are not active early")
}
