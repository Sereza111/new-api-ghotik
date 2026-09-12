/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResellerRequestMaximumTokenQuotaByRelayFormat(t *testing.T) {
	maxOutput := uint(200)
	maxCompletion := uint(300)
	candidates := 2
	cases := []struct {
		name       string
		format     relaytypes.RelayFormat
		mode       int
		request    dto.Request
		want       int
		wantErr    error
		wantOutput bool
	}{
		{
			name:   "openai max completion and choices",
			format: relaytypes.RelayFormatOpenAI, mode: relayconstant.RelayModeChatCompletions,
			request: &dto.GeneralOpenAIRequest{MaxTokens: &maxOutput, MaxCompletionTokens: &maxCompletion, N: &candidates},
			want:    600, wantOutput: true,
		},
		{
			name:    "responses",
			format:  relaytypes.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{MaxOutputTokens: &maxOutput},
			want:    200, wantOutput: true,
		},
		{
			name:    "responses missing limit defers until channel selection",
			format:  relaytypes.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{},
			want:    0, wantOutput: true,
		},
		{
			name:    "claude",
			format:  relaytypes.RelayFormatClaude,
			request: &dto.ClaudeRequest{MaxTokens: &maxOutput},
			want:    200, wantOutput: true,
		},
		{
			name:    "gemini candidates",
			format:  relaytypes.RelayFormatGemini,
			request: &dto.GeminiChatRequest{GenerationConfig: dto.GeminiChatGenerationConfig{MaxOutputTokens: &maxOutput, CandidateCount: &candidates}},
			want:    400, wantOutput: true,
		},
		{
			name:    "openai embedding is input only",
			format:  relaytypes.RelayFormatEmbedding,
			request: &dto.EmbeddingRequest{Input: "input"},
			want:    0, wantOutput: false,
		},
		{
			name:    "rerank is input only",
			format:  relaytypes.RelayFormatRerank,
			request: &dto.RerankRequest{Documents: []any{"document"}, Query: "query"},
			want:    0, wantOutput: false,
		},
		{
			name:    "gemini embedding is input only",
			format:  relaytypes.RelayFormatGemini,
			request: &dto.GeminiEmbeddingRequest{},
			want:    0, wantOutput: false,
		},
		{
			name:   "missing openai limit",
			format: relaytypes.RelayFormatOpenAI, mode: relayconstant.RelayModeChatCompletions,
			request: &dto.GeneralOpenAIRequest{}, wantErr: errResellerOutputTokenLimitRequired, wantOutput: true,
		},
		{
			name:    "zero responses limit",
			format:  relaytypes.RelayFormatOpenAIResponses,
			request: &dto.OpenAIResponsesRequest{MaxOutputTokens: common.GetPointer(uint(0))}, wantErr: errResellerOutputTokenLimitRequired, wantOutput: true,
		},
		{
			name:    "responses compaction has no cap",
			format:  relaytypes.RelayFormatOpenAIResponsesCompaction,
			request: &dto.OpenAIResponsesCompactionRequest{}, wantErr: errResellerRequestHardCapUnsupported,
		},
		{
			name:    "realtime has no aggregate cap",
			format:  relaytypes.RelayFormatOpenAIRealtime,
			request: &dto.BaseRequest{}, wantErr: errResellerRequestHardCapUnsupported,
		},
		{
			name:    "gemini generation batch is not bounded",
			format:  relaytypes.RelayFormatGemini,
			request: &dto.GeminiChatRequest{Requests: []dto.GeminiChatRequest{{GenerationConfig: dto.GeminiChatGenerationConfig{MaxOutputTokens: &maxOutput}}}},
			wantErr: errResellerRequestHardCapUnsupported, wantOutput: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{RelayFormat: tc.format, RelayMode: tc.mode, Request: tc.request}
			quota, requiresOutput, err := resellerRequestOutputTokenQuota(info)
			if tc.wantErr != nil {
				require.Error(t, err)
				assert.ErrorIs(t, err, tc.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.want, quota)
			assert.Equal(t, tc.wantOutput, requiresOutput)
		})
	}
}

func TestResellerInputOnlyReservationRejectsUncountableInput(t *testing.T) {
	zero := 0
	cases := []struct {
		name    string
		request dto.Request
		wantErr error
	}{
		{
			name:    "numeric embedding token ids",
			request: &dto.EmbeddingRequest{Input: []any{float64(1), float64(2)}},
			wantErr: errResellerRequestHardCapUnsupported,
		},
		{
			name:    "empty rerank input",
			request: &dto.RerankRequest{},
			wantErr: errResellerRequestHardCapUnsupported,
		},
		{
			name:    "empty Gemini embedding input",
			request: &dto.GeminiEmbeddingRequest{},
			wantErr: errResellerRequestHardCapUnsupported,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var format relaytypes.RelayFormat = relaytypes.RelayFormatEmbedding
			if _, ok := tc.request.(*dto.RerankRequest); ok {
				format = relaytypes.RelayFormatRerank
			} else if _, ok := tc.request.(*dto.GeminiEmbeddingRequest); ok {
				format = relaytypes.RelayFormatGemini
			}
			info := &relaycommon.RelayInfo{RelayFormat: format, Request: tc.request}
			info.SetEstimatePromptTokens(zero)
			_, _, err := resellerRequestMaximumTokenQuota(info)
			require.Error(t, err)
			assert.ErrorIs(t, err, tc.wantErr)
		})
	}
}

func TestResellerChatToResponsesModeMutationStillUsesOpenAIOutputCap(t *testing.T) {
	maxOutput := uint(128)
	info := &relaycommon.RelayInfo{
		RelayFormat: relaytypes.RelayFormatOpenAI,
		RelayMode:   relayconstant.RelayModeResponses,
		Request:     &dto.GeneralOpenAIRequest{MaxTokens: &maxOutput},
	}
	quota, requiresOutput, err := resellerRequestOutputTokenQuota(info)
	require.NoError(t, err)
	assert.True(t, requiresOutput)
	assert.Equal(t, 128, quota)
}

func TestResellerOutboundHardCapRecountsFinalInput(t *testing.T) {
	info := &relaycommon.RelayInfo{
		TokenKey:                         "rsl_recount",
		RelayFormat:                      relaytypes.RelayFormatEmbedding,
		Request:                          &dto.EmbeddingRequest{Input: "short"},
		RequestConversionChain:           []relaytypes.RelayFormat{relaytypes.RelayFormatEmbedding},
		TokenQuotaPreConsumed:            4,
		TokenQuotaReservationInitialized: true,
	}
	info.SetEstimatePromptTokens(4)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(string(constant.ContextKeyOriginalModel), "text-embedding-3-small")

	// The final body is much larger than the estimate that was reserved.
	err := ValidateResellerOutboundHardCapWithContext(ctx, info, []byte(`{"input":"a substantially longer embedding input that must not fit"}`))
	require.Error(t, err)
	assert.ErrorIs(t, err, model.ErrResellerTokenQuotaInsufficient)
}

func TestResellerOutboundHardCapExtendsReservationBeforeRelay(t *testing.T) {
	truncate(t)
	seedUser(t, 301, 100_000)
	seedToken(t, 302, 301, "rsl_extend-final", 10_000)
	info := &relaycommon.RelayInfo{
		TokenId:         302,
		TokenKey:        "rsl_extend-final",
		UserId:          301,
		RelayFormat:     relaytypes.RelayFormatEmbedding,
		Request:         &dto.EmbeddingRequest{Input: "x"},
		BillingSource:   BillingSourceReseller,
		OriginModelName: "text-embedding-3-small",
	}
	info.SetEstimatePromptTokens(1)
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	ctx.Set(string(constant.ContextKeyOriginalModel), "text-embedding-3-small")
	require.Nil(t, PreConsumeBilling(ctx, 1, info))
	require.Equal(t, 1, info.Billing.GetPreConsumedQuota())

	err := ValidateResellerOutboundHardCapWithContext(ctx, info, []byte(`{"input":"this final provider input is substantially longer than the original reservation"}`))
	require.NoError(t, err)
	assert.Greater(t, info.Billing.GetPreConsumedQuota(), 1)

	var token model.Token
	require.NoError(t, model.DB.First(&token, 302).Error)
	assert.Equal(t, 10_000-info.Billing.GetPreConsumedQuota(), token.RemainQuota)
}

func TestResellerOutboundHardCapRejectsMissingOrChangedLimit(t *testing.T) {
	maxOutput := uint(100)
	info := &relaycommon.RelayInfo{
		TokenKey:                         "rsl_hard-cap-test",
		RelayFormat:                      relaytypes.RelayFormatOpenAIResponses,
		Request:                          &dto.OpenAIResponsesRequest{MaxOutputTokens: &maxOutput},
		RequestConversionChain:           []relaytypes.RelayFormat{relaytypes.RelayFormatOpenAIResponses},
		TokenQuotaPreConsumed:            450,
		TokenQuotaReservationInitialized: true,
	}
	info.SetEstimatePromptTokens(20)

	require.NoError(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":100}`)))
	require.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":0}`)), errResellerOutputTokenLimitRequired)
	require.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{}`)), errResellerOutputTokenLimitRequired)
	assert.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":200}`)), model.ErrResellerTokenQuotaInsufficient)
}

func TestResellerCodexResponsesUsesTrustedOutputCeiling(t *testing.T) {
	info := &relaycommon.RelayInfo{
		TokenKey:                         "rsl_codex-ceiling",
		RelayFormat:                      relaytypes.RelayFormatOpenAIResponses,
		Request:                          &dto.OpenAIResponsesRequest{},
		ChannelMeta:                      &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeCodex, UpstreamModelName: "gpt-5.6-sol"},
		TokenQuotaPreConsumed:            290 + relayconstant.CodexMaxOutputTokens,
		TokenQuotaReservationInitialized: true,
	}
	info.SetEstimatePromptTokens(20)

	require.NoError(t, ValidateResellerOutboundHardCap(info, []byte(`{}`)))
	info.TokenQuotaPreConsumed--
	assert.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{}`)), model.ErrResellerTokenQuotaInsufficient)
}

func TestResellerCodexResponsesMissingLimitAllowsConcurrentReservations(t *testing.T) {
	truncate(t)
	seedUser(t, 303, 100_000)
	seedToken(t, 304, 303, "rsl_codex-concurrent", 300_000)

	newRequest := func() *relaycommon.RelayInfo {
		info := &relaycommon.RelayInfo{
			TokenId:     304,
			TokenKey:    "rsl_codex-concurrent",
			UserId:      303,
			RelayFormat: relaytypes.RelayFormatOpenAIResponses,
			Request:     &dto.OpenAIResponsesRequest{},
		}
		info.SetEstimatePromptTokens(10)
		return info
	}

	first := newRequest()
	second := newRequest()
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())
	require.Nil(t, PreConsumeBilling(ctx, 1, first))
	require.Nil(t, PreConsumeBilling(ctx, 1, second))
	assert.Equal(t, 10, first.Billing.GetPreConsumedQuota())
	assert.Equal(t, 10, second.Billing.GetPreConsumedQuota())

	first.ChannelMeta = &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeCodex, UpstreamModelName: "gpt-5.6-sol"}
	second.ChannelMeta = &relaycommon.ChannelMeta{ChannelType: constant.ChannelTypeCodex, UpstreamModelName: "gpt-5.6-sol"}
	require.NoError(t, ValidateResellerOutboundHardCap(first, []byte(`{}`)))
	require.NoError(t, ValidateResellerOutboundHardCap(second, []byte(`{}`)))
	assert.Equal(t, 290+relayconstant.CodexMaxOutputTokens, first.Billing.GetPreConsumedQuota())
	assert.Equal(t, 290+relayconstant.CodexMaxOutputTokens, second.Billing.GetPreConsumedQuota())

	var token model.Token
	require.NoError(t, model.DB.First(&token, 304).Error)
	assert.Equal(t, 300_000-2*(290+relayconstant.CodexMaxOutputTokens), token.RemainQuota)
}

func TestResellerResponsesReservationsCoverAgentHistory(t *testing.T) {
	body := []byte(`{"model":"gpt-5.6-sol","input":[{"type":"function_call_output","call_id":"call_1","output":"` + strings.Repeat("tool output ", 20_000) + `"},{"role":"assistant","content":[{"type":"output_text","text":"История"}]}],"tools":[{"type":"function","name":"read","parameters":{"properties":{"file_id":{"type":"string"}}}}]}`)
	info := &relaycommon.RelayInfo{TokenKey: "rsl_bound", RelayFormat: relaytypes.RelayFormatOpenAIResponses,
		Request: &dto.OpenAIResponsesRequest{}, TokenQuotaPreConsumed: 150_000}
	info.SetEstimatePromptTokens(11_000)
	err := ValidateResellerOutboundHardCap(info, body)
	require.ErrorIs(t, err, model.ErrResellerTokenQuotaInsufficient)
	info.TokenQuotaPreConsumed = 1_000_000
	require.NoError(t, ValidateResellerOutboundHardCap(info, body))
	quota, err := resellerResponsesInputTokenQuota(body, 11_000, "gpt-5.6-sol")
	require.NoError(t, err)
	assert.GreaterOrEqual(t, quota, len(body))
}

func TestResellerResponsesHiddenHistoryRequiresFullContextReservation(t *testing.T) {
	for _, field := range []string{
		`"previous_response_id":"resp_saved"`,
		`"conversation":"conv_saved"`,
		`"input":[{"type":"reasoning","id":"reasoning_saved"}]`,
		`"input":[{"type":"compaction"}]`,
		`"input":[{"type":"item_reference","id":"item_saved"}]`,
		`"prompt":{"id":"stored_prompt"}`,
	} {
		t.Run(field, func(t *testing.T) {
			body := []byte(`{"model":"gpt-5.6-sol",` + field + `}`)
			info := &relaycommon.RelayInfo{TokenKey: "rsl_hidden", RelayFormat: relaytypes.RelayFormatOpenAIResponses,
				Request: &dto.OpenAIResponsesRequest{}, TokenQuotaPreConsumed: 1_000_000}
			require.ErrorIs(t, ValidateResellerOutboundHardCap(info, body), model.ErrResellerTokenQuotaInsufficient)
			info.TokenQuotaPreConsumed = 1_050_000
			require.NoError(t, ValidateResellerOutboundHardCap(info, body))
			unknown := []byte(`{"model":"unknown",` + field + `}`)
			_, err := resellerResponsesInputTokenQuota(unknown, 10, "gpt-5.6-sol")
			require.ErrorIs(t, err, errResellerRequestHardCapUnsupported)
		})
	}
	for _, body := range []string{
		`{"tools":[{"type":"web_search"}]}`,
		`{"input":[{"type":"input_file"}]}`,
		`{"input":[{"id":"hidden_message"}]}`,
	} {
		_, err := resellerResponsesInputTokenQuota([]byte(body), 10, "gpt-5.6-sol")
		require.ErrorIs(t, err, errResellerRequestHardCapUnsupported)
	}
}

func TestResellerResponsesExplicitCodexHistoryFitsOneMillionTokenKey(t *testing.T) {
	input := `[
		{"type":"reasoning","id":"reasoning_1","encrypted_content":"opaque-state","summary":[]},
		{"type":"configuration_update","reasoning":{"effort":"high"}},
		{"type":"local_shell_call","call_id":"local_1","action":{"type":"exec","command":["rg","needle"]}},
		{"type":"local_shell_call_output","id":"local_1","output":"{\"stdout\":\"match\"}"},
		{"type":"shell_call","call_id":"shell_1","action":{"commands":["go test ./service"]}},
		{"type":"shell_call_output","call_id":"shell_1","output":[{"stdout":"ok","stderr":"","outcome":{"type":"exit","exit_code":0}}]},
		{"type":"apply_patch_call","call_id":"patch_1","operation":{"type":"update_file","path":"service/reseller_quota.go","diff":"@@"}},
		{"type":"apply_patch_call_output","call_id":"patch_1","status":"completed","output":"Done"},
		{"type":"computer_call","call_id":"computer_1","action":{"type":"screenshot"}},
		{"type":"mcp_approval_response","approval_request_id":"approval_1","approve":true},
		{"type":"program_output","id":"program_1","call_id":"call_1","result":"done","status":"completed"}
	]`
	body := []byte(`{"model":"gpt-6-astra","input":` + input + `}`)
	info := &relaycommon.RelayInfo{TokenKey: "rsl_explicit_history", RelayFormat: relaytypes.RelayFormatOpenAIResponses,
		Request: &dto.OpenAIResponsesRequest{}, TokenQuotaPreConsumed: 1_000_000}
	require.NoError(t, ValidateResellerOutboundHardCap(info, body))
	quota, err := resellerResponsesInputTokenQuota(body, 10, "gpt-6-astra")
	require.NoError(t, err)
	assert.GreaterOrEqual(t, quota, len(body))
	assert.Less(t, quota, 1_000_000-relayconstant.CodexMaxOutputTokens)
}

func TestResellerResponsesMediaRequiresContextReservation(t *testing.T) {
	for _, input := range []string{
		`[{"role":"user","content":[{"type":"input_text","text":"Describe this screenshot"},{"type":"input_image","image_url":"data:image/png;base64,cG5n","detail":"auto"}]}]`,
		`[{"role":"user","content":[{"type":"input_image","image_url":"https://example.com/image.png"}]}]`,
		`[{"role":"user","content":[{"type":"input_image","file_id":"file_image"}]}]`,
		`[{"role":"user","content":[{"type":"input_file","file_id":"file_document"}]}]`,
		`[{"role":"user","content":[{"type":"input_file","file_url":"https://example.com/document.pdf"}]}]`,
		`[{"role":"user","content":[{"type":"input_file","file_data":"data:application/pdf;base64,cGRm","filename":"report.pdf"}]}]`,
		`[{"type":"function_call_output","call_id":"call_1","output":[{"type":"input_image","image_url":"data:image/png;base64,cG5n"}]}]`,
		`[{"type":"custom_tool_call_output","call_id":"call_1","output":[{"type":"input_file","file_id":"file_result"}]}]`,
		`[{"type":"computer_call_output","call_id":"call_1","output":{"type":"computer_screenshot","image_url":"data:image/png;base64,cG5n"}}]`,
	} {
		t.Run(input, func(t *testing.T) {
			body := []byte(`{"model":"gpt-6-astra","input":` + input + `}`)
			info := &relaycommon.RelayInfo{TokenKey: "rsl_media", RelayFormat: relaytypes.RelayFormatOpenAIResponses,
				Request: &dto.OpenAIResponsesRequest{}, TokenQuotaPreConsumed: 1_000_000}
			require.ErrorIs(t, ValidateResellerOutboundHardCap(info, body), model.ErrResellerTokenQuotaInsufficient)
			info.TokenQuotaPreConsumed = 1_050_000
			require.NoError(t, ValidateResellerOutboundHardCap(info, body))
			quota, err := resellerResponsesInputTokenQuota(body, 10, "gpt-6-astra")
			require.NoError(t, err)
			assert.Equal(t, 1_050_000, quota)
			unknownModel := []byte(`{"model":"unknown","input":` + input + `}`)
			_, err = resellerResponsesInputTokenQuota(unknownModel, 10, "gpt-6-astra")
			require.ErrorIs(t, err, errResellerRequestHardCapUnsupported)
		})
	}
	for _, input := range []string{
		`[{"role":"user","content":[{"type":"input_image"}]}]`,
		`[{"role":"user","content":[{"type":"input_file","file_id":123}]}]`,
		`[{"type":"computer_call_output","output":{"type":"computer_screenshot"}}]`,
		`[{"role":"user","content":[{"type":"unknown_media","url":"https://example.com"}]}]`,
	} {
		_, err := resellerResponsesInputTokenQuota([]byte(`{"model":"gpt-6-astra","input":`+input+`}`), 10, "gpt-6-astra")
		require.ErrorIs(t, err, errResellerRequestHardCapUnsupported)
	}
}

func TestResellerResponsesClientToolSearchReservation(t *testing.T) {
	for _, field := range []string{
		`"tools":[{"type":"tool_search","execution":"client"},{"type":"namespace","name":"fs","tools":[{"type":"function","name":"read","parameters":{"type":"object","properties":{"type":{"type":"string"},"input_image":{"type":"string"}}}}]}]`,
		`"input":[{"type":"tool_search_call","execution":"client","call_id":"search_1","arguments":{"paths":["fs"]}},{"type":"tool_search_output","execution":"client","call_id":"search_1","tools":[{"type":"namespace","name":"fs","tools":[{"type":"custom","name":"read"}]}]}]`,
		`"input":[{"type":"additional_tools","role":"developer","tools":[{"type":"function","name":"read","parameters":{"type":"object"}}]}]`,
	} {
		body := []byte(`{"model":"gpt-6-astra",` + field + `}`)
		quota, err := resellerResponsesInputTokenQuota(body, 10, "gpt-6-astra")
		require.NoError(t, err)
		assert.GreaterOrEqual(t, quota, len(body))
		assert.Less(t, quota, 1_050_000)
	}
	for _, tool := range []string{
		`{"type":"web_search"}`,
		`{"type":"tool_search"}`,
		`{"type":"tool_search","execution":"server"}`,
		`{"type":"namespace","name":"hidden","tools":[{"type":"web_search"}]}`,
	} {
		for _, field := range []string{
			`"tools":[` + tool + `]`,
			`"input":[{"type":"tool_search_output","execution":"client","tools":[` + tool + `]}]`,
			`"input":[{"type":"additional_tools","role":"developer","tools":[` + tool + `]}]`,
		} {
			body := []byte(`{"model":"gpt-6-astra",` + field + `}`)
			_, err := resellerResponsesInputTokenQuota(body, 10, "gpt-6-astra")
			require.ErrorIs(t, err, errResellerRequestHardCapUnsupported)
		}
	}
}

func TestAuthoritativeResellerUsageRejectsInvalidCounters(t *testing.T) {
	for _, usage := range []*dto.Usage{
		{PromptTokens: -1, CompletionTokens: 10},
		{PromptTokens: 100, CompletionTokens: -1},
		{PromptTokens: 100, CompletionTokens: 10, PromptTokensDetails: dto.InputTokenDetails{CachedTokens: 101}},
		{PromptTokens: 100, CompletionTokens: 10, InputTokensDetails: &dto.InputTokenDetails{CachedTokens: -1}},
	} {
		_, _, authoritative := authoritativeTextTokenQuota(usage, false, 1)
		assert.False(t, authoritative)
	}
}

func TestResellerCodexResponsesChecksFinalUpstreamModel(t *testing.T) {
	tests := []struct {
		name          string
		mappedModel   string
		body          string
		wantErr       error
		wantOutputCap int
	}{
		{
			name:          "mapped upstream model fallback",
			mappedModel:   "gpt-5.6-sol",
			body:          `{"max_output_tokens":1}`,
			wantOutputCap: relayconstant.CodexMaxOutputTokens,
		},
		{
			name:          "final parameter override model",
			mappedModel:   "provider-alias-without-a-trusted-limit",
			body:          `{"model":"gpt-6-astra"}`,
			wantOutputCap: relayconstant.CodexMaxOutputTokens,
		},
		{
			name:        "unknown final model fails closed",
			mappedModel: "gpt-5.6-sol",
			body:        `{"model":"unknown-codex-model"}`,
			wantErr:     errResellerRequestHardCapUnsupported,
		},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			info := &relaycommon.RelayInfo{
				ChannelMeta: &relaycommon.ChannelMeta{
					ChannelType:       constant.ChannelTypeCodex,
					UpstreamModelName: testCase.mappedModel,
				},
			}
			quota, err := resellerOutboundOutputTokenQuota(info, relaytypes.RelayFormatOpenAIResponses, []byte(testCase.body))
			if testCase.wantErr != nil {
				require.Error(t, err)
				assert.ErrorIs(t, err, testCase.wantErr)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, testCase.wantOutputCap, quota)
		})
	}
}

func TestResellerOpenAIResponsesUsesKnownModelCeilingWhenLimitIsMissing(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gpt-5.6-sol",
		},
	}

	quota, err := resellerOutboundOutputTokenQuota(
		info,
		relaytypes.RelayFormatOpenAIResponses,
		[]byte(`{"model":"gpt-5.6-sol"}`),
	)

	require.NoError(t, err)
	assert.Equal(t, relayconstant.CodexMaxOutputTokens, quota)
}

func TestResellerOpenAIResponsesKeepsExplicitOutputLimit(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gpt-5.6-sol",
		},
	}

	quota, err := resellerOutboundOutputTokenQuota(
		info,
		relaytypes.RelayFormatOpenAIResponses,
		[]byte(`{"model":"gpt-5.6-sol","max_output_tokens":512}`),
	)

	require.NoError(t, err)
	assert.Equal(t, 512, quota)
}

func TestEstimateRequestTokenCountsResellerWhenGlobalCountingDisabled(t *testing.T) {
	previous := constant.CountToken
	constant.CountToken = false
	defer func() { constant.CountToken = previous }()

	meta := &relaytypes.TokenCountMeta{CombineText: "a short reseller prompt"}
	reseller := &relaycommon.RelayInfo{TokenKey: "rsl_counting", RelayFormat: relaytypes.RelayFormatOpenAI}
	ordinary := &relaycommon.RelayInfo{TokenKey: "ordinary", RelayFormat: relaytypes.RelayFormatOpenAI}
	ctx, _ := gin.CreateTestContext(httptest.NewRecorder())

	resellerTokens, err := EstimateRequestToken(ctx, meta, reseller)
	require.NoError(t, err)
	assert.Greater(t, resellerTokens, 0)
	ordinaryTokens, err := EstimateRequestToken(ctx, meta, ordinary)
	require.NoError(t, err)
	assert.Zero(t, ordinaryTokens)
}
