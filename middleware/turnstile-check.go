package middleware

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
)

type turnstileCheckResponse struct {
	Success bool `json:"success"`
}

var turnstileHTTPClient = &http.Client{Timeout: 10 * time.Second}

// VerifyTurnstileToken validates a client response when the caller's settings
// snapshot requires it. Callers must not persist or log the raw response token.
func VerifyTurnstileToken(c *gin.Context, response string, required bool) bool {
	if !required {
		return true
	}
	response = strings.TrimSpace(response)
	if response == "" {
		common.ApiErrorT(c, "Turnstile token is empty")
		return false
	}
	form := url.Values{
		"secret":   {common.TurnstileSecretKey},
		"response": {response},
		"remoteip": {c.ClientIP()},
	}
	request, err := http.NewRequestWithContext(
		c.Request.Context(),
		http.MethodPost,
		"https://challenges.cloudflare.com/turnstile/v0/siteverify",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		common.SysError(err.Error())
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		return false
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rawRes, err := turnstileHTTPClient.Do(request)
	if err != nil {
		common.SysError(err.Error())
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		return false
	}
	defer rawRes.Body.Close()
	if rawRes.StatusCode < http.StatusOK || rawRes.StatusCode >= http.StatusMultipleChoices {
		common.SysError("Turnstile verification returned an unexpected HTTP status")
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		return false
	}
	var result turnstileCheckResponse
	if err = common.DecodeJson(io.LimitReader(rawRes.Body, 1<<20), &result); err != nil {
		common.SysError(err.Error())
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		return false
	}
	if !result.Success {
		common.ApiErrorT(c, "Turnstile verification failed, please refresh and try again!")
		return false
	}
	return true
}

func TurnstileCheck() gin.HandlerFunc {
	return func(c *gin.Context) {
		required := common.TurnstileCheckEnabled
		if !VerifyTurnstileToken(c, c.Query("turnstile"), required) {
			c.Abort()
			return
		}
		c.Next()
	}
}
