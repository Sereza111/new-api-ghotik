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
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
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
	Group         string `json:"group"`
}

type resellerKeyResponse struct {
	Id                 int     `json:"id"`
	ClientLabel        string  `json:"client_label"`
	TokenMillions      int     `json:"token_millions"`
	RemainingTokens    int     `json:"remaining_tokens"`
	UsedTokens         int     `json:"used_tokens"`
	MarkupPercent      int     `json:"markup_percent"`
	Term               string  `json:"term"`
	Endpoint           string  `json:"endpoint"`
	Key                string  `json:"key"`
	CreatedTime        int64   `json:"created_time"`
	ExpiredTime        int64   `json:"expired_time"`
	Status             int     `json:"status"`
	Group              string  `json:"group"`
	Cost               float64 `json:"cost"`
	ClientPrice        float64 `json:"client_price"`
	BaseCostPerMillion float64 `json:"base_cost_per_million"`
}

type resellerAvailableGroup struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Ratio       float64 `json:"ratio"`
}

type resellerSubscriptionResponse struct {
	Active          bool    `json:"active"`
	ExpiresAt       int64   `json:"expires_at"`
	ListPrice       float64 `json:"list_price"`
	DiscountPercent int     `json:"discount_percent"`
	Price           float64 `json:"price"`
	DurationDays    int     `json:"duration_days"`
}

type resellerSubscriptionRequest struct {
	RequestId string `json:"request_id"`
}

type resellerQuotaAdjustmentRequest struct {
	Mode                  string `json:"mode"`
	TokenMillions         *int   `json:"token_millions"`
	ExpectedTotalMillions *int   `json:"expected_total_millions"`
	RequestId             string `json:"request_id"`
}

func GetResellerConfig(c *gin.Context) {
	settings := operation_setting.GetResellerSetting()
	listPrice, paidPrice, err := resellerSubscriptionPrices(settings)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	availableGroups := getResellerAvailableGroups(userGroup)
	activeSubscription, err := model.GetActiveResellerSubscription(c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, gin.H{
		"base_cost_per_million": settings.BaseCostPerMillion,
		"default_endpoint":      strings.TrimRight(settings.Endpoint, "/"),
		"available_groups":      availableGroups,
		"subscription": buildResellerSubscriptionResponse(
			activeSubscription,
			listPrice,
			paidPrice,
			settings.SubscriptionDiscountPercent,
			settings.SubscriptionDurationDays,
		),
	})
}

func PurchaseResellerSubscription(c *gin.Context) {
	request := resellerSubscriptionRequest{}
	if err := c.ShouldBindJSON(&request); err != nil {
		resellerBadRequest(c, "invalid reseller subscription request")
		return
	}
	requestID, ok := normalizeResellerRequestID(c, request.RequestId)
	if !ok {
		resellerBadRequest(c, "request_id is required and must be a printable value of at most 128 characters")
		return
	}
	userID := c.GetInt("id")
	existingSubscription, err := model.GetResellerSubscriptionByRequestID(userID, requestID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if existingSubscription != nil {
		purchasedListPrice, parseErr := decimal.NewFromString(existingSubscription.ListPrice)
		if parseErr != nil {
			common.ApiError(c, parseErr)
			return
		}
		purchasedPrice, parseErr := decimal.NewFromString(existingSubscription.PaidPrice)
		if parseErr != nil {
			common.ApiError(c, parseErr)
			return
		}
		common.ApiSuccess(c, buildResellerSubscriptionResponse(
			existingSubscription,
			purchasedListPrice,
			purchasedPrice,
			existingSubscription.DiscountPercent,
			existingSubscription.DurationDays,
		))
		return
	}
	if !requirePaymentCompliance(c) {
		return
	}
	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if len(getResellerAvailableGroups(userGroup)) == 0 {
		resellerStatusError(c, http.StatusForbidden, "no routing groups are available for reseller keys")
		return
	}

	settings := operation_setting.GetResellerSetting()
	listPrice, paidPrice, err := resellerSubscriptionPrices(settings)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	walletQuota, err := common.WalletQuotaFromDecimalStrict(paidPrice.Mul(decimal.NewFromFloat(common.QuotaPerUnit)))
	if err != nil || walletQuota <= 0 {
		if err == nil {
			err = fmt.Errorf("reseller subscription price is too small")
		}
		common.ApiError(c, err)
		return
	}
	created, subscription, err := model.PurchaseResellerSubscription(model.ResellerSubscriptionPurchase{
		UserId:          userID,
		ListPrice:       listPrice.StringFixed(2),
		DiscountPercent: settings.SubscriptionDiscountPercent,
		PaidPrice:       paidPrice.StringFixed(2),
		ChargedQuota:    walletQuota,
		DurationDays:    settings.SubscriptionDurationDays,
		RequestId:       requestID,
	})
	if err != nil {
		switch {
		case errors.Is(err, model.ErrResellerSubscriptionWalletInsufficient):
			resellerStatusError(c, http.StatusForbidden, err.Error())
		case errors.Is(err, model.ErrResellerSubscriptionAlreadyActive):
			resellerStatusError(c, http.StatusConflict, err.Error())
		default:
			common.ApiError(c, err)
		}
		return
	}
	if created {
		model.RecordLog(c.GetInt("id"), model.LogTypeManage, fmt.Sprintf("Purchased reseller subscription for %s USD", subscription.PaidPrice))
	}
	purchasedListPrice, parseErr := decimal.NewFromString(subscription.ListPrice)
	if parseErr != nil {
		common.ApiError(c, parseErr)
		return
	}
	purchasedPrice, parseErr := decimal.NewFromString(subscription.PaidPrice)
	if parseErr != nil {
		common.ApiError(c, parseErr)
		return
	}
	common.ApiSuccess(c, buildResellerSubscriptionResponse(
		subscription,
		purchasedListPrice,
		purchasedPrice,
		subscription.DiscountPercent,
		subscription.DurationDays,
	))
}

func getResellerAvailableGroups(userGroup string) []resellerAvailableGroup {
	usableGroups := service.GetUserUsableGroups(userGroup)
	groupNames := make([]string, 0, len(usableGroups))
	for name := range usableGroups {
		if isResellerGroupAvailable(userGroup, name) {
			groupNames = append(groupNames, name)
		}
	}
	sort.Strings(groupNames)
	availableGroups := make([]resellerAvailableGroup, 0, len(groupNames))
	for _, name := range groupNames {
		availableGroups = append(availableGroups, resellerAvailableGroup{
			Name:        name,
			Description: usableGroups[name],
			Ratio:       service.GetUserGroupRatio(userGroup, name),
		})
	}
	return availableGroups
}

func isResellerGroupAvailable(userGroup string, group string) bool {
	return service.IsUserSelectableGroup(userGroup, group) &&
		len(model.GetGroupEnabledModels(group)) > 0
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

func DeleteResellerKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		resellerBadRequest(c, "invalid reseller key id")
		return
	}
	if err := model.DeleteResellerToken(id, c.GetInt("id")); err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(c.GetInt("id"), model.LogTypeManage, fmt.Sprintf("Deleted reseller key %d without quota refund", id))
	common.ApiSuccess(c, nil)
}

func ReissueResellerKey(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		resellerBadRequest(c, "invalid reseller key id")
		return
	}
	record, err := model.ReissueResellerToken(id, c.GetInt("id"))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.RecordLog(c.GetInt("id"), model.LogTypeManage, fmt.Sprintf("Reissued reseller key %d", id))
	common.ApiSuccess(c, buildResellerKeyResponse(&record.Token, &record.Metadata, true))
}

func AdjustResellerKeyQuota(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		resellerBadRequest(c, "invalid reseller key id")
		return
	}
	request := resellerQuotaAdjustmentRequest{}
	if err := c.ShouldBindJSON(&request); err != nil || request.TokenMillions == nil || request.ExpectedTotalMillions == nil {
		resellerBadRequest(c, "invalid reseller quota adjustment request")
		return
	}
	mode := strings.ToLower(strings.TrimSpace(request.Mode))
	if mode != model.ResellerQuotaAdjustmentAdd && mode != model.ResellerQuotaAdjustmentSubtract &&
		mode != model.ResellerQuotaAdjustmentSet {
		resellerBadRequest(c, "quota mode must be add, subtract, or set")
		return
	}
	if *request.TokenMillions <= 0 || *request.TokenMillions > resellerMaxTokenMillions {
		resellerBadRequest(c, "token amount must be between 1 and 1000 whole millions")
		return
	}
	if *request.ExpectedTotalMillions < resellerMinTokenMillions || *request.ExpectedTotalMillions > resellerMaxTokenMillions {
		resellerBadRequest(c, "expected total must be between 1 and 1000 whole millions")
		return
	}
	requestID, ok := normalizeResellerRequestID(c, request.RequestId)
	if !ok {
		resellerBadRequest(c, "request_id is required and must be a printable value of at most 128 characters")
		return
	}

	userID := c.GetInt("id")
	record, applied, err := model.AdjustResellerTokenQuota(
		id, userID, mode, *request.TokenMillions, *request.ExpectedTotalMillions, requestID, false,
	)
	if errors.Is(err, model.ErrResellerQuotaPurchaseRequired) {
		if !requirePaymentCompliance(c) {
			return
		}
		current, lookupErr := model.GetUserResellerKeyByTokenID(userID, id)
		if lookupErr != nil {
			if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
				resellerStatusError(c, http.StatusNotFound, "reseller key not found")
			} else {
				common.ApiError(c, lookupErr)
			}
			return
		}
		userGroup, groupErr := getTokenRequestUserGroup(c)
		if groupErr != nil {
			common.ApiError(c, groupErr)
			return
		}
		if !isResellerGroupAvailable(userGroup, current.Token.Group) {
			resellerStatusError(c, http.StatusForbidden, "the reseller key routing group is no longer available")
			return
		}
		record, applied, err = model.AdjustResellerTokenQuota(
			id, userID, mode, *request.TokenMillions, *request.ExpectedTotalMillions, requestID, true,
		)
	}
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			resellerStatusError(c, http.StatusNotFound, "reseller key not found")
		case errors.Is(err, model.ErrResellerTokenQuotaInsufficient),
			errors.Is(err, model.ErrResellerQuotaAllocationOutOfRange),
			errors.Is(err, model.ErrResellerQuotaAdjustmentInvalid):
			resellerBadRequest(c, err.Error())
		case errors.Is(err, model.ErrResellerSubscriptionRequired),
			errors.Is(err, model.ErrResellerQuotaWalletInsufficient):
			resellerStatusError(c, http.StatusForbidden, err.Error())
		case errors.Is(err, model.ErrResellerQuotaOperationConflict),
			errors.Is(err, model.ErrResellerQuotaStateConflict),
			errors.Is(err, model.ErrResellerQuotaKeyExpired):
			resellerStatusError(c, http.StatusConflict, err.Error())
		case errors.Is(err, model.ErrResellerQuotaPurchaseRequired):
			resellerStatusError(c, http.StatusConflict, err.Error())
		default:
			common.ApiError(c, err)
		}
		return
	}
	if applied {
		model.RecordLog(userID, model.LogTypeManage, fmt.Sprintf(
			"Adjusted reseller key %d quota: mode=%s, expected_total=%d, amount=%s million tokens, remaining=%d tokens",
			id, mode, *request.ExpectedTotalMillions, strconv.Itoa(*request.TokenMillions), record.Token.RemainQuota,
		))
	}
	common.ApiSuccess(c, buildResellerKeyResponse(&record.Token, &record.Metadata, false))
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
	userID := c.GetInt("id")
	existingRecord, err := model.GetResellerKeyByRequestID(userID, requestID)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if existingRecord != nil {
		common.ApiSuccess(c, buildResellerKeyResponse(&existingRecord.Token, &existingRecord.Metadata, true))
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
	request.Group = strings.TrimSpace(request.Group)
	userGroup, err := getTokenRequestUserGroup(c)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if !isResellerGroupAvailable(userGroup, request.Group) {
		resellerBadRequest(c, "a concrete available routing group is required")
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

	count, err := model.CountUserTokens(userID)
	if err != nil {
		common.ApiError(c, err)
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
		UserId:         userID,
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
		Group:          request.Group,
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
		switch {
		case errors.Is(err, model.ErrResellerSubscriptionRequired):
			resellerStatusError(c, http.StatusForbidden, err.Error())
		case errors.Is(err, model.ErrResellerTokenLimitReached):
			resellerBadRequest(c, "Maximum API key limit reached")
		default:
			common.ApiError(c, err)
		}
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
	baseCostPerMillion, _ := baseCost.Float64()
	endpoint := strings.TrimRight(operation_setting.GetResellerSetting().Endpoint, "/")
	key := "sk-" + token.GetMaskedKey()
	if revealKey {
		key = "sk-" + token.GetFullKey()
	}
	return resellerKeyResponse{
		Id:                 token.Id,
		ClientLabel:        token.Name,
		TokenMillions:      metadata.TokenMillions,
		RemainingTokens:    token.RemainQuota,
		UsedTokens:         token.UsedQuota,
		MarkupPercent:      metadata.MarkupPercent,
		Term:               resellerTerm(token),
		Endpoint:           endpoint,
		Key:                key,
		CreatedTime:        metadata.CreatedTime,
		ExpiredTime:        token.ExpiredTime,
		Status:             token.Status,
		Group:              token.Group,
		Cost:               cost,
		ClientPrice:        clientPrice,
		BaseCostPerMillion: baseCostPerMillion,
	}
}

func resellerBadRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{
		"success": false,
		"message": message,
	})
}

func resellerStatusError(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"success": false,
		"message": message,
	})
}

func resellerSubscriptionPrices(settings operation_setting.ResellerSetting) (decimal.Decimal, decimal.Decimal, error) {
	if math.IsNaN(settings.SubscriptionPrice) || math.IsInf(settings.SubscriptionPrice, 0) ||
		settings.SubscriptionPrice < operation_setting.ResellerSubscriptionMinPrice ||
		settings.SubscriptionPrice > operation_setting.ResellerSubscriptionMaxPrice ||
		settings.SubscriptionDiscountPercent < 0 ||
		settings.SubscriptionDiscountPercent > operation_setting.ResellerSubscriptionMaxDiscountPercent ||
		settings.SubscriptionDurationDays < operation_setting.ResellerSubscriptionMinDurationDays ||
		settings.SubscriptionDurationDays > operation_setting.ResellerSubscriptionMaxDurationDays {
		return decimal.Zero, decimal.Zero, errors.New("invalid reseller subscription settings")
	}
	listPrice := decimal.NewFromFloat(settings.SubscriptionPrice).Round(2)
	paidPrice := listPrice.
		Mul(decimal.NewFromInt(int64(100 - settings.SubscriptionDiscountPercent))).
		Div(decimal.NewFromInt(100)).
		Round(2)
	minimumPrice := decimal.NewFromFloat(operation_setting.ResellerSubscriptionMinPrice)
	if paidPrice.LessThan(minimumPrice) {
		paidPrice = minimumPrice
	}
	return listPrice, paidPrice, nil
}

func buildResellerSubscriptionResponse(
	subscription *model.ResellerSubscription,
	listPrice decimal.Decimal,
	paidPrice decimal.Decimal,
	discountPercent int,
	durationDays int,
) resellerSubscriptionResponse {
	listPriceFloat, _ := listPrice.Float64()
	paidPriceFloat, _ := paidPrice.Float64()
	response := resellerSubscriptionResponse{
		ListPrice:       listPriceFloat,
		DiscountPercent: discountPercent,
		Price:           paidPriceFloat,
		DurationDays:    durationDays,
	}
	if subscription != nil {
		response.Active = subscription.IsActiveAt(common.GetTimestamp())
		response.ExpiresAt = subscription.EndTime
	}
	return response
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
