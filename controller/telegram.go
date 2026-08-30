package controller

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	// The legacy Telegram widget has no nonce. Keep its signed assertion short-lived
	// so captured callbacks cannot be reused indefinitely.
	telegramAuthorizationMaxAge     = 5 * time.Minute
	telegramAuthorizationFutureSkew = 2 * time.Minute
	telegramLoginFlowTTL            = 10 * time.Minute
	telegramBindFlowTTL             = 5 * time.Minute
	telegramLoginCookieName         = "telegram_login_flow"

	telegramBindErrorDisabled       = "TELEGRAM_BIND_DISABLED"
	telegramBindErrorInvalidRequest = "TELEGRAM_BIND_INVALID_REQUEST"
	telegramBindErrorFlowInvalid    = "TELEGRAM_BIND_FLOW_INVALID"
	telegramBindErrorSessionInvalid = "TELEGRAM_BIND_SESSION_INVALID"
	telegramBindErrorAlreadyBound   = "TELEGRAM_BIND_ALREADY_BOUND"
	telegramBindErrorUserDeleted    = "TELEGRAM_BIND_USER_DELETED"
	telegramBindErrorUserDisabled   = "TELEGRAM_BIND_USER_DISABLED"
	telegramBindErrorInternal       = "TELEGRAM_BIND_INTERNAL_ERROR"
)

type telegramLoginFlowPayload struct {
	TelegramId string `json:"telegram_id,omitempty"`
	Username   string `json:"username,omitempty"`
	FirstName  string `json:"first_name,omitempty"`
	LastName   string `json:"last_name,omitempty"`
}

var (
	errTelegramAccountAlreadyBound  = errors.New("telegram account is already bound")
	errTelegramBindAssertionInvalid = errors.New("telegram bind assertion is invalid")
	errTelegramBindUserDeleted      = errors.New("telegram bind user was deleted")
	errTelegramBindUserDisabled     = errors.New("telegram bind user is disabled")
)

func TelegramLoginStart(c *gin.Context) {
	botName := strings.TrimPrefix(strings.TrimSpace(common.TelegramBotName), "@")
	if !common.TelegramOAuthEnabled || strings.TrimSpace(common.TelegramBotToken) == "" || botName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Telegram login is not configured"})
		return
	}

	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		common.ApiError(c, err)
		return
	}
	verifier := base64.RawURLEncoding.EncodeToString(verifierBytes)
	payload, err := common.Marshal(telegramLoginFlowPayload{})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	expiresAt := time.Now().Add(telegramLoginFlowTTL)
	flowToken, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose:   model.AuthFlowPurposeTelegramLogin,
		SessionId: telegramLoginBrowserBinding(verifier),
		Payload:   string(payload),
		ExpiresAt: expiresAt,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}

	http.SetCookie(c.Writer, &http.Cookie{
		Name:     telegramLoginCookieName,
		Value:    flowToken + "." + verifier,
		Path:     "/api/oauth/telegram/login",
		MaxAge:   int(telegramLoginFlowTTL / time.Second),
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   common.SessionCookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
	deepLink := url.URL{Scheme: "https", Host: "t.me", Path: "/" + botName}
	query := deepLink.Query()
	query.Set("start", "login_"+flowToken)
	deepLink.RawQuery = query.Encode()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"deep_link":  deepLink.String(),
			"expires_at": expiresAt.Unix(),
		},
	})
}

func TelegramLoginStatus(c *gin.Context) {
	cookieValue, err := c.Cookie(telegramLoginCookieName)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Telegram login session is missing"})
		return
	}
	flowToken, verifier, ok := strings.Cut(cookieValue, ".")
	if !ok || flowToken == "" || verifier == "" {
		clearTelegramLoginCookie(c)
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "Telegram login session is invalid"})
		return
	}
	match := model.AuthFlowMatch{
		Purpose:   model.AuthFlowPurposeTelegramLogin,
		SessionId: telegramLoginBrowserBinding(verifier),
	}
	flow, err := model.GetAuthFlow(flowToken, match)
	if err != nil {
		clearTelegramLoginCookie(c)
		c.JSON(http.StatusForbidden, gin.H{"success": false, "message": "Telegram login session has expired"})
		return
	}
	var payload telegramLoginFlowPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		common.ApiError(c, err)
		return
	}
	if payload.TelegramId == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"status": "pending"}})
		return
	}

	var user *model.User
	created := false
	_, err = model.ConsumeAuthFlowWithAction(flowToken, match, func(tx *gorm.DB, _ *model.AuthFlow) error {
		var createErr error
		user, created, createErr = findOrCreateTelegramIdentityWithTx(tx, payload)
		return createErr
	})
	if err != nil {
		switch {
		case errors.As(err, new(*OAuthUserDeletedError)):
			common.ApiErrorI18n(c, i18n.MsgOAuthUserDeleted)
		case errors.As(err, new(*OAuthRegistrationDisabledError)):
			common.ApiErrorI18n(c, i18n.MsgUserRegisterDisabled)
		default:
			common.ApiError(c, err)
		}
		return
	}
	clearTelegramLoginCookie(c)
	if created {
		user.FinalizeOAuthUserCreation(0)
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorI18n(c, i18n.MsgOAuthUserBanned)
		return
	}
	setupLogin(user, c)
}

func telegramLoginBrowserBinding(verifier string) string {
	return common.GenerateHMACWithKey([]byte(common.SessionSecret), "telegram-login-browser:"+verifier)
}

func clearTelegramLoginCookie(c *gin.Context) {
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     telegramLoginCookieName,
		Value:    "",
		Path:     "/api/oauth/telegram/login",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   common.SessionCookieSecure,
		SameSite: http.SameSiteStrictMode,
	})
}

func TelegramBindStart(c *gin.Context) {
	if !common.TelegramOAuthEnabled {
		c.JSON(http.StatusOK, gin.H{
			"message": "管理员未开启通过 Telegram 登录以及注册",
			"success": false,
		})
		return
	}
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录"})
		return
	}
	botName := strings.TrimPrefix(strings.TrimSpace(common.TelegramBotName), "@")
	if botName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "Telegram bot is not configured"})
		return
	}
	expiresAt := time.Now().Add(telegramBindFlowTTL)
	flowToken, _, err := model.CreateAuthFlow(model.AuthFlowCreate{
		Purpose:   model.AuthFlowPurposeTelegramBind,
		UserId:    identity.UserID,
		SessionId: identity.SessionID,
		ExpiresAt: expiresAt,
	})
	if err != nil {
		common.ApiError(c, err)
		return
	}
	callbackURL := "/api/oauth/telegram/bind/" + flowToken
	deepLink := url.URL{Scheme: "https", Host: "t.me", Path: "/" + botName}
	query := deepLink.Query()
	query.Set("start", "bind_"+flowToken)
	deepLink.RawQuery = query.Encode()
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data": gin.H{
			"flow_token":   flowToken,
			"callback_url": callbackURL,
			"deep_link":    deepLink.String(),
			"expires_at":   expiresAt.Unix(),
		},
	})
}

func TelegramBindStatus(c *gin.Context) {
	if !common.TelegramOAuthEnabled {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "code": telegramBindErrorDisabled})
		return
	}
	identity, ok := middleware.GetSessionAuthIdentity(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "code": telegramBindErrorSessionInvalid})
		return
	}
	match := model.AuthFlowMatch{
		Purpose:   model.AuthFlowPurposeTelegramBind,
		UserId:    identity.UserID,
		SessionId: identity.SessionID,
	}
	flowToken := c.Param("flow_token")
	flow, err := model.GetAuthFlow(flowToken, match)
	if err != nil {
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": telegramBindErrorFlowInvalid})
		return
	}
	var payload telegramLoginFlowPayload
	if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
		common.ApiError(c, err)
		return
	}
	if payload.TelegramId == "" {
		c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"status": "pending"}})
		return
	}

	_, err = model.ConsumeAuthFlowWithAction(flowToken, match, func(tx *gorm.DB, pending *model.AuthFlow) error {
		return bindTelegramIdentityWithTx(tx, pending, payload.TelegramId)
	})
	if err != nil {
		code := telegramBindErrorInternal
		switch {
		case errors.Is(err, errTelegramAccountAlreadyBound), errors.Is(err, model.ErrExternalIdentityAlreadyClaimed):
			code = telegramBindErrorAlreadyBound
		case errors.Is(err, errTelegramBindUserDeleted):
			code = telegramBindErrorUserDeleted
		case errors.Is(err, errTelegramBindUserDisabled):
			code = telegramBindErrorUserDisabled
		case errors.Is(err, service.ErrLoginSessionRevoked):
			code = telegramBindErrorSessionInvalid
		case errors.Is(err, model.ErrAuthFlowInvalid), errors.Is(err, model.ErrAuthFlowExpired), errors.Is(err, model.ErrAuthFlowConsumed):
			code = telegramBindErrorFlowInvalid
		default:
			common.SysError("TelegramBindStatus failed: " + err.Error())
		}
		c.JSON(http.StatusForbidden, gin.H{"success": false, "code": code})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"status": "complete"}})
}

func TelegramBind(c *gin.Context) {
	if !common.TelegramOAuthEnabled {
		telegramBindFailure(c, telegramBindErrorDisabled)
		return
	}
	params := c.Request.URL.Query()
	telegramId, err := verifyTelegramAuthorization(params, common.TelegramBotToken, time.Now())
	if err != nil {
		common.SysLog("TelegramBind authorization failed: " + err.Error())
		telegramBindFailure(c, telegramBindErrorInvalidRequest)
		return
	}
	pendingFlow, err := model.GetAuthFlow(c.Param("flow_token"), model.AuthFlowMatch{
		Purpose: model.AuthFlowPurposeTelegramBind,
	})
	if err != nil {
		if !errors.Is(err, model.ErrAuthFlowInvalid) &&
			!errors.Is(err, model.ErrAuthFlowExpired) &&
			!errors.Is(err, model.ErrAuthFlowConsumed) {
			common.SysError("TelegramBind flow lookup failed: " + err.Error())
			telegramBindFailure(c, telegramBindErrorInternal)
			return
		}
		telegramBindFailure(c, telegramBindErrorFlowInvalid)
		return
	}
	if _, err := service.ValidateSessionReference(pendingFlow.UserId, pendingFlow.SessionId); err != nil {
		if !errors.Is(err, service.ErrLoginSessionInvalid) &&
			!errors.Is(err, service.ErrLoginSessionRevoked) &&
			!errors.Is(err, model.ErrUserSessionInactive) &&
			!errors.Is(err, gorm.ErrRecordNotFound) {
			common.SysError("TelegramBind session validation failed: " + err.Error())
			telegramBindFailure(c, telegramBindErrorInternal)
			return
		}

		var user model.User
		userErr := model.DB.First(&user, pendingFlow.UserId).Error
		switch {
		case errors.Is(userErr, gorm.ErrRecordNotFound):
			telegramBindFailure(c, telegramBindErrorUserDeleted)
		case userErr != nil:
			common.SysError("TelegramBind user status lookup failed: " + userErr.Error())
			telegramBindFailure(c, telegramBindErrorInternal)
		case user.Status != common.UserStatusEnabled:
			telegramBindFailure(c, telegramBindErrorUserDisabled)
		default:
			telegramBindFailure(c, telegramBindErrorSessionInvalid)
		}
		return
	}
	assertion, assertionExpiresAt, err := telegramAuthorizationClaim(params, time.Now())
	if err != nil {
		common.SysLog("TelegramBind authorization claim failed: " + err.Error())
		telegramBindFailure(c, telegramBindErrorInvalidRequest)
		return
	}
	_, err = model.ConsumeAuthFlowWithAction(c.Param("flow_token"), model.AuthFlowMatch{
		Purpose:   model.AuthFlowPurposeTelegramBind,
		UserId:    pendingFlow.UserId,
		SessionId: pendingFlow.SessionId,
	}, func(tx *gorm.DB, flow *model.AuthFlow) error {
		if err := model.ClaimExternalAuthAssertionWithTx(tx, model.AuthFlowPurposeTelegramAssertion, assertion, assertionExpiresAt); err != nil {
			if errors.Is(err, model.ErrAuthFlowInvalid) || errors.Is(err, model.ErrAuthFlowConsumed) {
				return errors.Join(errTelegramBindAssertionInvalid, err)
			}
			return err
		}

		return bindTelegramIdentityWithTx(tx, flow, telegramId)
	})
	if err != nil {
		switch {
		case errors.Is(err, errTelegramBindAssertionInvalid):
			telegramBindFailure(c, telegramBindErrorInvalidRequest)
		case errors.Is(err, errTelegramAccountAlreadyBound):
			telegramBindFailure(c, telegramBindErrorAlreadyBound)
		case errors.Is(err, errTelegramBindUserDeleted):
			telegramBindFailure(c, telegramBindErrorUserDeleted)
		case errors.Is(err, errTelegramBindUserDisabled):
			telegramBindFailure(c, telegramBindErrorUserDisabled)
		case errors.Is(err, service.ErrLoginSessionRevoked):
			telegramBindFailure(c, telegramBindErrorSessionInvalid)
		case errors.Is(err, model.ErrAuthFlowInvalid), errors.Is(err, model.ErrAuthFlowExpired), errors.Is(err, model.ErrAuthFlowConsumed):
			telegramBindFailure(c, telegramBindErrorFlowInvalid)
		default:
			common.SysError("TelegramBind failed: " + err.Error())
			telegramBindFailure(c, telegramBindErrorInternal)
		}
		return
	}

	callback := "/oauth/telegram?telegram_bind=success&flow_token=" + url.QueryEscape(c.Param("flow_token"))
	c.Redirect(http.StatusFound, callback)
}

func telegramBindFailure(c *gin.Context, errorCode string) {
	query := url.Values{
		"telegram_bind": {"error"},
		"flow_token":    {c.Param("flow_token")},
		"error_code":    {errorCode},
	}
	c.Redirect(http.StatusFound, "/oauth/telegram?"+query.Encode())
}

func bindTelegramIdentityWithTx(tx *gorm.DB, flow *model.AuthFlow, telegramId string) error {
	var user model.User
	if err := tx.First(&user, flow.UserId).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return errTelegramBindUserDeleted
		}
		return err
	}
	if user.Status != common.UserStatusEnabled {
		return errTelegramBindUserDisabled
	}

	var session model.UserSession
	if err := tx.Where("sid = ? AND user_id = ?", flow.SessionId, flow.UserId).First(&session).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return service.ErrLoginSessionRevoked
		}
		return err
	}
	if session.Status != model.UserSessionStatusActive || session.RevokedAt != 0 || session.ExpiresAt <= time.Now().Unix() {
		return service.ErrLoginSessionRevoked
	}
	if session.UserAuthVersion != user.AuthVersion {
		return service.ErrLoginSessionRevoked
	}
	if user.TelegramId != "" {
		return errTelegramAccountAlreadyBound
	}
	if err := model.ClaimExternalIdentityWithTx(
		tx,
		model.ExternalIdentityProviderTelegram,
		telegramId,
		user.Id,
	); err != nil {
		if errors.Is(err, model.ErrExternalIdentityAlreadyClaimed) {
			return errTelegramAccountAlreadyBound
		}
		return err
	}
	result := tx.Model(&model.User{}).
		Where("id = ? AND status = ? AND auth_version = ? AND telegram_id = ?", user.Id, common.UserStatusEnabled, user.AuthVersion, "").
		Update("telegram_id", telegramId)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errTelegramAccountAlreadyBound
	}
	return nil
}

func TelegramLogin(c *gin.Context) {
	if !common.TelegramOAuthEnabled {
		c.JSON(200, gin.H{
			"message": "管理员未开启通过 Telegram 登录以及注册",
			"success": false,
		})
		return
	}
	params := c.Request.URL.Query()
	telegramId, err := verifyTelegramAuthorization(params, common.TelegramBotToken, time.Now())
	if err != nil {
		common.SysLog("TelegramLogin authorization failed: " + err.Error())
		c.JSON(200, gin.H{
			"message": "无效的请求",
			"success": false,
		})
		return
	}

	user, created, err := findOrCreateTelegramUser(params, telegramId, time.Now())
	if err != nil {
		switch {
		case errors.Is(err, model.ErrAuthFlowInvalid), errors.Is(err, model.ErrAuthFlowConsumed):
			common.SysLog("TelegramLogin assertion replay rejected: " + err.Error())
			c.JSON(http.StatusForbidden, gin.H{
				"message": "该登录凭据已被使用",
				"success": false,
			})
		case errors.As(err, new(*OAuthUserDeletedError)):
			common.ApiErrorI18n(c, i18n.MsgOAuthUserDeleted)
		case errors.As(err, new(*OAuthRegistrationDisabledError)):
			common.ApiErrorI18n(c, i18n.MsgUserRegisterDisabled)
		default:
			common.ApiError(c, err)
		}
		return
	}
	if created {
		user.FinalizeOAuthUserCreation(0)
	}
	if user.Status != common.UserStatusEnabled {
		common.ApiErrorI18n(c, i18n.MsgOAuthUserBanned)
		return
	}
	setupLogin(user, c)
}

func findOrCreateTelegramUser(params url.Values, telegramId string, now time.Time) (*model.User, bool, error) {
	assertion, assertionExpiresAt, err := telegramAuthorizationClaim(params, now)
	if err != nil {
		return nil, false, err
	}

	identity := telegramLoginFlowPayload{
		TelegramId: telegramId,
		Username:   params.Get("username"),
		FirstName:  params.Get("first_name"),
		LastName:   params.Get("last_name"),
	}
	var user *model.User
	created := false
	err = model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.ClaimExternalAuthAssertionWithTx(
			tx,
			model.AuthFlowPurposeTelegramAssertion,
			assertion,
			assertionExpiresAt,
		); err != nil {
			return err
		}

		var createErr error
		user, created, createErr = findOrCreateTelegramIdentityWithTx(tx, identity)
		return createErr
	})
	if err != nil {
		return nil, false, err
	}
	return user, created, nil
}

func findOrCreateTelegramIdentityWithTx(tx *gorm.DB, identity telegramLoginFlowPayload) (*model.User, bool, error) {
	telegramId := strings.TrimSpace(identity.TelegramId)
	if telegramId == "" {
		return nil, false, errors.New("telegram identity is empty")
	}
	user := &model.User{}
	err := tx.Unscoped().Where("telegram_id = ?", telegramId).First(user).Error
	switch {
	case err == nil:
		if user.DeletedAt.Valid {
			return nil, false, &OAuthUserDeletedError{}
		}
		err = model.ClaimExternalIdentityWithTx(
			tx,
			model.ExternalIdentityProviderTelegram,
			telegramId,
			user.Id,
		)
		return user, false, err
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, false, err
	}

	if !common.RegisterEnabled {
		return nil, false, &OAuthRegistrationDisabledError{}
	}

	username := strings.TrimSpace(identity.Username)
	if username != "" && len([]rune(username)) <= model.UserNameMaxLength {
		var count int64
		if err := tx.Unscoped().Model(&model.User{}).Where("username = ?", username).Count(&count).Error; err != nil {
			return nil, false, err
		}
		if count > 0 {
			username = ""
		}
	} else {
		username = ""
	}
	if username == "" {
		identityHash := sha256.Sum256([]byte(telegramId))
		username = "tg_" + hex.EncodeToString(identityHash[:])[:16]
	}

	displayName := strings.TrimSpace(strings.Join([]string{identity.FirstName, identity.LastName}, " "))
	if displayName == "" {
		displayName = "Telegram User"
	}
	displayNameRunes := []rune(displayName)
	if len(displayNameRunes) > model.UserNameMaxLength {
		displayName = string(displayNameRunes[:model.UserNameMaxLength])
	}

	user = &model.User{
		Username:    username,
		DisplayName: displayName,
		Role:        common.RoleCommonUser,
		Status:      common.UserStatusEnabled,
		TelegramId:  telegramId,
	}
	if err := user.InsertWithTx(tx, 0); err != nil {
		return nil, false, err
	}
	if err := model.ClaimExternalIdentityWithTx(
		tx,
		model.ExternalIdentityProviderTelegram,
		telegramId,
		user.Id,
	); err != nil {
		return nil, false, err
	}
	return user, true, nil
}

func telegramAuthorizationClaim(params url.Values, now time.Time) (string, time.Time, error) {
	authDate, err := strconv.ParseInt(params.Get("auth_date"), 10, 64)
	if err != nil {
		return "", time.Time{}, errors.New("telegram authorization date is invalid")
	}
	hashBytes, err := hex.DecodeString(params.Get("hash"))
	if err != nil {
		return "", time.Time{}, errors.New("telegram authorization signature is invalid")
	}
	expiresAt := time.Unix(authDate, 0).Add(telegramAuthorizationMaxAge)
	if !expiresAt.After(now) {
		return "", time.Time{}, errors.New("telegram authorization has expired")
	}
	return hex.EncodeToString(hashBytes), expiresAt, nil
}

func verifyTelegramAuthorization(params url.Values, token string, now time.Time) (string, error) {
	if token == "" {
		return "", errors.New("telegram bot token is empty")
	}
	for _, values := range params {
		if len(values) != 1 {
			return "", errors.New("telegram authorization contains duplicate parameters")
		}
	}

	telegramID := params.Get("id")
	hash := params.Get("hash")
	authDateText := params.Get("auth_date")
	if telegramID == "" || hash == "" || authDateText == "" {
		return "", errors.New("telegram authorization is incomplete")
	}
	authDate, err := strconv.ParseInt(authDateText, 10, 64)
	if err != nil {
		return "", errors.New("telegram authorization date is invalid")
	}
	if authDate < now.Add(-telegramAuthorizationMaxAge).Unix() ||
		authDate > now.Add(telegramAuthorizationFutureSkew).Unix() {
		return "", errors.New("telegram authorization has expired")
	}

	strs := make([]string, 0, len(params)-1)
	for k, v := range params {
		if k == "hash" {
			continue
		}
		strs = append(strs, k+"="+v[0])
	}
	sort.Strings(strs)
	secret := sha256.Sum256([]byte(token))
	mac := hmac.New(sha256.New, secret[:])
	_, _ = mac.Write([]byte(strings.Join(strs, "\n")))
	providedHash, err := hex.DecodeString(hash)
	if err != nil || !hmac.Equal(providedHash, mac.Sum(nil)) {
		return "", errors.New("telegram authorization signature is invalid")
	}

	return telegramID, nil
}
