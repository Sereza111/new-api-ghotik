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
		TokenQuotaPreConsumed:            120,
		TokenQuotaReservationInitialized: true,
	}
	info.SetEstimatePromptTokens(20)

	require.NoError(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":100}`)))
	require.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":0}`)), errResellerOutputTokenLimitRequired)
	require.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{}`)), errResellerOutputTokenLimitRequired)
	assert.ErrorIs(t, ValidateResellerOutboundHardCap(info, []byte(`{"max_output_tokens":200}`)), model.ErrResellerTokenQuotaInsufficient)
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
