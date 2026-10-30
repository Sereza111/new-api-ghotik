package controller

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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

func TestTelegramChannelMemberDepartureMatchesConfiguredChannel(t *testing.T) {
	update := &telegramBonusChatMemberUpdated{
		Date:          time.Unix(1_800_000_000, 0).Unix(),
		Chat:          telegramBonusChat{Username: "VL_API"},
		OldChatMember: telegramBonusChatMember{Status: "member", User: telegramBonusUser{Id: 12345}},
		NewChatMember: telegramBonusChatMember{Status: "left", User: telegramBonusUser{Id: 12345}},
	}

	telegramID, eventTime, ok := telegramChannelMemberDeparture(update, "@VL_API")
	require.True(t, ok)
	assert.Equal(t, int64(12345), telegramID)
	assert.Equal(t, time.Unix(1_800_000_000, 0), eventTime)

	update.Chat.Username = "OTHER_CHANNEL"
	_, _, ok = telegramChannelMemberDeparture(update, "@VL_API")
	assert.False(t, ok)
}

func TestTelegramChannelMemberDepartureIgnoresNonDepartureChanges(t *testing.T) {
	update := &telegramBonusChatMemberUpdated{
		Date:          time.Unix(1_800_000_000, 0).Unix(),
		Chat:          telegramBonusChat{Username: "VL_API"},
		OldChatMember: telegramBonusChatMember{Status: "member", User: telegramBonusUser{Id: 12345}},
		NewChatMember: telegramBonusChatMember{Status: "administrator", User: telegramBonusUser{Id: 12345}},
	}

	_, _, ok := telegramChannelMemberDeparture(update, "@VL_API")
	assert.False(t, ok)
}

func TestTelegramBonusStatusShowsRetentionState(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)

	assert.Equal(t, "доступен после подписки", telegramBonusStatus(nil, now))
	assert.Equal(t, "отозван", telegramBonusStatus(&model.TelegramChannelBonus{
		CreatedAt: now.Add(-time.Hour).Unix(),
		RevokedAt: now.Unix(),
	}, now))
	assert.Equal(t, "закреплён", telegramBonusStatus(&model.TelegramChannelBonus{
		CreatedAt: now.Add(-telegramBonusRevocationWindow).Unix(),
	}, now))
	assert.Equal(t, "начислен · осталось 2 дн.", telegramBonusStatus(&model.TelegramChannelBonus{
		CreatedAt: now.Add(-28*24*time.Hour - time.Hour).Unix(),
	}, now))
}
