package service

import (
	"strconv"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	rootdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func configureRoutingSourceTest(t *testing.T, maxGroups string) {
	t.Helper()
	originalMax := setting.GetMaxTokenAutoGroups()
	originalGroups := setting.UserUsableGroups2JSONString()
	originalRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateMaxTokenAutoGroups(maxGroups))
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default route","premium":"Premium route","revoked":"Revoked route"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"premium":2}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateMaxTokenAutoGroups(strconv.Itoa(originalMax)))
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalRatios))
	})
}

func TestRoutingModelFamily(t *testing.T) {
	tests := []struct {
		modelName string
		want      string
	}{
		{modelName: "gpt-5.6-sol", want: "gpt"},
		{modelName: "openai/o3-mini", want: "gpt"},
		{modelName: "anthropic/claude-sonnet-4", want: "claude"},
		{modelName: "gemini-2.5-pro", want: "gemini"},
		{modelName: "grok-4", want: "grok"},
		{modelName: "deepseek-chat", want: "deepseek"},
		{modelName: "chatglm-4", want: "glm"},
		{modelName: "accounts/fireworks/models/llama", want: "llama"},
		{modelName: "", want: ""},
	}
	for _, test := range tests {
		t.Run(test.modelName, func(t *testing.T) {
			assert.Equal(t, test.want, RoutingModelFamily(test.modelName))
		})
	}
}

func TestApplyRoutingSourcePreferenceOverridesFixedTokenWithFallback(t *testing.T) {
	configureRoutingSourceTest(t, "5")
	ctx, _ := gin.CreateTestContext(nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenCrossGroupRetry, false)
	common.SetContextKey(ctx, constant.ContextKeyUserSetting, dto.UserSetting{
		RoutingSources: map[string]string{"gpt": "premium"},
	})

	require.True(t, ApplyRoutingSourcePreference(ctx, "gpt-5.6-sol", ""))
	assert.Equal(t, "auto", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
	assert.Equal(t, "auto", common.GetContextKeyString(ctx, constant.ContextKeyTokenGroup))
	assert.Equal(t, []string{"premium", "default"}, common.GetContextKeyStringSlice(ctx, constant.ContextKeyTokenAutoGroups))
	assert.True(t, common.GetContextKeyBool(ctx, constant.ContextKeyTokenCrossGroupRetry))
}

func TestApplyRoutingSourcePreferencePreservesRouteWithoutPreference(t *testing.T) {
	configureRoutingSourceTest(t, "5")
	ctx, _ := gin.CreateTestContext(nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUserSetting, dto.UserSetting{})

	assert.False(t, ApplyRoutingSourcePreference(ctx, "gpt-5.6-sol", ""))
	assert.Equal(t, "default", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
	assert.Equal(t, "default", common.GetContextKeyString(ctx, constant.ContextKeyTokenGroup))
	_, exists := common.GetContextKey(ctx, constant.ContextKeyTokenAutoGroups)
	assert.False(t, exists)
}

func TestApplyRoutingSourcePreferenceFailsSafe(t *testing.T) {
	configureRoutingSourceTest(t, "5")
	tests := []struct {
		name          string
		selected      string
		explicitGroup string
		pin           bool
	}{
		{name: "revoked source", selected: "revoked"},
		{name: "stale source", selected: "missing"},
		{name: "explicit playground group", selected: "premium", explicitGroup: "default"},
		{name: "pinned channel", selected: "premium", pin: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx, _ := gin.CreateTestContext(nil)
			common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
			common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
			common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
			common.SetContextKey(ctx, constant.ContextKeyUserSetting, dto.UserSetting{
				RoutingSources: map[string]string{"gpt": test.selected},
			})
			if test.pin {
				GetChannelConstraints(ctx).AddPin(rootdto.ChannelPin{ChannelId: 9, Source: rootdto.PinSourceToken})
			}

			assert.False(t, ApplyRoutingSourcePreference(ctx, "gpt-5.6-sol", test.explicitGroup))
			assert.Equal(t, "default", common.GetContextKeyString(ctx, constant.ContextKeyUsingGroup))
		})
	}
}

func TestApplyRoutingSourcePreferenceKeepsFixedFallbackWhenAutoGroupLimitIsOne(t *testing.T) {
	configureRoutingSourceTest(t, "1")
	ctx, _ := gin.CreateTestContext(nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUserSetting, dto.UserSetting{
		RoutingSources: map[string]string{"gpt": "premium"},
	})

	require.True(t, ApplyRoutingSourcePreference(ctx, "gpt-5.6-sol", ""))
	assert.Equal(t, []string{"premium", "default"}, common.GetContextKeyStringSlice(ctx, constant.ContextKeyTokenAutoGroups))
	assert.Equal(t, []string{"premium", "default"}, GetRequestAutoGroups(ctx, "default"))
}

func TestApplyRoutingSourcePreferencePreservesInheritedGlobalAutoGroups(t *testing.T) {
	configureRoutingSourceTest(t, "1")
	originalAutoGroups := setting.AutoGroups2JsonString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default route","premium":"Premium route","secondary":"Secondary route"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"premium":2,"secondary":1}`))
	require.NoError(t, setting.UpdateAutoGroupsByJsonString(`["default","secondary"]`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateAutoGroupsByJsonString(originalAutoGroups))
	})

	ctx, _ := gin.CreateTestContext(nil)
	common.SetContextKey(ctx, constant.ContextKeyUserGroup, "default")
	common.SetContextKey(ctx, constant.ContextKeyUsingGroup, "auto")
	common.SetContextKey(ctx, constant.ContextKeyTokenGroup, "auto")
	common.SetContextKey(ctx, constant.ContextKeyUserSetting, dto.UserSetting{
		RoutingSources: map[string]string{"gpt": "premium"},
	})

	require.True(t, ApplyRoutingSourcePreference(ctx, "gpt-5.6-sol", ""))
	assert.Equal(t, []string{"premium", "default", "secondary"}, GetRequestAutoGroups(ctx, "default"))
}
