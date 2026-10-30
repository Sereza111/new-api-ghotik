package controller

import (
	"context"
	"crypto/subtle"
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
)

const plategaAPIBaseURL = "https://app.platega.io"

var plategaMethodIDs = map[string]int{
	model.PaymentMethodPlategaSBP:    2,
	model.PaymentMethodPlategaCard:   11,
	model.PaymentMethodPlategaCrypto: 13,
}

type plategaPaymentDetails struct {
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
}

type plategaCreateTransactionRequest struct {
	PaymentMethod  int                   `json:"paymentMethod"`
	PaymentDetails plategaPaymentDetails `json:"paymentDetails"`
	Description    string                `json:"description"`
	Return         string                `json:"return"`
	FailedURL      string                `json:"failedUrl"`
	Payload        string                `json:"payload"`
	Metadata       map[string]string     `json:"metadata,omitempty"`
}

type plategaCreateTransactionResponse struct {
	TransactionID string `json:"transactionId"`
	Redirect      string `json:"redirect"`
	URL           string `json:"url"`
	Status        string `json:"status"`
}

type plategaCallback struct {
	ID            string          `json:"id"`
	Amount        decimal.Decimal `json:"amount"`
	Currency      string          `json:"currency"`
	Status        string          `json:"status"`
	PaymentMethod int             `json:"paymentMethod"`
}

func plategaPaymentMethodName(methodID int) string {
	for paymentMethod, id := range plategaMethodIDs {
		if id == methodID {
			return paymentMethod
		}
	}
	return ""
}

func getPlategaMoney(amount int64, group string) (decimal.Decimal, error) {
	if operation_setting.USDExchangeRate <= 0 ||
		math.IsNaN(operation_setting.USDExchangeRate) ||
		math.IsInf(operation_setting.USDExchangeRate, 0) {
		return decimal.Zero, errors.New("USD/RUB exchange rate is not configured")
	}

	amountUSD := decimal.NewFromInt(amount)
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		if common.QuotaPerUnit <= 0 {
			return decimal.Zero, errors.New("quota unit is not configured")
		}
		amountUSD = amountUSD.Div(decimal.NewFromFloat(common.QuotaPerUnit))
	}

	topupGroupRatio := common.GetTopupGroupRatio(group)
	if topupGroupRatio == 0 {
		topupGroupRatio = 1
	}
	discount := 1.0
	if configured, ok := operation_setting.GetPaymentSetting().AmountDiscount[int(amount)]; ok && configured > 0 {
		discount = configured
	}

	amountRUB := amountUSD.
		Mul(decimal.NewFromFloat(topupGroupRatio)).
		Mul(decimal.NewFromFloat(discount)).
		Mul(decimal.NewFromFloat(operation_setting.USDExchangeRate)).
		Round(2)
	if amountRUB.LessThan(decimal.NewFromInt(1)) {
		return decimal.Zero, errors.New("payment amount is too low")
	}
	return amountRUB, nil
}

func createPlategaTransaction(ctx context.Context, client *http.Client, baseURL string, merchantID string, secret string, payload plategaCreateTransactionRequest) (plategaCreateTransactionResponse, error) {
	body, err := common.Marshal(payload)
	if err != nil {
		return plategaCreateTransactionResponse{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+"/transaction/process", strings.NewReader(string(body)))
	if err != nil {
		return plategaCreateTransactionResponse{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-MerchantId", merchantID)
	request.Header.Set("X-Secret", secret)

	response, err := client.Do(request)
	if err != nil {
		return plategaCreateTransactionResponse{}, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
		return plategaCreateTransactionResponse{}, fmt.Errorf("Platega returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(message)))
	}

	var result plategaCreateTransactionResponse
	if err := common.DecodeJson(response.Body, &result); err != nil {
		return plategaCreateTransactionResponse{}, err
	}
	if result.TransactionID == "" || (result.Redirect == "" && result.URL == "") {
		return plategaCreateTransactionResponse{}, errors.New("Platega response does not contain a transaction or checkout URL")
	}
	return result, nil
}

func RequestPlategaAmount(c *gin.Context) {
	var req AmountRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "Invalid request")
		return
	}
	if req.Amount < int64(setting.PlategaMinTopUp) {
		common.ApiErrorMsg(c, fmt.Sprintf("Minimum top-up is %d", setting.PlategaMinTopUp))
		return
	}
	userID := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, userID, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		common.ApiErrorMsg(c, "Failed to get user group")
		return
	}
	amountRUB, err := getPlategaMoney(req.Amount, group)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}
	common.ApiSuccess(c, amountRUB.StringFixed(2))
}

func RequestPlatega(c *gin.Context) {
	if !isPlategaTopUpEnabled() {
		common.ApiErrorMsg(c, "Platega is not configured")
		return
	}

	var req EpayRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ApiErrorMsg(c, "Invalid request")
		return
	}
	methodID, ok := plategaMethodIDs[req.PaymentMethod]
	if !ok {
		common.ApiErrorMsg(c, "Payment method does not exist")
		return
	}
	if req.Amount < int64(setting.PlategaMinTopUp) {
		common.ApiErrorMsg(c, fmt.Sprintf("Minimum top-up is %d", setting.PlategaMinTopUp))
		return
	}

	userID := c.GetInt("id")
	if rejectInvalidTopUpQuota(c, userID, req.Amount) {
		return
	}
	group, err := model.GetUserGroup(userID, true)
	if err != nil {
		common.ApiErrorMsg(c, "Failed to get user group")
		return
	}
	amountRUB, err := getPlategaMoney(req.Amount, group)
	if err != nil {
		common.ApiErrorMsg(c, err.Error())
		return
	}

	tradeNo := fmt.Sprintf("USR%dNO%s%d", userID, common.GetRandomString(6), time.Now().Unix())
	creditedAmount := req.Amount
	if operation_setting.GetQuotaDisplayType() == operation_setting.QuotaDisplayTypeTokens {
		creditedAmount = decimal.NewFromInt(req.Amount).Div(decimal.NewFromFloat(common.QuotaPerUnit)).IntPart()
	}
	topUp := &model.TopUp{
		UserId: userID, Amount: creditedAmount, Money: amountRUB.InexactFloat64(), TradeNo: tradeNo,
		PaymentMethod: req.PaymentMethod, PaymentProvider: model.PaymentProviderPlatega,
		CreateTime: time.Now().Unix(), Status: common.TopUpStatusPending,
	}
	if err := topUp.Insert(); err != nil {
		logger.LogError(c.Request.Context(), fmt.Sprintf("Platega order insert failed user_id=%d trade_no=%s error=%q", userID, tradeNo, err.Error()))
		common.ApiErrorMsg(c, "Failed to create order")
		return
	}

	checkoutClient := *service.GetHttpClient()
	checkoutClient.Timeout = 15 * time.Second
	checkoutClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	returnURL := paymentReturnPath("/wallet?show_history=true")
	failedURL := paymentReturnPath("/wallet?payment=failed")
	requestContext, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	transaction, err := createPlategaTransaction(requestContext, &checkoutClient, plategaAPIBaseURL, setting.PlategaMerchantID, setting.PlategaAPISecret, plategaCreateTransactionRequest{
		PaymentMethod:  methodID,
		PaymentDetails: plategaPaymentDetails{Amount: amountRUB.InexactFloat64(), Currency: "RUB"},
		Description:    fmt.Sprintf("Wallet top-up: $%d", creditedAmount),
		Return:         returnURL, FailedURL: failedURL, Payload: tradeNo,
		Metadata: map[string]string{"userId": strconv.Itoa(userID), "clientIp": c.ClientIP()},
	})
	if err != nil {
		_ = model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderPlatega, common.TopUpStatusFailed)
		logger.LogError(c.Request.Context(), fmt.Sprintf("Platega checkout failed user_id=%d trade_no=%s error=%q", userID, tradeNo, err.Error()))
		common.ApiErrorMsg(c, "Failed to create payment")
		return
	}

	topUp.ProviderTradeNo = transaction.TransactionID
	if err := topUp.Update(); err != nil {
		_ = model.UpdatePendingTopUpStatus(tradeNo, model.PaymentProviderPlatega, common.TopUpStatusFailed)
		common.ApiErrorMsg(c, "Failed to save payment transaction")
		return
	}
	payLink := transaction.Redirect
	if payLink == "" {
		payLink = transaction.URL
	}
	common.ApiSuccess(c, gin.H{"pay_link": payLink, "amount": amountRUB.StringFixed(2), "currency": "RUB"})
}

func verifyPlategaCallbackCredentials(merchantID string, secret string) bool {
	expectedMerchantID := strings.TrimSpace(setting.PlategaMerchantID)
	expectedSecret := strings.TrimSpace(setting.PlategaAPISecret)
	merchantID = strings.TrimSpace(merchantID)
	secret = strings.TrimSpace(secret)
	if expectedMerchantID == "" || expectedSecret == "" || len(merchantID) != len(expectedMerchantID) || len(secret) != len(expectedSecret) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(merchantID), []byte(expectedMerchantID)) == 1 &&
		subtle.ConstantTimeCompare([]byte(secret), []byte(expectedSecret)) == 1
}

func PlategaWebhook(c *gin.Context) {
	if !isPlategaWebhookEnabled() {
		c.Status(http.StatusNotFound)
		return
	}
	if !verifyPlategaCallbackCredentials(c.GetHeader("X-MerchantId"), c.GetHeader("X-Secret")) {
		c.Status(http.StatusUnauthorized)
		return
	}

	var callback plategaCallback
	if err := common.DecodeJson(io.LimitReader(c.Request.Body, 1<<20), &callback); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	paymentMethod := plategaPaymentMethodName(callback.PaymentMethod)
	if paymentMethod == "" {
		c.Status(http.StatusBadRequest)
		return
	}

	switch strings.ToUpper(callback.Status) {
	case "CONFIRMED":
		_, err := model.RechargePlatega(callback.ID, callback.Amount, strings.ToUpper(callback.Currency), paymentMethod, c.ClientIP())
		if err != nil {
			logger.LogError(c.Request.Context(), fmt.Sprintf("Platega callback settlement failed transaction_id=%s error=%q", callback.ID, err.Error()))
			c.Status(http.StatusConflict)
			return
		}
	case "CANCELED":
		err := model.UpdatePendingTopUpStatusByProviderTradeNo(callback.ID, model.PaymentProviderPlatega, common.TopUpStatusFailed)
		if err != nil && !errors.Is(err, model.ErrTopUpStatusInvalid) {
			c.Status(http.StatusConflict)
			return
		}
	case "CHARGEBACKED":
		logger.LogError(c.Request.Context(), fmt.Sprintf("Platega chargeback requires manual review transaction_id=%s", callback.ID))
	default:
		c.Status(http.StatusBadRequest)
		return
	}
	c.Status(http.StatusOK)
}
