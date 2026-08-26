package controller

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreatePlategaTransactionUsesAuthenticatedRUBRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/transaction/process", r.URL.Path)
		assert.Equal(t, "merchant-id", r.Header.Get("X-MerchantId"))
		assert.Equal(t, "secret", r.Header.Get("X-Secret"))

		var request plategaCreateTransactionRequest
		require.NoError(t, common.DecodeJson(r.Body, &request))
		assert.Equal(t, 2, request.PaymentMethod)
		assert.Equal(t, "RUB", request.PaymentDetails.Currency)
		assert.InDelta(t, 80.5, request.PaymentDetails.Amount, 0.000001)
		assert.Equal(t, "order-123", request.Payload)

		w.Header().Set("Content-Type", "application/json")
		_, err := io.WriteString(w, `{"transactionId":"transaction-123","redirect":"https://pay.example/transaction-123","status":"PENDING"}`)
		require.NoError(t, err)
	}))
	defer server.Close()

	transaction, err := createPlategaTransaction(
		context.Background(),
		server.Client(),
		server.URL,
		"merchant-id",
		"secret",
		plategaCreateTransactionRequest{
			PaymentMethod: 2,
			PaymentDetails: plategaPaymentDetails{
				Amount:   80.5,
				Currency: "RUB",
			},
			Payload: "order-123",
		},
	)
	require.NoError(t, err)
	assert.Equal(t, "transaction-123", transaction.TransactionID)
	assert.Equal(t, "https://pay.example/transaction-123", transaction.Redirect)
}

func TestGetPlategaMoneyConvertsWalletUSDToRUB(t *testing.T) {
	originalRate := operation_setting.USDExchangeRate
	originalPrice := operation_setting.Price
	originalQuotaDisplayType := operation_setting.GetGeneralSetting().QuotaDisplayType
	originalDiscounts := operation_setting.GetPaymentSetting().AmountDiscount
	originalTopupGroupRatio := common.TopupGroupRatio2JSONString()
	t.Cleanup(func() {
		operation_setting.USDExchangeRate = originalRate
		operation_setting.Price = originalPrice
		operation_setting.GetGeneralSetting().QuotaDisplayType = originalQuotaDisplayType
		operation_setting.GetPaymentSetting().AmountDiscount = originalDiscounts
		require.NoError(t, common.UpdateTopupGroupRatioByJSONString(originalTopupGroupRatio))
	})

	operation_setting.USDExchangeRate = 80
	operation_setting.Price = 7.3
	operation_setting.GetGeneralSetting().QuotaDisplayType = operation_setting.QuotaDisplayTypeUSD
	operation_setting.GetPaymentSetting().AmountDiscount = map[int]float64{10: 0.8}
	require.NoError(t, common.UpdateTopupGroupRatioByJSONString(`{"default":1,"vip":1.25}`))

	testCases := []struct {
		name     string
		amount   int64
		group    string
		expected decimal.Decimal
	}{
		{
			name:     "one wallet dollar becomes the configured RUB rate",
			amount:   1,
			group:    "default",
			expected: decimal.NewFromInt(80),
		},
		{
			name:     "group ratio and preset discount are applied before conversion",
			amount:   10,
			group:    "vip",
			expected: decimal.NewFromInt(800),
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			actual, err := getPlategaMoney(tc.amount, tc.group)
			require.NoError(t, err)
			assert.True(t, tc.expected.Equal(actual), "expected %s, got %s", tc.expected, actual)
		})
	}
}

func TestVerifyPlategaCallbackCredentials(t *testing.T) {
	originalMerchantID := setting.PlategaMerchantID
	originalSecret := setting.PlategaAPISecret
	t.Cleanup(func() {
		setting.PlategaMerchantID = originalMerchantID
		setting.PlategaAPISecret = originalSecret
	})

	setting.PlategaMerchantID = "merchant-id"
	setting.PlategaAPISecret = "secret"
	assert.True(t, verifyPlategaCallbackCredentials("merchant-id", "secret"))
	assert.False(t, verifyPlategaCallbackCredentials("merchant-id", "wrong"))
	assert.False(t, verifyPlategaCallbackCredentials("wrong", "secret"))
}
