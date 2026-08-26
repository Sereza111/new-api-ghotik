package controller

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/thanhpk/randstr"
)

const (
	cryptoPayMainnetAPI = "https://pay.crypt.bot/api"
	cryptoPayTestnetAPI = "https://testnet-pay.crypt.bot/api"
	cryptoPayMaxBody    = 1 << 20
)

var cryptoPayAssets = map[string]struct{}{
	"USDT": {}, "TON": {}, "BTC": {}, "ETH": {},
	"LTC": {}, "BNB": {}, "TRX": {}, "USDC": {},
}

type cryptoPayCreateInvoiceRequest struct {
	CurrencyType   string `json:"currency_type"`
	Fiat           string `json:"fiat"`
	AcceptedAssets string `json:"accepted_assets,omitempty"`
	Amount         string `json:"amount"`
	Description    string `json:"description,omitempty"`
	PaidButtonName string `json:"paid_btn_name,omitempty"`
	PaidButtonURL  string `json:"paid_btn_url,omitempty"`
	Payload        string `json:"payload"`
	AllowComments  bool   `json:"allow_comments"`
	AllowAnonymous bool   `json:"allow_anonymous"`
	ExpiresIn      int    `json:"expires_in"`
}

type cryptoPayInvoice struct {
	InvoiceID         int64  `json:"invoice_id"`
	CurrencyType      string `json:"currency_type"`
	Fiat              string `json:"fiat"`
	Amount            string `json:"amount"`
	Status            string `json:"status"`
	Payload           string `json:"payload"`
	BotInvoiceURL     string `json:"bot_invoice_url"`
	MiniAppInvoiceURL string `json:"mini_app_invoice_url"`
	WebAppInvoiceURL  string `json:"web_app_invoice_url"`
}

type cryptoPayAPIResponse struct {
	OK     bool             `json:"ok"`
	Result cryptoPayInvoice `json:"result"`
	Error  interface{}      `json:"error"`
}

type cryptoPayWebhookUpdate struct {
	UpdateID    int64            `json:"update_id"`
	UpdateType  string           `json:"update_type"`
	RequestDate interface{}      `json:"request_date"`
	Payload     cryptoPayInvoice `json:"payload"`
}

func normalizeCryptoPayAssets(value string) string {
	seen := make(map[string]struct{})
	assets := make([]string, 0)
	for _, raw := range strings.Split(value, ",") {
		asset := strings.ToUpper(strings.TrimSpace(raw))
		if _, supported := cryptoPayAssets[asset]; !supported {
			continue
		}
		if _, duplicate := seen[asset]; duplicate {
			continue
		}
		seen[asset] = struct{}{}
		assets = append(assets, asset)
	}
	return strings.Join(assets, ",")
}

func getCryptoPayMoney(amount int64, group string) float64 {
	if common.QuotaPerUnit <= 0 || setting.CryptoPayUnitPrice <= 0 ||
		math.IsNaN(setting.CryptoPayUnitPrice) || math.IsInf(setting.CryptoPayUnitPrice, 0) {
		return 0
	}
	dAmount := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		dAmount = dAmount.Div(decimal.NewFromFloat(common.QuotaPerUnit))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}
	discount := 1.0
	if configured, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok && configured > 0 {
		discount = configured
	}
	return dAmount.
		Mul(decimal.NewFromFloat(setting.CryptoPayUnitPrice)).
		Mul(decimal.NewFromFloat(topupGroupRatio)).
		Mul(decimal.NewFromFloat(discount)).
		Round(2).
		InexactFloat64()
}

func createCryptoPayInvoice(ctx context.Context, client *http.Client, baseURL string, token string, payload cryptoPayCreateInvoiceRequest) (cryptoPayInvoice, error) {
	body, err := common.Marshal(payload)
	if err != nil {
		return cryptoPayInvoice{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/createInvoice", bytes.NewReader(body))
	if err != nil {
		return cryptoPayInvoice{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Crypto-Pay-API-Token", token)

	response, err := client.Do(req)
	if err != nil {
		return cryptoPayInvoice{}, err
	}
	defer response.Body.Close()

	var apiResponse cryptoPayAPIResponse
	if err := common.DecodeJson(io.LimitReader(response.Body, cryptoPayMaxBody), &apiResponse); err != nil {
		return cryptoPayInvoice{}, err
	}
	if response.StatusCode != http.StatusOK || !apiResponse.OK {
		reason := strings.TrimSpace(common.Interface2String(apiResponse.Error))
		if reason == "" {
			reason = response.Status
		}
		return cryptoPayInvoice{}, fmt.Errorf("Crypto Pay API rejected invoice: %s", reason)
	}
	if apiResponse.Result.InvoiceID <= 0 || apiResponse.Result.Status != "active" {
		return cryptoPayInvoice{}, errors.New("Crypto Pay API returned an invalid invoice")
	}
	return apiResponse.Result, nil
}

func RequestCryptoPayAmount(c *gin.Context) {
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "Invalid request")
		return
	}
	if req.Amount < int64(setting.CryptoPayMinTopUp) {
		common.ApiErrorMsg(c, fmt.Sprintf("Minimum top-up is %d", setting.CryptoPayMinTopUp))
		return
	}
	id := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, id, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		common.ApiErrorMsg(c, "Failed to get user group")
		return
	}
	payMoney := getCryptoPayMoney(req.Amount, group)
	if payMoney < 0.01 {
		common.ApiErrorMsg(c, "Payment amount is too low")
		return
	}
	common.ApiSuccess(c, strconv.FormatFloat(payMoney, 'f', 2, 64))
}

func RequestCryptoPay(c *gin.Context) {
	if !isCryptoPayTopUpEnabled() {
		common.ApiErrorMsg(c, "Crypto Bot payments are not enabled")
		return
	}
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "Invalid request")
		return
	}
	if req.Amount < int64(setting.CryptoPayMinTopUp) {
		common.ApiErrorMsg(c, fmt.Sprintf("Minimum top-up is %d", setting.CryptoPayMinTopUp))
		return
	}
	id := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, id, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(id, true)
	if err != nil {
		common.ApiErrorMsg(c, "Failed to get user group")
		return
	}
	payMoney := getCryptoPayMoney(req.Amount, group)
	if payMoney < 0.01 {
		common.ApiErrorMsg(c, "Payment amount is too low")
		return
	}

	tradeNo := fmt.Sprintf("CRYPTOPAY-%d-%d-%s", id, time.Now().UnixMilli(), randstr.String(6))
	storedAmount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		storedAmount = decimal.NewFromInt(req.Amount).
			Div(decimal.NewFromFloat(common.QuotaPerUnit)).
			Floor().
			IntPart()
		if storedAmount < 1 {
			storedAmount = 1
		}
	}
	topUp := &model.TopUp{
		UserId: id, Amount: storedAmount, Money: payMoney, TradeNo: tradeNo,
		PaymentMethod: model.PaymentMethodCryptoPay, PaymentProvider: model.PaymentProviderCryptoPay,
		CreateTime: time.Now().Unix(), Status: common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Crypto Pay 创建充值订单失败 user_id=%d trade_no=%s error=%q", id, tradeNo, err.Error()))
		common.ApiErrorMsg(c, "Failed to create payment order")
		return
	}

	baseURL := cryptoPayMainnetAPI
	if setting.CryptoPayTestnet {
		baseURL = cryptoPayTestnetAPI
	}
	requestContext, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	invoice, err := createCryptoPayInvoice(requestContext, service.GetHttpClient(), baseURL, setting.CryptoPayAPIToken, cryptoPayCreateInvoiceRequest{
		CurrencyType: "fiat", Fiat: "USD", AcceptedAssets: normalizeCryptoPayAssets(setting.CryptoPayAcceptedAssets),
		Amount:         strconv.FormatFloat(payMoney, 'f', 2, 64),
		Description:    fmt.Sprintf("Balance top-up: %.2f USD", payMoney),
		PaidButtonName: "callback", PaidButtonURL: paymentReturnPath("/wallet?show_history=true"),
		Payload: tradeNo, AllowComments: false, AllowAnonymous: true, ExpiresIn: 3600,
	})
	if err != nil {
		_ = model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderCryptoPay, common.TopUpStatusFailed)
		logger.LogError(c.Request.Context(), fmt.Sprintf("Crypto Pay 创建发票失败 user_id=%d trade_no=%s error=%q", id, tradeNo, err.Error()))
		common.ApiErrorMsg(c, "Failed to create Crypto Bot invoice")
		return
	}
	invoiceAmount, amountErr := decimal.NewFromString(invoice.Amount)
	if amountErr != nil || invoice.CurrencyType != "fiat" || invoice.Fiat != "USD" ||
		invoice.Payload != tradeNo || !invoiceAmount.Round(2).Equal(decimal.NewFromFloat(payMoney).Round(2)) {
		_ = model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderCryptoPay, common.TopUpStatusFailed)
		logger.LogError(c.Request.Context(), fmt.Sprintf("Crypto Pay 发票校验失败 user_id=%d trade_no=%s invoice_id=%d", id, tradeNo, invoice.InvoiceID))
		common.ApiErrorMsg(c, "Crypto Bot returned an invalid invoice")
		return
	}
	payLink := invoice.BotInvoiceURL
	if payLink == "" {
		payLink = invoice.MiniAppInvoiceURL
	}
	if payLink == "" {
		payLink = invoice.WebAppInvoiceURL
	}
	if payLink == "" {
		_ = model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderCryptoPay, common.TopUpStatusFailed)
		common.ApiErrorMsg(c, "Crypto Bot invoice link is missing")
		return
	}
	common.ApiSuccess(c, gin.H{"pay_link": payLink})
}

func verifyCryptoPaySignature(body []byte, signature string, token string) bool {
	key := sha256.Sum256([]byte(token))
	mac := hmac.New(sha256.New, key[:])
	_, _ = mac.Write(body)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(strings.ToLower(strings.TrimSpace(signature))))
}

func CryptoPayWebhook(c *gin.Context) {
	if !isCryptoPayWebhookEnabled() {
		c.AbortWithStatus(http.StatusForbidden)
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, cryptoPayMaxBody))
	if err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if !verifyCryptoPaySignature(body, c.GetHeader("crypto-pay-api-signature"), setting.CryptoPayAPIToken) {
		logger.LogWarn(c.Request.Context(), fmt.Sprintf("Crypto Pay webhook 验签失败 client_ip=%s", c.ClientIP()))
		c.AbortWithStatus(http.StatusUnauthorized)
		return
	}
	var update cryptoPayWebhookUpdate
	if err := common.Unmarshal(body, &update); err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	if update.UpdateType != "invoice_paid" {
		c.Status(http.StatusOK)
		return
	}
	invoice := update.Payload
	if invoice.Status != "paid" || invoice.CurrencyType != "fiat" || invoice.Fiat != "USD" || invoice.Payload == "" {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	paidAmount, err := decimal.NewFromString(invoice.Amount)
	if err != nil {
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	_, err = model.RechargeCryptoPay(invoice.Payload, paidAmount, invoice.Fiat, c.ClientIP())
	if err != nil {
		if errors.Is(err, model.ErrTopUpStatusInvalid) {
			c.Status(http.StatusOK)
			return
		}
		logger.LogError(c.Request.Context(), fmt.Sprintf("Crypto Pay webhook 处理失败 invoice_id=%d trade_no=%s error=%q", invoice.InvoiceID, invoice.Payload, err.Error()))
		c.AbortWithStatus(http.StatusBadRequest)
		return
	}
	c.Status(http.StatusOK)
}
