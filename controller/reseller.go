/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

const (
	resellerMinTokenMillions = 1
	resellerMaxTokenMillions = 1000
)

type resellerKeyRequest struct {
	ClientLabel   string `json:"client_label"`
	TokenMillions int    `json:"token_millions"`
	MarkupPercent int    `json:"markup_percent"`
	Term          string `json:"term"`
	Endpoint      string `json:"endpoint"`
	RequestId     string `json:"request_id"`
}

type resellerKeyResponse struct {
	Id              int     `json:"id"`
	ClientLabel     string  `json:"client_label"`
	TokenMillions   int     `json:"token_millions"`
	RemainingTokens int     `json:"remaining_tokens"`
	UsedTokens      int     `json:"used_tokens"`
	MarkupPercent   int     `json:"markup_percent"`
	Term            string  `json:"term"`
	Endpoint        string  `json:"endpoint"`
	Key             string  `json:"key"`
	CreatedTime     int64   `json:"created_time"`
	ExpiredTime     int64   `json:"expired_time"`
	Status          int     `json:"status"`
	Cost            float64 `json:"cost"`
	ClientPrice     float64 `json:"client_price"`
}

func GetResellerConfig(c *gin.Context) {
	settings := operation_setting.GetResellerSetting()
	common.ApiSuccess(c, gin.H{
		"base_cost_per_million": settings.BaseCostPerMillion,
		"default_endpoint":      strings.TrimRight(settings.Endpoint, "/"),
	})
}

func GetResellerKeys(c *gin.Context) {
	records, err := model.GetAllUserResellerKeys(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}

	items := make([]resellerKeyResponse, 0, len(records))
	for _, record := range records {
		items = append(items, buildResellerKeyResponse(&record.Token, &record.Metadata, false))
	}
	common.ApiSuccess(c, items)
}

func AddResellerKey(c *gin.Context) {
	request := resellerKeyRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		resellerBadRequest(c, "invalid reseller key request")
		return
	}
	requestID, ok := normalizeResellerRequestID(c, request.RequestId)
	if !ok {
		resellerBadRequest(c, "request_id is required and must be a printable value of at most 128 characters")
		return
	}

	request.ClientLabel = strings.TrimSpace(request.ClientLabel)
	if utf8.RuneCountInString(request.ClientLabel) > 50 {
		resellerBadRequest(c, "client label cannot exceed 50 characters")
		return
	}
	if request.TokenMillions < resellerMinTokenMillions || request.TokenMillions > resellerMaxTokenMillions {
		resellerBadRequest(c, "token amount must be between 1 and 1000 million")
		return
	}
	if !isResellerMarkupAllowed(request.MarkupPercent) {
		resellerBadRequest(c, "invalid reseller markup")
		return
	}

	now := common.GetTimestamp()
	expiredTime, ok := resellerExpiration(request.Term, now)
	if !ok {
		resellerBadRequest(c, "invalid reseller key duration")
		return
	}
	settings := operation_setting.GetResellerSetting()
	baseCostPerMillion := decimal.NewFromFloat(settings.BaseCostPerMillion).Round(2)
	purchaseCost := decimal.NewFromInt(int64(request.TokenMillions)).Mul(baseCostPerMillion).Round(2)
	walletQuota, err := common.WalletQuotaFromDecimalStrict(purchaseCost.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || walletQuota <= 0 {
		if err == nil {
			err = fmt.Errorf("reseller package cost is too small")
		}
		common.ApiError(c, err)
		return
	}
	endpoint := strings.TrimRight(settings.Endpoint, "/")
	if requestedEndpoint := strings.TrimRight(strings.TrimSpace(request.Endpoint), "/"); requestedEndpoint != "" && requestedEndpoint != endpoint {
		resellerBadRequest(c, "reseller endpoint is managed by the administrator")
		return
	}

	count, err := model.CountUserTokens(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if int(count) >= operation_setting.GetMaxUserTokens() {
		resellerBadRequest(c, fmt.Sprintf("maximum API key limit reached (%d)", operation_setting.GetMaxUserTokens()))
		return
	}

	key, err := model.NewResellerTokenKey()
	if err != nil {
		common.ApiError(c, err)
		return
	}
	clientLabel := request.ClientLabel
	if clientLabel == "" {
		clientLabel = fmt.Sprintf("Reseller key %d", count+1)
	}
	token := model.Token{
		UserId:         c.GetInt("id"),
		Key:            key,
		Status:         common.TokenStatusEnabled,
		Name:           clientLabel,
		CreatedTime:    now,
		AccessedTime:   now,
		ExpiredTime:    expiredTime,
		RemainQuota:    request.TokenMillions * 1_000_000,
		UnlimitedQuota: false,
		QuotaMode:      model.TokenQuotaModeTokens,
		AllowIps:       common.GetPointer(""),
	}
	metadata := model.ResellerKey{
		UserId:             token.UserId,
		TokenMillions:      request.TokenMillions,
		MarkupPercent:      request.MarkupPercent,
		BaseCostPerMillion: baseCostPerMillion.StringFixed(2),
		Endpoint:           endpoint,
		CreatedTime:        now,
	}
	_, record, err := model.CreatePrepaidResellerTokenWithRequestID(&token, &metadata, walletQuota, requestID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if record == nil {
		common.ApiErrorMsg(c, "insufficient balance to issue reseller key")
		return
	}
	// A repeated request_id returns the original record without another debit;
	// expose the raw secret only through this authenticated POST replay.
	response := buildResellerKeyResponse(&record.Token, &record.Metadata, true)
	common.ApiSuccess(c, response)
}

func normalizeResellerRequestID(c *gin.Context, bodyValue string) (string, bool) {
	bodyValue = strings.TrimSpace(bodyValue)
	headerValue := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
	if bodyValue != "" && headerValue != "" && bodyValue != headerValue {
		return "", false
	}
	requestID := bodyValue
	if requestID == "" {
		requestID = headerValue
	}
	if requestID == "" || utf8.RuneCountInString(requestID) > 128 || strings.IndexFunc(requestID, unicode.IsControl) >= 0 {
		return "", false
	}
	return requestID, true
}

func buildResellerKeyResponse(token *model.Token, metadata *model.ResellerKey, revealKey bool) resellerKeyResponse {
	baseCost, err := decimal.NewFromString(metadata.BaseCostPerMillion)
	if err != nil {
		baseCost = decimal.Zero
	}
	costDecimal := decimal.NewFromInt(int64(metadata.TokenMillions)).Mul(baseCost).Round(2)
	clientPriceDecimal := costDecimal.Mul(decimal.NewFromInt(int64(100 + metadata.MarkupPercent))).Div(decimal.NewFromInt(100)).Round(2)
	cost, _ := costDecimal.Float64()
	clientPrice, _ := clientPriceDecimal.Float64()
	endpoint := strings.TrimRight(operation_setting.GetResellerSetting().Endpoint, "/")
	key := "sk-" + token.GetMaskedKey()
	if revealKey {
		key = "sk-" + token.GetFullKey()
	}
	return resellerKeyResponse{
		Id:              token.Id,
		ClientLabel:     token.Name,
		TokenMillions:   metadata.TokenMillions,
		RemainingTokens: token.RemainQuota,
		UsedTokens:      token.UsedQuota,
		MarkupPercent:   metadata.MarkupPercent,
		Term:            resellerTerm(token),
		Endpoint:        endpoint,
		Key:             key,
		CreatedTime:     metadata.CreatedTime,
		ExpiredTime:     token.ExpiredTime,
		Status:          token.Status,
		Cost:            cost,
		ClientPrice:     clientPrice,
	}
}

func resellerBadRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{
		"success": false,
		"message": message,
	})
}

func isResellerMarkupAllowed(value int) bool {
	switch value {
	case 20, 50, 80, 100:
		return true
	default:
		return false
	}
}

func resellerExpiration(term string, now int64) (int64, bool) {
	switch term {
	case "unlimited":
		return -1, true
	case "7-days":
		return now + int64(7*24*time.Hour/time.Second), true
	case "30-days":
		return now + int64(30*24*time.Hour/time.Second), true
	case "90-days":
		return now + int64(90*24*time.Hour/time.Second), true
	default:
		return 0, false
	}
}

func resellerTerm(token *model.Token) string {
	if token.ExpiredTime < 0 {
		return "unlimited"
	}
	days := (token.ExpiredTime - token.CreatedTime) / int64(24*time.Hour/time.Second)
	switch days {
	case 7:
		return "7-days"
	case 30:
		return "30-days"
	case 90:
		return "90-days"
	default:
		return "unlimited"
	}
}
