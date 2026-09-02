package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type routingSourceAPIResponse struct {
	Success bool                         `json:"success"`
	Message string                       `json:"message"`
	Data    service.RoutingSourceCatalog `json:"data"`
}

func setupRoutingSourceControllerTest(t *testing.T) *model.User {
	t.Helper()
	db := setupModelListControllerTestDB(t)
	originalGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default route","premium":"Premium route"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"premium":1.75}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})

	user := &model.User{
		Id:       701,
		Username: "routing-source-user",
		Password: "password",
		Group:    "default",
		Status:   common.UserStatusEnabled,
	}
	user.SetSetting(dto.UserSetting{
		Language:          "ru",
		BillingPreference: "wallet",
		RoutingSources:    map[string]string{"grok": "removed-source"},
	})
	require.NoError(t, db.Create(user).Error)
	baseURL := "https://private-routing-source.example/v1"
	require.NoError(t, db.Create(&model.Channel{
		Id:      999999,
		Type:    constant.ChannelTypeOpenAI,
		Key:     "private-routing-source-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "private-routing-source-channel",
		BaseURL: &baseURL,
		Models:  "gpt-5.6-sol",
		Group:   "premium",
	}).Error)

	priority := int64(0)
	require.NoError(t, db.Create([]model.Ability{
		{Group: "default", Model: "gpt-5.6-sol", ChannelId: 101, Enabled: true, Priority: &priority},
		{Group: "default", Model: "grok-4", ChannelId: 102, Enabled: true, Priority: &priority},
		{Group: "premium", Model: "gpt-5.6-sol", ChannelId: 999999, Enabled: true, Priority: &priority},
		{Group: "premium", Model: "gpt-5.5", ChannelId: 999998, Enabled: true, Priority: &priority},
		{Group: "internal-route", Model: "claude-sonnet-4", ChannelId: 999997, Enabled: true, Priority: &priority},
	}).Error)
	return user
}

func routingSourceContext(t *testing.T, method, target string, body any, userID int) (*gin.Context, *httptest.ResponseRecorder, *routingSourceAPIResponse, func()) {
	t.Helper()
	ctx, recorder := newAuthenticatedContext(t, method, target, body, userID)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	response := &routingSourceAPIResponse{}
	decode := func() {
		require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), response))
	}
	return ctx, recorder, response, decode
}

func TestGetRoutingSourcesReturnsSanitizedDynamicCatalog(t *testing.T) {
	user := setupRoutingSourceControllerTest(t)
	ctx, recorder, response, decode := routingSourceContext(t, http.MethodGet, "/api/user/self/routing-sources", nil, user.Id)

	GetRoutingSources(ctx)
	decode()

	require.True(t, response.Success, response.Message)
	require.Len(t, response.Data.Families, 2)
	assert.Equal(t, "GPT", response.Data.Families[0].Label)
	assert.Equal(t, "", response.Data.Families[1].SelectedSourceID, "stale selections must not be returned as active")
	require.Len(t, response.Data.Families[0].Sources, 2)
	assert.Equal(t, "premium", response.Data.Families[0].Sources[1].ID)
	assert.Equal(t, 1.75, response.Data.Families[0].Sources[1].PriceMultiplier)
	assert.Equal(t, 2, response.Data.Families[0].Sources[1].ModelCount)

	body := recorder.Body.String()
	assert.NotContains(t, body, "channel_id")
	assert.NotContains(t, body, "base_url")
	assert.NotContains(t, body, "999999")
	assert.NotContains(t, body, "private-routing-source-key")
	assert.NotContains(t, body, "private-routing-source.example")
	assert.NotContains(t, body, "internal-route")
}

func TestUpdateAndDeleteRoutingSourcePreserveOtherSettings(t *testing.T) {
	user := setupRoutingSourceControllerTest(t)
	ctx, _, response, decode := routingSourceContext(t, http.MethodPut, "/api/user/self/routing-sources/gpt", map[string]string{"source_id": "premium"}, user.Id)
	ctx.Params = gin.Params{{Key: "family", Value: "gpt"}}

	UpdateRoutingSource(ctx)
	decode()
	require.True(t, response.Success, response.Message)

	settings, err := model.GetUserSetting(user.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "premium", settings.RoutingSources["gpt"])
	assert.Equal(t, "ru", settings.Language)
	assert.Equal(t, "wallet", settings.BillingPreference)

	deleteContext, _, deleteResponse, decodeDelete := routingSourceContext(t, http.MethodDelete, "/api/user/self/routing-sources/gpt", nil, user.Id)
	deleteContext.Params = gin.Params{{Key: "family", Value: "gpt"}}
	DeleteRoutingSource(deleteContext)
	decodeDelete()
	require.True(t, deleteResponse.Success, deleteResponse.Message)

	settings, err = model.GetUserSetting(user.Id, true)
	require.NoError(t, err)
	assert.NotContains(t, settings.RoutingSources, "gpt")
	assert.Equal(t, "removed-source", settings.RoutingSources["grok"])
}

func TestUpdateRoutingSourceRejectsSourceOutsideFamily(t *testing.T) {
	user := setupRoutingSourceControllerTest(t)
	ctx, _, response, decode := routingSourceContext(t, http.MethodPut, "/api/user/self/routing-sources/grok", map[string]string{"source_id": "premium"}, user.Id)
	ctx.Params = gin.Params{{Key: "family", Value: "grok"}}

	UpdateRoutingSource(ctx)
	decode()
	assert.False(t, response.Success)

	settings, err := model.GetUserSetting(user.Id, true)
	require.NoError(t, err)
	assert.Equal(t, "removed-source", settings.RoutingSources["grok"])
}
