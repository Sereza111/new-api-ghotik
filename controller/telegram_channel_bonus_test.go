package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestTelegramChannelBonusWebhookRequiresTelegramSecretHeader(t *testing.T) {
	previousEnabled := setting.TelegramChannelBonusEnabled
	previousToken := common.TelegramBotToken
	setting.TelegramChannelBonusEnabled = true
	common.TelegramBotToken = "telegram-test-token"
	t.Cleanup(func() {
		setting.TelegramChannelBonusEnabled = previousEnabled
		common.TelegramBotToken = previousToken
	})

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/webhook", TelegramChannelBonusWebhook)

	unauthorized := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(unauthorized, request)
	assert.Equal(t, http.StatusUnauthorized, unauthorized.Code)

	authorized := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/webhook", strings.NewReader(`{}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(
		"X-Telegram-Bot-Api-Secret-Token",
		service.TelegramChannelBonusWebhookSecret(common.TelegramBotToken),
	)
	router.ServeHTTP(authorized, request)
	assert.Equal(t, http.StatusOK, authorized.Code)
}
