package controller

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestVerifyCryptoPaySignature(t *testing.T) {
	body := []byte(`{"update_id":1,"update_type":"invoice_paid"}`)
	token := "test-token"
	key := sha256.Sum256([]byte(token))
	mac := hmac.New(sha256.New, key[:])
	_, err := mac.Write(body)
	require.NoError(t, err)
	signature := hex.EncodeToString(mac.Sum(nil))

	assert.True(t, verifyCryptoPaySignature(body, signature, token))
	assert.False(t, verifyCryptoPaySignature(body, signature, "wrong-token"))
	assert.False(t, verifyCryptoPaySignature([]byte("changed"), signature, token))
}

func TestCreateCryptoPayInvoiceUsesAuthenticatedRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/createInvoice", r.URL.Path)
		assert.Equal(t, "secret-token", r.Header.Get("Crypto-Pay-API-Token"))

		var request cryptoPayCreateInvoiceRequest
		require.NoError(t, common.DecodeJson(r.Body, &request))
		assert.Equal(t, "fiat", request.CurrencyType)
		assert.Equal(t, "USD", request.Fiat)
		assert.Equal(t, "order-123", request.Payload)

		w.Header().Set("Content-Type", "application/json")
		_, err := io.WriteString(w, `{"ok":true,"result":{"invoice_id":42,"currency_type":"fiat","fiat":"USD","amount":"10.00","status":"active","payload":"order-123","bot_invoice_url":"https://t.me/CryptoBot?start=invoice"}}`)
		require.NoError(t, err)
	}))
	defer server.Close()

	invoice, err := createCryptoPayInvoice(context.Background(), server.Client(), server.URL, "secret-token", cryptoPayCreateInvoiceRequest{
		CurrencyType: "fiat",
		Fiat:         "USD",
		Amount:       "10.00",
		Payload:      "order-123",
	})
	require.NoError(t, err)
	assert.Equal(t, int64(42), invoice.InvoiceID)
	assert.Equal(t, "https://t.me/CryptoBot?start=invoice", invoice.BotInvoiceURL)
}

func TestNormalizeCryptoPayAssets(t *testing.T) {
	assert.Equal(t, "USDT,TON,BTC", normalizeCryptoPayAssets(" usdt,TON,invalid,btc,USDT "))
	assert.Empty(t, normalizeCryptoPayAssets("invalid"))
}
