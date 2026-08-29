package controller

import (
	"context"
	"crypto/hmac"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
	"github.com/gin-gonic/gin"
)

const telegramChannelBonusCallback = "claim_channel_bonus"

type telegramBonusUser struct {
	Id int64 `json:"id"`
}

type telegramBonusChat struct {
	Id int64 `json:"id"`
}

type telegramBonusMessage struct {
	Text string             `json:"text"`
	From *telegramBonusUser `json:"from"`
	Chat telegramBonusChat  `json:"chat"`
}

type telegramBonusCallbackQuery struct {
	Id      string                `json:"id"`
	Data    string                `json:"data"`
	From    telegramBonusUser     `json:"from"`
	Message *telegramBonusMessage `json:"message"`
}

type telegramBonusUpdate struct {
	Message       *telegramBonusMessage       `json:"message"`
	CallbackQuery *telegramBonusCallbackQuery `json:"callback_query"`
}

func ConfigureTelegramChannelBonusWebhook(c *gin.Context) {
	if !setting.TelegramChannelBonusEnabled {
		common.ApiErrorMsg(c, "Telegram 订阅奖励未启用")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	if err := service.ConfigureTelegramChannelBonusWebhook(ctx); err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "telegram.channel_bonus.webhook.configure", nil)
	c.JSON(http.StatusOK, gin.H{"success": true, "message": ""})
}

func TelegramChannelBonusWebhook(c *gin.Context) {
	if !setting.TelegramChannelBonusEnabled || strings.TrimSpace(common.TelegramBotToken) == "" {
		c.Status(http.StatusNotFound)
		return
	}
	expectedSecret := service.TelegramChannelBonusWebhookSecret(common.TelegramBotToken)
	providedSecret := c.GetHeader("X-Telegram-Bot-Api-Secret-Token")
	if !hmac.Equal([]byte(providedSecret), []byte(expectedSecret)) {
		c.Status(http.StatusUnauthorized)
		return
	}

	var update telegramBonusUpdate
	if err := common.DecodeJson(c.Request.Body, &update); err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	c.Status(http.StatusOK)

	if update.CallbackQuery != nil {
		handleTelegramChannelBonusCallback(c.Request.Context(), update.CallbackQuery)
		return
	}
	if update.Message != nil {
		handleTelegramChannelBonusMessage(c.Request.Context(), update.Message)
	}
}

func handleTelegramChannelBonusMessage(ctx context.Context, message *telegramBonusMessage) {
	if message.From == nil || message.Chat.Id == 0 {
		return
	}
	fields := strings.Fields(strings.TrimSpace(message.Text))
	if len(fields) == 0 {
		return
	}
	command := strings.ToLower(fields[0])
	command = strings.SplitN(command, "@", 2)[0]
	if command != "/start" && command != "/bonus" {
		return
	}

	user := &model.User{TelegramId: strconv.FormatInt(message.From.Id, 10)}
	if err := user.FillUserByTelegramId(); err != nil || user.Status != common.UserStatusEnabled {
		sendTelegramAccountBindingPrompt(ctx, message.Chat.Id)
		return
	}
	sendTelegramChannelBonusPrompt(ctx, message.Chat.Id)
}

func handleTelegramChannelBonusCallback(ctx context.Context, callback *telegramBonusCallbackQuery) {
	if callback.Data != telegramChannelBonusCallback || callback.Id == "" || callback.Message == nil {
		return
	}

	isMember, err := service.TelegramIsChannelMember(ctx, setting.TelegramChannelBonusChannel, callback.From.Id)
	if err != nil {
		common.SysError("Telegram channel membership check failed: " + err.Error())
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "Не удалось проверить подписку. Попробуйте ещё раз позже.", true)
		return
	}
	if !isMember {
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "Сначала подпишитесь на канал, затем повторите проверку.", true)
		return
	}

	quota := common.QuotaFromFloat(setting.TelegramChannelBonusAmountUSD * common.QuotaPerUnit)
	bonus, err := model.ClaimTelegramChannelBonus(
		strconv.FormatInt(callback.From.Id, 10),
		setting.TelegramChannelBonusChannel,
		quota,
	)
	if err != nil {
		switch {
		case errors.Is(err, model.ErrTelegramChannelBonusAlreadyClaimed):
			_ = service.TelegramAnswerCallback(ctx, callback.Id, "Бонус уже был начислен на ваш аккаунт.", true)
		case errors.Is(err, model.ErrTelegramChannelBonusUserNotFound):
			_ = service.TelegramAnswerCallback(ctx, callback.Id, "Сначала привяжите Telegram в профиле New API.", true)
			sendTelegramAccountBindingPrompt(ctx, callback.Message.Chat.Id)
		case errors.Is(err, model.ErrTelegramChannelBonusUserDisabled):
			_ = service.TelegramAnswerCallback(ctx, callback.Id, "Аккаунт отключён. Обратитесь в поддержку.", true)
		default:
			common.SysError("Telegram channel bonus claim failed: " + err.Error())
			_ = service.TelegramAnswerCallback(ctx, callback.Id, "Не удалось начислить бонус. Попробуйте ещё раз позже.", true)
		}
		return
	}

	reward := fmt.Sprintf("$%.2f", setting.TelegramChannelBonusAmountUSD)
	model.RecordLog(bonus.UserId, model.LogTypeTopup, fmt.Sprintf("Бонус %s за подписку на Telegram-канал %s", logger.LogQuota(bonus.QuotaAwarded), bonus.Channel))
	_ = service.TelegramAnswerCallback(ctx, callback.Id, "Готово! Бонус "+reward+" начислен на баланс.", true)
	_ = service.TelegramSendMessage(ctx, callback.Message.Chat.Id,
		"<b>Бонус начислен</b>\n\nНа баланс вашего аккаунта New API добавлено <b>"+reward+"</b>.", nil)
}

func sendTelegramChannelBonusPrompt(ctx context.Context, chatId int64) {
	channel, channelURL, err := service.NormalizeTelegramChannel(setting.TelegramChannelBonusChannel)
	if err != nil {
		common.SysError("Telegram channel bonus configuration is invalid: " + err.Error())
		return
	}
	reward := fmt.Sprintf("$%.2f", setting.TelegramChannelBonusAmountUSD)
	text := "<b>Бонус за подписку</b>\n\nПодпишитесь на канал <b>" + html.EscapeString(channel) +
		"</b> и получите <b>" + reward + "</b> на баланс New API. Бонус доступен один раз."
	buttons := [][]service.TelegramInlineButton{
		{{Text: "Подписаться на канал", URL: channelURL}},
		{{Text: "Проверить подписку", CallbackData: telegramChannelBonusCallback}},
	}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram channel bonus prompt failed: " + err.Error())
	}
}

func sendTelegramAccountBindingPrompt(ctx context.Context, chatId int64) {
	profileURL := strings.TrimRight(system_setting.ServerAddress, "/") + "/profile"
	text := "<b>Сначала привяжите Telegram</b>\n\nВойдите в New API, откройте профиль и привяжите этот Telegram-аккаунт. После этого вернитесь сюда и отправьте /bonus."
	buttons := [][]service.TelegramInlineButton{{{Text: "Открыть профиль New API", URL: profileURL}}}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram account binding prompt failed: " + err.Error())
	}
}
