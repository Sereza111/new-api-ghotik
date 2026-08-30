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

const (
	telegramProfileCallback       = "show_profile"
	telegramBonusMenuCallback     = "show_channel_bonus"
	telegramMainMenuCallback      = "show_main_menu"
	telegramBonusRevocationWindow = 30 * 24 * time.Hour
)

type telegramBonusUser struct {
	Id        int64  `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Username  string `json:"username"`
}

type telegramBonusChat struct {
	Id       int64  `json:"id"`
	Username string `json:"username"`
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

type telegramBonusChatMember struct {
	Status   string            `json:"status"`
	IsMember bool              `json:"is_member"`
	User     telegramBonusUser `json:"user"`
}

type telegramBonusChatMemberUpdated struct {
	Chat          telegramBonusChat       `json:"chat"`
	Date          int64                   `json:"date"`
	OldChatMember telegramBonusChatMember `json:"old_chat_member"`
	NewChatMember telegramBonusChatMember `json:"new_chat_member"`
}

type telegramBonusUpdate struct {
	Message       *telegramBonusMessage           `json:"message"`
	CallbackQuery *telegramBonusCallbackQuery     `json:"callback_query"`
	ChatMember    *telegramBonusChatMemberUpdated `json:"chat_member"`
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
	if (!setting.TelegramChannelBonusEnabled && !common.TelegramOAuthEnabled) || strings.TrimSpace(common.TelegramBotToken) == "" {
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
		return
	}
	if update.ChatMember != nil {
		handleTelegramChannelMemberUpdate(c.Request.Context(), update.ChatMember)
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
	switch command {
	case "/start":
		if len(fields) == 2 && handleTelegramAuthenticationStart(ctx, message.Chat.Id, message.From, fields[1]) {
			return
		}
		if !telegramUserIsLinked(message.From.Id) {
			sendTelegramAccountBindingPrompt(ctx, message.Chat.Id)
			return
		}
		sendTelegramMainMenu(ctx, message.Chat.Id)
	case "/profile":
		sendTelegramProfile(ctx, message.Chat.Id, message.From.Id)
	case "/bonus":
		if !telegramUserIsLinked(message.From.Id) {
			sendTelegramAccountBindingPrompt(ctx, message.Chat.Id)
			return
		}
		sendTelegramChannelBonusPrompt(ctx, message.Chat.Id)
	case "/help":
		sendTelegramHelp(ctx, message.Chat.Id)
	}
}

func handleTelegramAuthenticationStart(ctx context.Context, chatId int64, from *telegramBonusUser, parameter string) bool {
	if from == nil || chatId != from.Id {
		return false
	}
	purpose := ""
	flowToken := ""
	switch {
	case strings.HasPrefix(parameter, "login_"):
		purpose = model.AuthFlowPurposeTelegramLogin
		flowToken = strings.TrimPrefix(parameter, "login_")
	case strings.HasPrefix(parameter, "bind_"):
		purpose = model.AuthFlowPurposeTelegramBind
		flowToken = strings.TrimPrefix(parameter, "bind_")
	default:
		return false
	}
	if flowToken == "" {
		return false
	}

	match := model.AuthFlowMatch{Purpose: purpose}
	flow, err := model.GetAuthFlow(flowToken, match)
	if err != nil {
		_ = service.TelegramSendMessage(ctx, chatId,
			"🖤 <b>Ссылка устарела</b>\n\nВернитесь на сайт и начните вход через Telegram ещё раз.", nil)
		return true
	}
	var current telegramLoginFlowPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &current); err != nil {
		common.SysError("Telegram auth flow payload decode failed: " + err.Error())
		_ = service.TelegramSendMessage(ctx, chatId, "Не удалось подтвердить вход. Попробуйте ещё раз.", nil)
		return true
	}
	if current.TelegramId != "" {
		if current.TelegramId == strconv.FormatInt(from.Id, 10) {
			_ = service.TelegramSendMessage(ctx, chatId,
				"🖤 <b>Вход уже подтверждён</b>\n\nВернитесь во вкладку VL API — она завершит вход автоматически.", nil)
		} else {
			_ = service.TelegramSendMessage(ctx, chatId, "Эта ссылка уже была использована.", nil)
		}
		return true
	}
	payload, err := common.Marshal(telegramLoginFlowPayload{
		TelegramId: strconv.FormatInt(from.Id, 10),
		Username:   from.Username,
		FirstName:  from.FirstName,
		LastName:   from.LastName,
	})
	if err != nil {
		common.SysError("Telegram auth flow payload encode failed: " + err.Error())
		return true
	}
	if err := model.CompareAndSwapAuthFlowPayload(flowToken, match, flow.Payload, string(payload)); err != nil {
		_ = service.TelegramSendMessage(ctx, chatId, "Эта ссылка устарела или уже была использована.", nil)
		return true
	}

	action := "вход"
	if purpose == model.AuthFlowPurposeTelegramBind {
		action = "привязку аккаунта"
	}
	_ = service.TelegramSendMessage(ctx, chatId,
		"🖤 <b>Telegram подтверждён</b>\n\nВернитесь во вкладку VL API — она завершит "+action+" автоматически.", nil)
	return true
}

func handleTelegramChannelBonusCallback(ctx context.Context, callback *telegramBonusCallbackQuery) {
	if callback.Id == "" || callback.Message == nil {
		return
	}

	switch callback.Data {
	case telegramChannelBonusCallback:
		handleTelegramChannelBonusClaim(ctx, callback)
	case telegramProfileCallback:
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "", false)
		sendTelegramProfile(ctx, callback.Message.Chat.Id, callback.From.Id)
	case telegramBonusMenuCallback:
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "", false)
		if !telegramUserIsLinked(callback.From.Id) {
			sendTelegramAccountBindingPrompt(ctx, callback.Message.Chat.Id)
			return
		}
		sendTelegramChannelBonusPrompt(ctx, callback.Message.Chat.Id)
	case telegramMainMenuCallback:
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "", false)
		sendTelegramMainMenu(ctx, callback.Message.Chat.Id)
	}
}

func handleTelegramChannelBonusClaim(ctx context.Context, callback *telegramBonusCallbackQuery) {
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
	channel, _, err := service.NormalizeTelegramChannel(setting.TelegramChannelBonusChannel)
	if err != nil {
		common.SysError("Telegram channel bonus configuration is invalid: " + err.Error())
		_ = service.TelegramAnswerCallback(ctx, callback.Id, "Настройка канала временно недоступна.", true)
		return
	}
	bonus, err := model.ClaimTelegramChannelBonus(
		strconv.FormatInt(callback.From.Id, 10),
		channel,
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
		"🖤 <b>Бонус начислен</b>\n\nНа баланс вашего аккаунта New API добавлено <b>"+reward+"</b>. Сохраните подписку на канал минимум на 30 дней.", telegramBackToMenuButtons())
}

func handleTelegramChannelMemberUpdate(ctx context.Context, update *telegramBonusChatMemberUpdated) {
	telegramID, eventTime, ok := telegramChannelMemberDeparture(update, setting.TelegramChannelBonusChannel)
	if !ok {
		return
	}

	channel, _, err := service.NormalizeTelegramChannel(setting.TelegramChannelBonusChannel)
	if err != nil {
		common.SysError("Telegram channel bonus configuration is invalid: " + err.Error())
		return
	}
	bonus, revoked, err := model.RevokeTelegramChannelBonus(
		strconv.FormatInt(telegramID, 10),
		channel,
		eventTime,
		telegramBonusRevocationWindow,
	)
	if err != nil {
		common.SysError("Telegram channel bonus revocation failed: " + err.Error())
		return
	}
	if !revoked {
		return
	}

	reward := telegramQuotaUSD(bonus.QuotaAwarded)
	model.RecordLog(bonus.UserId, model.LogTypeTopup, fmt.Sprintf("Списание %s: отписка от Telegram-канала %s в течение 30 дней", logger.LogQuota(bonus.QuotaAwarded), bonus.Channel))
	text := "🖤 <b>Бонус отозван</b>\n\nВы отписались от канала раньше чем через 30 дней, поэтому <b>" + reward + "</b> списано с баланса. Повторно получить этот бонус нельзя."
	if err := service.TelegramSendMessage(ctx, telegramID, text, telegramBackToMenuButtons()); err != nil {
		common.SysError("Telegram channel bonus revocation notice failed: " + err.Error())
	}
}

func telegramChannelMemberDeparture(update *telegramBonusChatMemberUpdated, configuredChannel string) (int64, time.Time, bool) {
	if update == nil || update.Date <= 0 {
		return 0, time.Time{}, false
	}
	channel, _, err := service.NormalizeTelegramChannel(configuredChannel)
	if err != nil || !strings.EqualFold(channel, "@"+strings.TrimPrefix(update.Chat.Username, "@")) {
		return 0, time.Time{}, false
	}
	if !service.TelegramChannelMemberStatusIsActive(update.OldChatMember.Status, update.OldChatMember.IsMember) ||
		service.TelegramChannelMemberStatusIsActive(update.NewChatMember.Status, update.NewChatMember.IsMember) {
		return 0, time.Time{}, false
	}
	telegramID := update.NewChatMember.User.Id
	if telegramID == 0 {
		telegramID = update.OldChatMember.User.Id
	}
	if telegramID == 0 {
		return 0, time.Time{}, false
	}
	return telegramID, time.Unix(update.Date, 0), true
}

func telegramUserIsLinked(telegramID int64) bool {
	user := &model.User{TelegramId: strconv.FormatInt(telegramID, 10)}
	return user.FillUserByTelegramId() == nil && user.Status == common.UserStatusEnabled
}

func sendTelegramMainMenu(ctx context.Context, chatId int64) {
	serverAddress := strings.TrimRight(system_setting.ServerAddress, "/")
	text := "🖤 <b>VL API</b>\n\nЕдиный доступ к моделям ИИ через один API-ключ. Управляйте балансом, ключами и расходами в личном кабинете.\n\nВыберите нужный раздел:"
	buttons := [][]service.TelegramInlineButton{
		{{Text: "Профиль", CallbackData: telegramProfileCallback}, {Text: "Бонус", CallbackData: telegramBonusMenuCallback}},
		{{Text: "Открыть панель", URL: serverAddress}, {Text: "Документация", URL: serverAddress + "/docs"}},
	}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram main menu failed: " + err.Error())
	}
}

func sendTelegramProfile(ctx context.Context, chatId int64, telegramID int64) {
	user := &model.User{TelegramId: strconv.FormatInt(telegramID, 10)}
	if err := user.FillUserByTelegramId(); err != nil || user.Status != common.UserStatusEnabled {
		sendTelegramAccountBindingPrompt(ctx, chatId)
		return
	}

	bonusStatus := "доступен после подписки"
	bonus, err := model.GetTelegramChannelBonusByTelegramId(user.TelegramId)
	if err != nil {
		common.SysError("Telegram profile bonus lookup failed: " + err.Error())
	} else if bonus != nil {
		bonusStatus = telegramBonusStatus(bonus, time.Now())
	}
	name := user.DisplayName
	if strings.TrimSpace(name) == "" {
		name = user.Username
	}
	text := "🖤 <b>Ваш профиль</b>\n\n" +
		"<b>Имя:</b> " + html.EscapeString(name) + "\n" +
		"<b>ID аккаунта:</b> <code>" + strconv.Itoa(user.Id) + "</code>\n" +
		"<b>Баланс:</b> " + telegramQuotaUSD(user.Quota) + "\n" +
		"<b>Использовано:</b> " + telegramQuotaUSD(user.UsedQuota) + "\n" +
		"<b>Запросов:</b> " + strconv.Itoa(user.RequestCount) + "\n" +
		"<b>Бонус канала:</b> " + bonusStatus
	serverAddress := strings.TrimRight(system_setting.ServerAddress, "/")
	buttons := [][]service.TelegramInlineButton{
		{{Text: "Пополнить баланс", URL: serverAddress + "/wallet"}, {Text: "API-ключи", URL: serverAddress + "/keys"}},
		{{Text: "Проверить бонус", CallbackData: telegramBonusMenuCallback}},
		{{Text: "Главное меню", CallbackData: telegramMainMenuCallback}},
	}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram profile failed: " + err.Error())
	}
}

func telegramBonusStatus(bonus *model.TelegramChannelBonus, now time.Time) string {
	if bonus == nil {
		return "доступен после подписки"
	}
	if bonus.RevokedAt > 0 {
		return "отозван"
	}
	retentionEndsAt := time.Unix(bonus.CreatedAt, 0).Add(telegramBonusRevocationWindow)
	if !now.Before(retentionEndsAt) {
		return "закреплён"
	}
	secondsRemaining := int64(retentionEndsAt.Sub(now) / time.Second)
	daysRemaining := (secondsRemaining + int64(24*time.Hour/time.Second) - 1) / int64(24*time.Hour/time.Second)
	return fmt.Sprintf("начислен · осталось %d дн.", daysRemaining)
}

func telegramQuotaUSD(quota int) string {
	if common.QuotaPerUnit <= 0 {
		return "—"
	}
	return fmt.Sprintf("$%.2f", float64(quota)/common.QuotaPerUnit)
}

func sendTelegramHelp(ctx context.Context, chatId int64) {
	text := "🖤 <b>Помощь</b>\n\n" +
		"/start — главное меню\n" +
		"/profile — профиль и баланс\n" +
		"/bonus — бонус за подписку\n" +
		"/help — список команд"
	if err := service.TelegramSendMessage(ctx, chatId, text, telegramBackToMenuButtons()); err != nil {
		common.SysError("Telegram help failed: " + err.Error())
	}
}

func telegramBackToMenuButtons() [][]service.TelegramInlineButton {
	return [][]service.TelegramInlineButton{{{Text: "Главное меню", CallbackData: telegramMainMenuCallback}}}
}

func sendTelegramChannelBonusPrompt(ctx context.Context, chatId int64) {
	channel, channelURL, err := service.NormalizeTelegramChannel(setting.TelegramChannelBonusChannel)
	if err != nil {
		common.SysError("Telegram channel bonus configuration is invalid: " + err.Error())
		return
	}
	reward := fmt.Sprintf("$%.2f", setting.TelegramChannelBonusAmountUSD)
	text := "🖤 <b>Бонус за подписку</b>\n\nПодпишитесь на канал <b>" + html.EscapeString(channel) +
		"</b> и получите <b>" + reward + "</b> на баланс New API. Бонус доступен один раз. Чтобы сохранить его, оставайтесь подписаны 30 дней."
	buttons := [][]service.TelegramInlineButton{
		{{Text: "Подписаться на канал", URL: channelURL}},
		{{Text: "Проверить подписку", CallbackData: telegramChannelBonusCallback}},
		{{Text: "Главное меню", CallbackData: telegramMainMenuCallback}},
	}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram channel bonus prompt failed: " + err.Error())
	}
}

func sendTelegramAccountBindingPrompt(ctx context.Context, chatId int64) {
	profileURL := strings.TrimRight(system_setting.ServerAddress, "/") + "/profile"
	text := "<b>Сначала привяжите Telegram</b>\n\nВойдите в New API, откройте профиль и привяжите этот Telegram-аккаунт. После этого вернитесь сюда и отправьте /bonus."
	buttons := [][]service.TelegramInlineButton{
		{{Text: "Открыть профиль New API", URL: profileURL}},
		{{Text: "Главное меню", CallbackData: telegramMainMenuCallback}},
	}
	if err := service.TelegramSendMessage(ctx, chatId, text, buttons); err != nil {
		common.SysError("Telegram account binding prompt failed: " + err.Error())
	}
}
