package service

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/system_setting"
)

const telegramBotAPIBaseURL = "https://api.telegram.org"

var telegramChannelUsernamePattern = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{4,31}$`)

type TelegramInlineButton struct {
	Text         string `json:"text"`
	URL          string `json:"url,omitempty"`
	CallbackData string `json:"callback_data,omitempty"`
}

type telegramInlineKeyboard struct {
	InlineKeyboard [][]TelegramInlineButton `json:"inline_keyboard"`
}

type telegramAPIResponse[T any] struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      T      `json:"result"`
}

type telegramChatMember struct {
	Status   string `json:"status"`
	IsMember bool   `json:"is_member"`
}

func NormalizeTelegramChannel(raw string) (string, string, error) {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.TrimSuffix(trimmed, "/")
	for _, prefix := range []string{"https://t.me/", "http://t.me/", "t.me/"} {
		if strings.HasPrefix(strings.ToLower(trimmed), prefix) {
			trimmed = trimmed[len(prefix):]
			break
		}
	}
	username := strings.TrimPrefix(trimmed, "@")
	if !telegramChannelUsernamePattern.MatchString(username) {
		return "", "", errors.New("invalid public Telegram channel username")
	}
	return "@" + username, "https://t.me/" + username, nil
}

func TelegramChannelBonusWebhookSecret(token string) string {
	sum := sha256.Sum256([]byte("telegram-channel-bonus-webhook:" + token))
	return hex.EncodeToString(sum[:])
}

func callTelegramBotAPI[T any](ctx context.Context, token string, method string, payload any) (T, error) {
	var zero T
	body, err := common.Marshal(payload)
	if err != nil {
		return zero, err
	}
	requestURL := telegramBotAPIBaseURL + "/bot" + token + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, bytes.NewReader(body))
	if err != nil {
		return zero, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := GetHttpClient()
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return zero, err
	}
	defer resp.Body.Close()

	var result telegramAPIResponse[T]
	if err := common.DecodeJson(resp.Body, &result); err != nil {
		return zero, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices || !result.OK {
		if result.Description == "" {
			result.Description = resp.Status
		}
		return zero, fmt.Errorf("Telegram Bot API %s failed: %s", method, result.Description)
	}
	return result.Result, nil
}

func ConfigureTelegramChannelBonusWebhook(ctx context.Context) error {
	if !setting.TelegramChannelBonusEnabled {
		return nil
	}
	token := strings.TrimSpace(common.TelegramBotToken)
	if token == "" {
		return errors.New("Telegram bot token is empty")
	}
	serverAddress := strings.TrimRight(strings.TrimSpace(system_setting.ServerAddress), "/")
	parsedAddress, err := url.Parse(serverAddress)
	if err != nil || parsedAddress.Scheme != "https" || parsedAddress.Host == "" {
		return errors.New("public HTTPS server address is required for Telegram webhook")
	}
	if _, _, err := NormalizeTelegramChannel(setting.TelegramChannelBonusChannel); err != nil {
		return err
	}

	payload := map[string]any{
		"url":             serverAddress + "/api/telegram/channel-bonus/webhook",
		"secret_token":    TelegramChannelBonusWebhookSecret(token),
		"allowed_updates": []string{"message", "callback_query"},
	}
	_, err = callTelegramBotAPI[bool](ctx, token, "setWebhook", payload)
	return err
}

func TelegramSendMessage(ctx context.Context, chatId int64, text string, buttons [][]TelegramInlineButton) error {
	payload := map[string]any{
		"chat_id":    chatId,
		"text":       text,
		"parse_mode": "HTML",
	}
	if len(buttons) > 0 {
		payload["reply_markup"] = telegramInlineKeyboard{InlineKeyboard: buttons}
	}
	_, err := callTelegramBotAPI[any](ctx, common.TelegramBotToken, "sendMessage", payload)
	return err
}

func TelegramAnswerCallback(ctx context.Context, callbackId string, text string, showAlert bool) error {
	payload := map[string]any{
		"callback_query_id": callbackId,
		"text":              text,
		"show_alert":        showAlert,
	}
	_, err := callTelegramBotAPI[bool](ctx, common.TelegramBotToken, "answerCallbackQuery", payload)
	return err
}

func TelegramIsChannelMember(ctx context.Context, channel string, telegramId int64) (bool, error) {
	chatId, _, err := NormalizeTelegramChannel(channel)
	if err != nil {
		return false, err
	}
	member, err := callTelegramBotAPI[telegramChatMember](ctx, common.TelegramBotToken, "getChatMember", map[string]any{
		"chat_id": chatId,
		"user_id": telegramId,
	})
	if err != nil {
		return false, err
	}
	return telegramChannelMemberStatusIsActive(member.Status, member.IsMember), nil
}

func telegramChannelMemberStatusIsActive(status string, isMember bool) bool {
	switch status {
	case "creator", "administrator", "member":
		return true
	case "restricted":
		return isMember
	default:
		return false
	}
}
