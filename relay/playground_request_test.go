package relay

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel/sub2api"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundHostedSearch(t *testing.T) {
	for _, tc := range []struct {
		name        string
		channel     int
		model       string
		playground  bool
		passthrough bool
		wantSearch  bool
	}{
		{"native Claude", constant.ChannelTypeAnthropic, "claude-opus-4-6", true, false, true},
		{"native Gemini", constant.ChannelTypeGemini, "gemini-3.1-pro-preview", true, false, true},
		{"OpenAI search model", constant.ChannelTypeOpenAI, "gpt-5-search-api", true, false, true},
		{"ordinary OpenAI", constant.ChannelTypeOpenAI, "gpt-5.2", true, false, false},
		{"unverified proxy protocol", constant.ChannelTypeSub2API, "gemini-3.1-pro-preview", true, false, false},
		{"image model", constant.ChannelTypeGemini, "gemini-3-pro-image-preview", true, false, false},
		{"non-playground request", constant.ChannelTypeAnthropic, "claude-opus-4-6", false, false, false},
		{"passthrough body", constant.ChannelTypeAnthropic, "claude-opus-4-6", true, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{IsPlayground: tc.playground, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tc.channel}}
			request := &dto.GeneralOpenAIRequest{Model: tc.model}
			applyPlaygroundWebSearch(info, request, tc.passthrough)
			assert.Equal(t, tc.wantSearch, request.WebSearchOptions != nil)
		})
	}

	t.Run("preserves explicit search and tool choices", func(t *testing.T) {
		info := &relaycommon.RelayInfo{IsPlayground: true, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeAnthropic}}
		request := &dto.GeneralOpenAIRequest{Model: "claude-opus-4-6", ToolChoice: "none"}
		applyPlaygroundWebSearch(info, request, false)
		assert.Nil(t, request.WebSearchOptions)
		request.WebSearchOptions = &dto.WebSearchOptions{SearchContextSize: "low"}
		applyPlaygroundWebSearch(info, request, false)
		assert.Equal(t, "low", request.WebSearchOptions.SearchContextSize)
	})

	for _, tc := range []struct {
		name    string
		channel int
		model   string
		format  types.RelayFormat
		tool    string
	}{
		{"Anthropic native tool", constant.ChannelTypeAnthropic, "claude-opus-4-6", types.RelayFormatClaude, "web_search_20250305"},
		{"Gemini native tool", constant.ChannelTypeGemini, "gemini-3.1-pro-preview", types.RelayFormatGemini, "googleSearch"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest("POST", "/pg/chat/completions", nil)
			info := &relaycommon.RelayInfo{IsPlayground: true, RelayFormat: types.RelayFormatOpenAI, ChannelMeta: &relaycommon.ChannelMeta{ChannelType: tc.channel, UpstreamModelName: tc.model}}
			request := &dto.GeneralOpenAIRequest{Model: tc.model, Messages: []dto.Message{{Role: "user", Content: "What changed today?"}}}
			applyPlaygroundWebSearch(info, request, false)
			converted, err := service.ConvertRequest(c, info, tc.format, request)
			require.NoError(t, err)
			body, err := common.Marshal(converted.Value)
			require.NoError(t, err)
			assert.Contains(t, string(body), tc.tool)
			assert.NotContains(t, string(body), `"tool_choice":"required"`)
		})
	}
}

func TestPlaygroundSub2APIClaudeNativeEffort(t *testing.T) {
	for _, effort := range []string{"none", "low", "high", "max"} {
		t.Run(effort, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("POST", "/pg/chat/completions", nil)
			info := &relaycommon.RelayInfo{
				IsPlayground: true, RelayFormat: types.RelayFormatOpenAI, RelayMode: relayconstant.RelayModeChatCompletions,
				RequestURLPath: "/v1/chat/completions",
				ChannelMeta:    &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeSub2API, ChannelBaseUrl: "https://gateway.example", ApiKey: "test-key", UpstreamModelName: "claude-opus-4-6", ChannelSetting: dto.ChannelSettings{SystemPrompt: "Follow the channel instructions.", SystemPromptOverride: true}},
			}
			adaptor := &sub2api.Adaptor{}
			request := &dto.GeneralOpenAIRequest{Model: "claude-opus-4-6", ReasoningEffort: effort, Messages: []dto.Message{{Role: "system", Content: "User instructions."}, {Role: "user", Content: "hello"}}}
			applyPlaygroundWebSearch(info, request, false)
			converted, err := convertTextRequest(c, info, adaptor, request)
			require.NoError(t, err)
			body, err := common.Marshal(converted)
			require.NoError(t, err)
			var native dto.ClaudeRequest
			require.NoError(t, common.Unmarshal(body, &native))
			require.NotNil(t, native.Thinking)
			if effort == "none" {
				assert.Equal(t, "disabled", native.Thinking.Type)
			} else {
				assert.Equal(t, "adaptive", native.Thinking.Type)
				assert.Contains(t, string(body), `"effort":"`+effort+`"`)
			}
			assert.Contains(t, string(body), "web_search_20250305")
			assert.NotContains(t, string(body), "budget_tokens")
			assert.Equal(t, 1, strings.Count(string(body), "Follow the channel instructions."))
			assert.Contains(t, string(body), "User instructions.")
			url, err := adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, "https://gateway.example/v1/messages", url)
			headers := make(http.Header)
			require.NoError(t, adaptor.SetupRequestHeader(c, &headers, info))
			assert.Equal(t, "2023-06-01", headers.Get("anthropic-version"))
			assert.Equal(t, "Bearer test-key", headers.Get("Authorization"))
			assert.Equal(t, "test-key", headers.Get("x-api-key"))
			response := &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-4-6","content":[{"type":"text","text":"Ready"}],"stop_reason":"end_turn","usage":{"input_tokens":3,"output_tokens":2}}`))}
			usage, responseErr := adaptor.DoResponse(c, response, info)
			require.Nil(t, responseErr)
			require.IsType(t, &dto.Usage{}, usage)
			assert.Equal(t, 5, usage.(*dto.Usage).TotalTokens)
			assert.Contains(t, recorder.Body.String(), `"content":"Ready"`)
			assert.Contains(t, recorder.Body.String(), `"choices"`)
			info.IsPlayground = false
			url, err = adaptor.GetRequestURL(info)
			require.NoError(t, err)
			assert.Equal(t, "https://gateway.example/v1/chat/completions", url)
		})
	}
}

func TestPlaygroundSub2APIClaudeStream(t *testing.T) {
	previousTimeout := constant.StreamingTimeout
	constant.StreamingTimeout = 30
	t.Cleanup(func() { constant.StreamingTimeout = previousTimeout })
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest("POST", "/pg/chat/completions", nil)
	info := &relaycommon.RelayInfo{
		IsPlayground: true, IsStream: true, DisablePing: true, ShouldIncludeUsage: true,
		RelayFormat: types.RelayFormatOpenAI, RelayMode: relayconstant.RelayModeChatCompletions,
		ChannelMeta: &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeSub2API, UpstreamModelName: "claude-opus-4-6"},
	}
	body := strings.Join([]string{
		`data: {"type":"message_start","message":{"id":"msg_stream","model":"claude-opus-4-6","usage":{"input_tokens":3,"cache_read_input_tokens":7}}}`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Checking"}}`,
		`data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Ready"}}`,
		`data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`,
		`data: {"type":"message_stop"}`,
		"",
	}, "\n\n")
	response := &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": {"text/event-stream"}}, Body: io.NopCloser(strings.NewReader(body))}
	usage, apiErr := (&sub2api.Adaptor{}).DoResponse(c, response, info)
	require.Nil(t, apiErr)
	require.IsType(t, &dto.Usage{}, usage)
	assert.Equal(t, "anthropic", usage.(*dto.Usage).UsageSemantic)
	assert.Equal(t, 3, usage.(*dto.Usage).PromptTokens)
	assert.Equal(t, 7, usage.(*dto.Usage).PromptTokensDetails.CachedTokens)
	assert.Equal(t, 2, usage.(*dto.Usage).CompletionTokens)
	assert.Contains(t, recorder.Body.String(), `"reasoning_content":"Checking"`)
	assert.Contains(t, recorder.Body.String(), `"content":"Ready"`)
	assert.Contains(t, recorder.Body.String(), `"finish_reason":"stop"`)
	assert.Contains(t, recorder.Body.String(), "[DONE]")
}
