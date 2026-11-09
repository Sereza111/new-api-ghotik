package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
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

type wechatLoginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    string `json:"data"`
}

func getWeChatIdByCode(code string) (string, error) {
	if code == "" {
		return "", common.NewMessage("Invalid parameters")
	}
	req, err := http.NewRequest("GET", fmt.Sprintf("%s/api/wechat/user?code=%s", common.WeChatServerAddress, url.QueryEscape(code)), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", common.WeChatServerToken)
	client := http.Client{
		Timeout: 5 * time.Second,
	}
	httpResponse, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer httpResponse.Body.Close()
	var res wechatLoginResponse
	err = common.DecodeJson(httpResponse.Body, &res)
	if err != nil {
		return "", err
	}
	if !res.Success {
		return "", errors.New(res.Message)
	}
	if res.Data == "" {
		return "", common.NewMessage("Verification code is incorrect or has expired")
	}
	return res.Data, nil
}

func WeChatAuth(c *gin.Context) {
	if !common.WeChatAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeChat"))
		return
	}
	code := c.Query("code")
	state := strings.TrimSpace(c.Query("state"))
	pendingFlow, err := model.GetAuthFlow(state, model.AuthFlowMatch{
		Purpose:  model.AuthFlowPurposeOAuth,
		Provider: "wechat",
		Intent:   model.AuthFlowIntentLogin,
	})
	if err != nil {
		writeAccountStatusError(c, http.StatusForbidden, "State parameter is empty or mismatched")
		return
	}
	var pendingPayload oauthFlowPayload
	if err := common.UnmarshalJsonStr(pendingFlow.Payload, &pendingPayload); err != nil ||
		!verifyOAuthBrowserBinding(c, state, pendingPayload.BrowserBindingHash) {
		writeAccountStatusError(c, http.StatusForbidden, "State parameter is empty or mismatched")
		return
	}
	wechatId, err := getWeChatIdByCode(code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	user := model.User{
		WeChatId: wechatId,
	}
	if model.IsWeChatIdAlreadyTaken(wechatId) {
		if _, err := model.ConsumeAuthFlow(state, model.AuthFlowMatch{
			Purpose:  model.AuthFlowPurposeOAuth,
			Provider: "wechat",
			Intent:   model.AuthFlowIntentLogin,
		}); err != nil {
			writeAccountStatusError(c, http.StatusForbidden, "State parameter is empty or mismatched")
			return
		}
		clearOAuthBrowserBindingCookie(c, state)
		err := user.FillUserByWeChatId()
		if err != nil {
			common.ApiError(c, err)
			return
		}
		if user.Id == 0 {
			common.ApiErrorT(c, "User has been deleted")
			return
		}
	} else {
		if !common.RegisterEnabled {
			if _, err := model.ConsumeAuthFlow(state, model.AuthFlowMatch{
				Purpose: model.AuthFlowPurposeOAuth, Provider: "wechat", Intent: model.AuthFlowIntentLogin,
			}); err != nil {
				writeAccountStatusError(c, http.StatusForbidden, "State parameter is empty or mismatched")
				return
			}
			clearOAuthBrowserBindingCookie(c, state)
			common.ApiErrorT(c, "New user registration has been disabled by administrator")
			return
		}
		user.Username = "wechat_" + strconv.Itoa(model.GetMaxUserId()+1)
		user.DisplayName = "WeChat User"
		user.Role = common.RoleCommonUser
		user.Status = common.UserStatusEnabled
		var assurance *oauthRegistrationAssurance
		registrationRejected := false
		_, err := model.ConsumeAuthFlowWithAction(state, model.AuthFlowMatch{
			Purpose:  model.AuthFlowPurposeOAuth,
			Provider: "wechat",
			Intent:   model.AuthFlowIntentLogin,
		}, func(tx *gorm.DB, flow *model.AuthFlow) error {
			var payload oauthFlowPayload
			if err := common.UnmarshalJsonStr(flow.Payload, &payload); err != nil {
				registrationRejected = true
				return nil
			}
			if err := validateOAuthRegistrationAssurance(payload.RegistrationAssurance); err != nil {
				registrationRejected = true
				return nil
			}
			assurance = payload.RegistrationAssurance
			if err := user.InsertWithTx(tx, 0); err != nil {
				return err
			}
			return model.ClaimExternalIdentityWithTx(tx, model.ExternalIdentityProviderWeChat, wechatId, user.Id)
		})
		if err != nil {
			if errors.Is(err, model.ErrExternalIdentityAlreadyClaimed) {
				if _, consumeErr := model.ConsumeAuthFlow(state, model.AuthFlowMatch{
					Purpose: model.AuthFlowPurposeOAuth, Provider: "wechat", Intent: model.AuthFlowIntentLogin,
				}); consumeErr == nil || errors.Is(consumeErr, model.ErrAuthFlowConsumed) {
					clearOAuthBrowserBindingCookie(c, state)
				}
				common.ApiErrorT(c, "Please restart sign-in and complete registration verification")
				return
			}
			common.SysLog(common.LogText("WeChat registration transaction failed: %v", err))
			common.ApiErrorT(c, "Database error, please contact the administrator")
			return
		}
		if registrationRejected || assurance == nil {
			clearOAuthBrowserBindingCookie(c, state)
			common.ApiErrorT(c, "Please restart sign-in and complete registration verification")
			return
		}
		clearOAuthBrowserBindingCookie(c, state)
		user.FinalizeOAuthUserCreation(0)
		recordOAuthRegistrationAudit(c, &user, "WeChat", assurance)
	}

	if user.Status != common.UserStatusEnabled {
		common.ApiErrorT(c, "User has been banned")
		return
	}
	setupLogin(&user, nil, c)
}

type wechatBindRequest struct {
	Code string `json:"code"`
}

func WeChatBind(c *gin.Context) {
	identity, ok := middleware.GetStepUpIdentity(c)
	if !ok {
		writeSecurityOperationError(c, service.ErrAuthTokenInvalid)
		return
	}
	succeeded, notificationFailed := false, false
	defer func() {
		recordUserSecurityAudit(c, identity.UserID, "user.binding_bind", map[string]any{"provider": "wechat", "success": succeeded, "notification_failed": notificationFailed})
	}()
	if !common.WeChatAuthEnabled {
		common.ApiErrorT(c, "{{provider}} login and registration has not been enabled by administrator", providerParams("WeChat"))
		return
	}
	var req wechatBindRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		common.ApiErrorT(c, "Invalid request")
		return
	}
	code := strings.TrimSpace(req.Code)
	context, err := common.Marshal(service.AccountBindingContext{Provider: "wechat", Code: code})
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	if middleware.RequireSecurityProof(c, service.VerificationOperation{Scope: service.VerificationScopeAccountBind, Context: context}) == nil {
		return
	}
	wechatId, err := getWeChatIdByCode(code)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	if model.IsWeChatIdAlreadyTaken(wechatId) {
		common.ApiErrorT(c, "This {{provider}} account has already been bound", providerParams("WeChat"))
		return
	}
	// 只更新绑定列，避免完整用户快照覆盖并发的封禁、降权或分组变更。
	if err := model.DB.Transaction(func(tx *gorm.DB) error {
		if err := model.ClaimExternalIdentityWithTx(tx, model.ExternalIdentityProviderWeChat, wechatId, identity.UserID); err != nil {
			return err
		}
		return model.UpdateUserBindColumnForSessionWithTx(tx, identity, "wechat_id", wechatId)
	}); err != nil {
		if errors.Is(err, model.ErrExternalIdentityAlreadyClaimed) {
			common.ApiErrorT(c, "This {{provider}} account has already been bound", providerParams("WeChat"))
			return
		}
		writeSecurityOperationError(c, err)
		return
	}
	succeeded = true
	user, err := model.GetUserById(identity.UserID, false)
	if err != nil {
		writeSecurityOperationError(c, err)
		return
	}
	notificationFailed = service.NotifyAccountSecurityChange(service.AccountMailLanguage(c, user.Id), user.Email, i18n.MsgSecurityEventWeChatLinked) != nil
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": "",
		"data":    gin.H{"notification_warning": notificationFailed},
	})
	return
}
