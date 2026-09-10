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
	"bytes"
	"errors"
	"fmt"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	relaytypes "github.com/QuantumNous/new-api/relaykit/types"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
)

var (
	errResellerOutputTokenLimitRequired  = errors.New("finite reseller token keys require an explicit non-zero output token limit")
	errResellerRequestHardCapUnsupported = errors.New("finite reseller token key cannot enforce a hard cap for this request")
)

func isResellerBilling(relayInfo *relaycommon.RelayInfo) bool {
	return relayInfo != nil &&
		(relayInfo.BillingSource == BillingSourceReseller || model.IsResellerTokenKey(relayInfo.TokenKey))
}

func usesRawTokenQuota(relayInfo *relaycommon.RelayInfo) bool {
	return isResellerBilling(relayInfo) ||
		(relayInfo != nil && relayInfo.TokenQuotaMode == model.TokenQuotaModeTokens)
}

// tracksRawTokenQuota reports whether a raw-token key has a finite allocation
// that must be reserved and settled. Unlimited keys retain the historical
// money-quota semantics: they are still billed through the user's wallet or
// subscription, but no token-key balance is mutated.
func tracksRawTokenQuota(relayInfo *relaycommon.RelayInfo) bool {
	return usesRawTokenQuota(relayInfo) && relayInfo != nil && !relayInfo.TokenUnlimited
}

func resellerTokenQuota(parts ...int) (int, *common.QuotaClamp) {
	total := decimal.Zero
	for _, part := range parts {
		if part > 0 {
			total = total.Add(decimal.NewFromInt(int64(part)))
		}
	}
	return common.QuotaFromDecimalChecked(total)
}

func resellerOutputTokenQuota(limit uint, candidates *int) (int, error) {
	if limit == 0 {
		return 0, errResellerOutputTokenLimitRequired
	}
	if limit > uint(common.MaxQuota) {
		return 0, fmt.Errorf("%w: output token limit exceeds %d", errResellerRequestHardCapUnsupported, common.MaxQuota)
	}

	count := 1
	if candidates != nil {
		count = *candidates
	}
	if count <= 0 {
		return 0, fmt.Errorf("%w: output candidate count must be positive", errResellerRequestHardCapUnsupported)
	}
	if count > common.MaxQuota/int(limit) {
		return 0, fmt.Errorf("%w: total output token limit exceeds %d", errResellerRequestHardCapUnsupported, common.MaxQuota)
	}
	return int(limit) * count, nil
}

func resellerOpenAIOutputTokenQuota(request *dto.GeneralOpenAIRequest) (int, error) {
	if request == nil {
		return 0, fmt.Errorf("%w: OpenAI request is missing", errResellerRequestHardCapUnsupported)
	}
	maxTokens := uint(0)
	if request.MaxTokens != nil {
		maxTokens = *request.MaxTokens
	}
	if request.MaxCompletionTokens != nil && *request.MaxCompletionTokens > maxTokens {
		maxTokens = *request.MaxCompletionTokens
	}
	return resellerOutputTokenQuota(maxTokens, request.N)
}

func resellerGeminiOutputTokenQuota(request *dto.GeminiChatRequest) (int, error) {
	if request == nil {
		return 0, fmt.Errorf("%w: Gemini request is missing", errResellerRequestHardCapUnsupported)
	}
	if len(request.Requests) != 0 {
		return 0, fmt.Errorf("%w: Gemini batch generation is not supported", errResellerRequestHardCapUnsupported)
	}
	maxTokens := uint(0)
	if request.GenerationConfig.MaxOutputTokens != nil {
		maxTokens = *request.GenerationConfig.MaxOutputTokens
	}
	return resellerOutputTokenQuota(maxTokens, request.GenerationConfig.CandidateCount)
}

// resellerRequestOutputTokenQuota returns the maximum output charged to a
// finite reseller allocation. Input-only formats return requiresOutput=false.
func resellerRequestOutputTokenQuota(relayInfo *relaycommon.RelayInfo) (quota int, requiresOutput bool, err error) {
	if relayInfo == nil || relayInfo.Request == nil {
		return 0, false, fmt.Errorf("%w: request metadata is missing", errResellerRequestHardCapUnsupported)
	}

	switch relayInfo.RelayFormat {
	case relaytypes.RelayFormatOpenAI:
		request, ok := relayInfo.Request.(*dto.GeneralOpenAIRequest)
		if !ok {
			return 0, false, fmt.Errorf("%w: expected OpenAI request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
		quota, err = resellerOpenAIOutputTokenQuota(request)
		return quota, true, err
	case relaytypes.RelayFormatOpenAIResponses:
		request, ok := relayInfo.Request.(*dto.OpenAIResponsesRequest)
		if !ok {
			return 0, false, fmt.Errorf("%w: expected Responses request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
		if request.MaxOutputTokens == nil {
			// The selected channel is not available during pre-consume. Defer a
			// missing Responses cap until the final outbound body is validated;
			// only Codex channels may substitute their trusted upstream ceiling.
			return 0, true, nil
		}
		quota, err = resellerOutputTokenQuota(*request.MaxOutputTokens, nil)
		return quota, true, err
	case relaytypes.RelayFormatClaude:
		request, ok := relayInfo.Request.(*dto.ClaudeRequest)
		if !ok {
			return 0, false, fmt.Errorf("%w: expected Claude request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
		maxTokens := uint(0)
		if request.MaxTokens != nil {
			maxTokens = *request.MaxTokens
		}
		quota, err = resellerOutputTokenQuota(maxTokens, nil)
		return quota, true, err
	case relaytypes.RelayFormatGemini:
		switch request := relayInfo.Request.(type) {
		case *dto.GeminiChatRequest:
			quota, err = resellerGeminiOutputTokenQuota(request)
			return quota, true, err
		case *dto.GeminiEmbeddingRequest, *dto.GeminiBatchEmbeddingRequest:
			return 0, false, nil
		default:
			return 0, false, fmt.Errorf("%w: expected Gemini request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
	case relaytypes.RelayFormatEmbedding:
		if _, ok := relayInfo.Request.(*dto.EmbeddingRequest); !ok {
			return 0, false, fmt.Errorf("%w: expected embedding request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
		return 0, false, nil
	case relaytypes.RelayFormatRerank:
		if _, ok := relayInfo.Request.(*dto.RerankRequest); !ok {
			return 0, false, fmt.Errorf("%w: expected rerank request, got %T", errResellerRequestHardCapUnsupported, relayInfo.Request)
		}
		return 0, false, nil
	case relaytypes.RelayFormatOpenAIResponsesCompaction:
		return 0, false, fmt.Errorf("%w: Responses compaction has no enforceable output token limit", errResellerRequestHardCapUnsupported)
	case relaytypes.RelayFormatOpenAIRealtime:
		return 0, false, fmt.Errorf("%w: Realtime sessions have no enforceable aggregate output token limit", errResellerRequestHardCapUnsupported)
	default:
		return 0, false, fmt.Errorf("%w: relay format %q is not supported", errResellerRequestHardCapUnsupported, relayInfo.RelayFormat)
	}
}

func resellerRequestMaximumTokenQuota(relayInfo *relaycommon.RelayInfo) (int, *common.QuotaClamp, error) {
	outputQuota, requiresOutput, err := resellerRequestOutputTokenQuota(relayInfo)
	if err != nil {
		return 0, nil, err
	}
	promptQuota := relayInfo.GetEstimatePromptTokens()
	if promptQuota < 0 {
		return 0, nil, fmt.Errorf("%w: estimated prompt token count is negative", errResellerRequestHardCapUnsupported)
	}
	if !requiresOutput && promptQuota == 0 {
		return 0, nil, fmt.Errorf("%w: input token count is empty or cannot be measured", errResellerRequestHardCapUnsupported)
	}
	quota, clamp := resellerTokenQuota(promptQuota, outputQuota)
	return quota, clamp, nil
}

// resellerEmbeddingInputIsCountable rejects token-id arrays and other shapes
// for which the gateway cannot calculate a trustworthy input reservation.
// Passing those values through would reserve only the string subset (or zero)
// while the upstream still consumes the complete input.
func resellerEmbeddingInputIsCountable(input any) bool {
	switch value := input.(type) {
	case string:
		return strings.TrimSpace(value) != ""
	case []string:
		if len(value) == 0 {
			return false
		}
		for _, item := range value {
			if strings.TrimSpace(item) == "" {
				return false
			}
		}
		return true
	case []any:
		if len(value) == 0 {
			return false
		}
		for _, item := range value {
			text, ok := item.(string)
			if !ok || strings.TrimSpace(text) == "" {
				return false
			}
		}
		return true
	default:
		return false
	}
}

// resellerOutboundRequest parses the exact body that is about to be sent.
// It is intentionally limited to DTOs with a reliable token-count metadata
// implementation; unknown provider-specific payloads fail closed for finite
// reseller allocations.
func resellerOutboundRequest(format relaytypes.RelayFormat, jsonData []byte, requiresOutput bool) (dto.Request, error) {
	switch format {
	case relaytypes.RelayFormatOpenAI:
		if requiresOutput {
			var request dto.GeneralOpenAIRequest
			if err := common.Unmarshal(jsonData, &request); err != nil {
				return nil, err
			}
			return &request, nil
		}
		var request dto.EmbeddingRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		if !resellerEmbeddingInputIsCountable(request.Input) {
			return nil, fmt.Errorf("%w: embedding input shape is not safely countable", errResellerRequestHardCapUnsupported)
		}
		return &request, nil
	case relaytypes.RelayFormatOpenAIResponses:
		var request dto.OpenAIResponsesRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		return &request, nil
	case relaytypes.RelayFormatClaude:
		var request dto.ClaudeRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		return &request, nil
	case relaytypes.RelayFormatGemini:
		if requiresOutput {
			var request dto.GeminiChatRequest
			if err := common.Unmarshal(jsonData, &request); err != nil {
				return nil, err
			}
			return &request, nil
		}
		var batch dto.GeminiBatchEmbeddingRequest
		if err := common.Unmarshal(jsonData, &batch); err != nil {
			return nil, err
		}
		if len(batch.Requests) > 0 {
			for _, request := range batch.Requests {
				if request == nil || !resellerEmbeddingInputIsCountable(request.GetTokenCountMeta().CombineText) {
					return nil, fmt.Errorf("%w: Gemini embedding batch contains an empty input", errResellerRequestHardCapUnsupported)
				}
			}
			return &batch, nil
		}
		var request dto.GeminiEmbeddingRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		return &request, nil
	case relaytypes.RelayFormatEmbedding:
		var request dto.EmbeddingRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		if !resellerEmbeddingInputIsCountable(request.Input) {
			return nil, fmt.Errorf("%w: embedding input shape is not safely countable", errResellerRequestHardCapUnsupported)
		}
		return &request, nil
	case relaytypes.RelayFormatRerank:
		var request dto.RerankRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return nil, err
		}
		return &request, nil
	default:
		return nil, fmt.Errorf("%w: final relay format %q is not supported", errResellerRequestHardCapUnsupported, format)
	}
}

var resellerInputFieldNames = map[string]struct{}{
	"content":      {},
	"contents":     {},
	"data":         {},
	"documents":    {},
	"input":        {},
	"instructions": {},
	"messages":     {},
	"parts":        {},
	"prompt":       {},
	"query":        {},
	"requests":     {},
	"system":       {},
	"text":         {},
	"texts":        {},
}

var resellerIgnoredInputFieldNames = map[string]struct{}{
	"id":              {},
	"model":           {},
	"name":            {},
	"role":            {},
	"type":            {},
	"encoding_format": {},
}

// resellerGenericInputMeta covers provider-specific input envelopes (for
// example Ali's {input:{texts:...}} and nested rerank payloads) that cannot be
// represented by the public DTOs. It deliberately fails on numeric values in
// an input-bearing field, because silently dropping token-id arrays would
// under-reserve the reseller allocation.
func resellerGenericInputMeta(jsonData []byte) (*relaytypes.TokenCountMeta, error) {
	var root any
	if err := common.Unmarshal(jsonData, &root); err != nil {
		return nil, err
	}
	texts := make([]string, 0)
	unsupported := false
	var walk func(value any, inputScope bool, fieldName string)
	walk = func(value any, inputScope bool, fieldName string) {
		if unsupported {
			return
		}
		if fieldName != "" {
			name := strings.ToLower(fieldName)
			if _, ignored := resellerIgnoredInputFieldNames[name]; ignored {
				inputScope = false
			} else if _, inputField := resellerInputFieldNames[name]; inputField {
				inputScope = true
			}
		}
		switch item := value.(type) {
		case string:
			if inputScope && strings.TrimSpace(item) != "" {
				texts = append(texts, item)
			}
		case []any:
			for _, child := range item {
				walk(child, inputScope, "")
			}
		case map[string]any:
			for key, child := range item {
				walk(child, inputScope, key)
			}
		case nil:
			if inputScope {
				unsupported = true
			}
		default:
			if inputScope {
				unsupported = true
			}
		}
	}
	walk(root, false, "")
	if unsupported {
		return nil, fmt.Errorf("%w: provider input contains an uncountable value", errResellerRequestHardCapUnsupported)
	}
	if len(texts) == 0 {
		return nil, fmt.Errorf("%w: provider input has no countable text", errResellerRequestHardCapUnsupported)
	}
	return &relaytypes.TokenCountMeta{CombineText: strings.Join(texts, "\n")}, nil
}

func resellerOutboundPromptTokenQuota(c *gin.Context, relayInfo *relaycommon.RelayInfo, format relaytypes.RelayFormat, jsonData []byte, requiresOutput bool) (int, error) {
	if format == relaytypes.RelayFormatOpenAIResponses && isResellerBilling(relayInfo) && !relayInfo.TokenUnlimited {
		// A heuristic text estimate is not a hard reservation, even when every
		// tool result was extracted. Validate hidden-context features and use
		// the final UTF-8 payload as a conservative input bound instead.
		return resellerResponsesInputTokenQuota(jsonData, relayInfo.GetEstimatePromptTokens(), relayInfo.GetUpstreamModelName())
	}
	request, err := resellerOutboundRequest(format, jsonData, requiresOutput)
	var meta *relaytypes.TokenCountMeta
	if err == nil {
		meta = request.GetTokenCountMeta()
	}
	if !requiresOutput && (err != nil || meta == nil || (strings.TrimSpace(meta.CombineText) == "" && len(meta.Files) == 0)) {
		// Provider-specific input envelopes are common for embeddings/reranking.
		// Reconstruct only their input text; output-bearing requests still fail
		// closed when their final DTO is unknown.
		meta, err = resellerGenericInputMeta(jsonData)
	}
	if err != nil {
		return 0, err
	}
	if meta == nil {
		return 0, fmt.Errorf("%w: final request has no token metadata", errResellerRequestHardCapUnsupported)
	}
	if !requiresOutput && strings.TrimSpace(meta.CombineText) == "" && len(meta.Files) == 0 {
		return 0, fmt.Errorf("%w: final request has no countable input", errResellerRequestHardCapUnsupported)
	}
	if c == nil {
		return relayInfo.GetEstimatePromptTokens(), nil
	}
	countInfo := *relayInfo
	countInfo.RelayFormat = format
	if format == relaytypes.RelayFormatOpenAIResponses {
		countInfo.RelayMode = relayconstant.RelayModeResponses
	}
	if format == relaytypes.RelayFormatRerank {
		countInfo.RelayMode = relayconstant.RelayModeRerank
	}
	if format == relaytypes.RelayFormatEmbedding {
		countInfo.RelayMode = relayconstant.RelayModeEmbeddings
	}
	tokens, err := EstimateRequestToken(c, meta, &countInfo)
	if err != nil {
		return 0, err
	}
	return tokens, nil
}

// resellerResponsesInputIsBounded only walks actual input items/content. Tool
// arguments and results remain literal text; property names in a function's
// JSON schema must not be mistaken for provider-side history references.
func resellerResponsesInputIsBounded(value any, allowHidden bool) bool {
	switch input := value.(type) {
	case nil, string:
		return true
	case []any:
		for _, item := range input {
			if !resellerResponsesInputIsBounded(item, allowHidden) {
				return false
			}
		}
		return true
	case map[string]any:
		if encrypted, exists := input["encrypted_content"]; exists && encrypted != nil && encrypted != "" {
			if !allowHidden {
				return false
			}
		}
		inputType, _ := input["type"].(string)
		switch inputType {
		case "", "message":
			content, exists := input["content"]
			return exists && content != nil && resellerResponsesInputIsBounded(content, allowHidden)
		case "input_text", "output_text", "summary_text", "reasoning_text":
			_, ok := input["text"].(string)
			return ok
		case "refusal":
			_, ok := input["refusal"].(string)
			return ok
		case "function_call", "custom_tool_call":
			field := "arguments"
			if inputType == "custom_tool_call" {
				field = "input"
			}
			_, nameOK := input["name"].(string)
			_, textOK := input[field].(string)
			return nameOK && textOK
		case "function_call_output", "custom_tool_call_output", "computer_call_output":
			output, exists := input["output"]
			return exists && output != nil && resellerResponsesInputIsBounded(output, allowHidden)
		case "input_image", "computer_screenshot":
			// Images can expand to more tokens than their URL or encoded bytes.
			// Use the model context reservation, as for opaque saved history.
			imageURL, _ := input["image_url"].(string)
			fileID, _ := input["file_id"].(string)
			return allowHidden && (imageURL != "" || fileID != "")
		case "input_file":
			fileID, _ := input["file_id"].(string)
			fileURL, _ := input["file_url"].(string)
			fileData, _ := input["file_data"].(string)
			return allowHidden && (fileID != "" || fileURL != "" || fileData != "")
		case "tool_search_call":
			_, hasArguments := input["arguments"]
			return input["execution"] == "client" && hasArguments
		case "tool_search_output", "additional_tools":
			// These history items can introduce executable definitions just like
			// the top-level tools array. Inspect definitions, not schema fields.
			tools, exists := input["tools"]
			return exists && tools != nil && resellerResponsesToolsAreClientExecuted(tools)
		case "reasoning":
			if input["id"] != nil && input["id"] != "" && !allowHidden {
				return false
			}
			return resellerResponsesInputIsBounded(input["summary"], allowHidden) && resellerResponsesInputIsBounded(input["content"], allowHidden)
		case "compaction", "item_reference":
			return allowHidden
		}
	}
	return false
}

func resellerResponsesToolsAreClientExecuted(value any) bool {
	if value == nil {
		return true
	}
	declarations, ok := value.([]any)
	if !ok {
		return false
	}
	for _, declaration := range declarations {
		tool, ok := declaration.(map[string]any)
		if !ok {
			return false
		}
		switch tool["type"] {
		case "function", "custom":
		case "namespace":
			nested, exists := tool["tools"]
			if !exists || nested == nil || !resellerResponsesToolsAreClientExecuted(nested) {
				return false
			}
		case "tool_search":
			if tool["execution"] != "client" {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func resellerResponsesInputTokenQuota(jsonData []byte, estimatedTokens int, upstreamModel string) (int, error) {
	var request map[string]any
	if err := common.Unmarshal(jsonData, &request); err != nil {
		return 0, err
	}
	if request == nil {
		return 0, fmt.Errorf("%w: Responses request must be an object", errResellerRequestHardCapUnsupported)
	}
	hasHiddenInput := false
	for _, field := range []string{"previous_response_id", "conversation"} {
		if value, exists := request[field]; exists && value != nil && value != "" {
			hasHiddenInput = true
		}
	}
	if prompt, ok := request["prompt"].(map[string]any); ok && prompt["id"] != nil && prompt["id"] != "" {
		hasHiddenInput = true
	}
	if !resellerResponsesInputIsBounded(request["input"], false) {
		if !resellerResponsesInputIsBounded(request["input"], true) {
			return 0, fmt.Errorf("%w: malformed or unsupported Responses input item; supported images and files require a verified model context limit", errResellerRequestHardCapUnsupported)
		}
		hasHiddenInput = true
	}
	if !resellerResponsesToolsAreClientExecuted(request["tools"]) {
		return 0, fmt.Errorf("%w: hosted tools can add unbounded input; only client-executed tools and tool search are supported", errResellerRequestHardCapUnsupported)
	}
	if hasHiddenInput {
		if name, ok := request["model"].(string); ok && strings.TrimSpace(name) != "" {
			upstreamModel = strings.TrimSpace(name)
		}
		limit, known := relayconstant.CodexModelContextTokenLimit(upstreamModel)
		if !known {
			return 0, fmt.Errorf("%w: hidden Responses history, images and files require a verified model context limit", errResellerRequestHardCapUnsupported)
		}
		return limit, nil
	}

	// Byte-level tokenizers cannot produce more text tokens than UTF-8 input
	// bytes. Reserve the entire serialized body, not only selected DTO fields,
	// plus framing for each structural item and the request envelope. Counting
	// delimiters inside literal tool output only makes this more conservative.
	structures := bytes.Count(jsonData, []byte{'{'}) + bytes.Count(jsonData, []byte{'['})
	if len(jsonData) > common.MaxQuota || structures > (common.MaxQuota-256)/32 {
		return 0, fmt.Errorf("%w: Responses input exceeds the reservation limit", errResellerRequestHardCapUnsupported)
	}
	quota, clamp := resellerTokenQuota(len(jsonData), 256+32*structures)
	if clamp != nil {
		return 0, clamp
	}
	if estimatedTokens > quota {
		quota = estimatedTokens
	}
	return quota, nil
}

func resellerOutboundOutputTokenQuota(relayInfo *relaycommon.RelayInfo, format relaytypes.RelayFormat, jsonData []byte) (int, error) {
	switch format {
	case relaytypes.RelayFormatOpenAI:
		var request dto.GeneralOpenAIRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return 0, err
		}
		return resellerOpenAIOutputTokenQuota(&request)
	case relaytypes.RelayFormatOpenAIResponses:
		var request dto.OpenAIResponsesRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return 0, err
		}
		if relayInfo.GetChannelType() != constant.ChannelTypeCodex && request.MaxOutputTokens != nil {
			return resellerOutputTokenQuota(*request.MaxOutputTokens, nil)
		}
		modelName := strings.TrimSpace(request.Model)
		if modelName == "" {
			modelName = strings.TrimSpace(relayInfo.GetUpstreamModelName())
		}
		if modelName == "" {
			return 0, errResellerOutputTokenLimitRequired
		}
		limit, ok := relayconstant.CodexModelOutputTokenLimit(modelName)
		if !ok {
			return 0, fmt.Errorf("%w: upstream model %q has no trusted output token limit", errResellerRequestHardCapUnsupported, modelName)
		}
		return limit, nil
	case relaytypes.RelayFormatClaude:
		var request dto.ClaudeRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return 0, err
		}
		maxTokens := uint(0)
		if request.MaxTokens != nil {
			maxTokens = *request.MaxTokens
		}
		return resellerOutputTokenQuota(maxTokens, nil)
	case relaytypes.RelayFormatGemini:
		var request dto.GeminiChatRequest
		if err := common.Unmarshal(jsonData, &request); err != nil {
			return 0, err
		}
		return resellerGeminiOutputTokenQuota(&request)
	default:
		return 0, fmt.Errorf("%w: final relay format %q is not supported", errResellerRequestHardCapUnsupported, format)
	}
}

// ValidateResellerOutboundHardCap verifies the final converted request after
// channel overrides. This compatibility wrapper is used by service tests and
// callers that do not have a request context; relay handlers should use the
// context-aware variant below so input changes are recounted exactly.
func ValidateResellerOutboundHardCap(relayInfo *relaycommon.RelayInfo, jsonData []byte) error {
	return ValidateResellerOutboundHardCapForFormat(nil, relayInfo, relayInfo.GetFinalRequestRelayFormat(), jsonData)
}

// ValidateResellerOutboundHardCapWithContext verifies the exact outbound body
// and recounts its input metadata after conversion and parameter overrides.
func ValidateResellerOutboundHardCapWithContext(c *gin.Context, relayInfo *relaycommon.RelayInfo, jsonData []byte) error {
	return ValidateResellerOutboundHardCapForFormat(c, relayInfo, relayInfo.GetFinalRequestRelayFormat(), jsonData)
}

// ValidateResellerOutboundHardCapForFormat is the same check with an explicit
// final format. Pass-through handlers use the original request format because
// a previous retry may have left conversion history on RelayInfo.
func ValidateResellerOutboundHardCapForFormat(c *gin.Context, relayInfo *relaycommon.RelayInfo, finalFormat relaytypes.RelayFormat, jsonData []byte) error {
	if !isResellerBilling(relayInfo) || relayInfo.TokenUnlimited {
		return nil
	}
	_, requiresOutput, err := resellerRequestOutputTokenQuota(relayInfo)
	if err != nil {
		return err
	}
	outputQuota := 0
	if requiresOutput {
		outputQuota, err = resellerOutboundOutputTokenQuota(relayInfo, finalFormat, jsonData)
	}
	if err != nil {
		return err
	}
	promptQuota, err := resellerOutboundPromptTokenQuota(c, relayInfo, finalFormat, jsonData, requiresOutput)
	if err != nil {
		return err
	}
	if promptQuota < 0 {
		return fmt.Errorf("%w: estimated prompt token count is negative", errResellerRequestHardCapUnsupported)
	}
	if !requiresOutput && promptQuota == 0 {
		return fmt.Errorf("%w: final input token count is empty or cannot be measured", errResellerRequestHardCapUnsupported)
	}
	maximumQuota, clamp := resellerTokenQuota(promptQuota, outputQuota)
	noteQuotaClamp(relayInfo, clamp)
	if clamp != nil {
		return clamp
	}
	if maximumQuota > relayInfo.TokenQuotaPreConsumed {
		if relayInfo.Billing == nil {
			return fmt.Errorf("%w: request can use up to %d tokens but only %d were reserved", model.ErrResellerTokenQuotaInsufficient, maximumQuota, relayInfo.TokenQuotaPreConsumed)
		}
		if err := relayInfo.Billing.Reserve(maximumQuota); err != nil {
			return fmt.Errorf("%w: failed to extend reseller reservation from %d to %d tokens", err, relayInfo.TokenQuotaPreConsumed, maximumQuota)
		}
	}
	return nil
}

func hasReportedTextTokenUsage(usage *dto.Usage) bool {
	if usage == nil {
		return false
	}
	return usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0 ||
		usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.PromptCacheHitTokens > 0 ||
		usage.PromptTokensDetails.CachedTokens > 0 || usage.PromptTokensDetails.CacheCreationTokensTotal() > 0 ||
		(usage.InputTokensDetails != nil && (usage.InputTokensDetails.CachedTokens > 0 ||
			usage.InputTokensDetails.CacheCreationTokensTotal() > 0))
}

// authoritativeTextTokenQuota accepts only usage measured by the upstream.
// Local token counts and BillingUsage values explicitly marked as estimated
// are useful for monetary billing, but cannot release a finite raw-token
// reservation. A structured/source-tagged upstream usage remains authoritative
// even when every counter is zero, so a genuine zero can refund the hold.
func authoritativeTextTokenQuota(usage *dto.Usage, locallyCounted bool, fallbackPromptTokens int) (int, *common.QuotaClamp, bool) {
	if usage == nil || locallyCounted {
		return 0, nil, false
	}
	if usage.BillingUsage != nil && usage.BillingUsage.Estimated {
		return 0, nil, false
	}

	effectiveUsage := usage
	if normalizedUsage, ok := usageFromBillingUsage(usage); ok {
		effectiveUsage = normalizedUsage
	} else if !hasReportedTextTokenUsage(usage) && strings.TrimSpace(usage.UsageSource) == "" {
		return 0, nil, false
	}
	// Provider usage is still untrusted input. Invalid counters must not turn
	// a consumed request into a zero charge or release its reservation.
	for _, count := range []int{effectiveUsage.PromptTokens, effectiveUsage.CompletionTokens,
		effectiveUsage.TotalTokens, effectiveUsage.InputTokens, effectiveUsage.OutputTokens,
		effectiveUsage.PromptCacheHitTokens, effectiveUsage.PromptTokensDetails.CachedTokens,
		effectiveUsage.PromptTokensDetails.CacheCreationTokensTotal()} {
		if count < 0 || count > common.MaxQuota {
			return 0, nil, false
		}
	}
	cache := max(effectiveUsage.PromptCacheHitTokens, effectiveUsage.PromptTokensDetails.CachedTokens)
	if details := effectiveUsage.InputTokensDetails; details != nil {
		if details.CachedTokens < 0 || details.CachedTokens > common.MaxQuota || details.CacheCreationTokensTotal() < 0 {
			return 0, nil, false
		}
		cache = max(cache, details.CachedTokens)
	}
	if effectiveUsage.UsageSemantic != dto.BillingUsageSemanticAnthropic {
		input := max(effectiveUsage.PromptTokens, effectiveUsage.InputTokens)
		if cache > input {
			return 0, nil, false
		}
	}

	if !hasReportedTextTokenUsage(effectiveUsage) {
		// A source-tagged all-zero object is an explicit upstream report, not a
		// missing-usage fallback. Do not replace it with the prompt estimate.
		fallbackPromptTokens = 0
	}
	quota, clamp := resellerTextTokenQuota(effectiveUsage, fallbackPromptTokens)
	return quota, clamp, true
}

func hasReportedRealtimeTokenUsage(usage *dto.RealtimeUsage) bool {
	if usage == nil {
		return false
	}
	return usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 ||
		usage.InputTokenDetails.CachedTokens > 0
}

// resellerTextTokenQuota charges input + output - cache-read tokens. Effective
// Anthropic usage exposes aggregate input separately from uncached prompt input.
func resellerTextTokenQuota(usage *dto.Usage, fallbackPromptTokens int) (int, *common.QuotaClamp) {
	if usage == nil {
		return resellerTokenQuota(fallbackPromptTokens)
	}

	outputTokens := usage.CompletionTokens
	if outputTokens == 0 && usage.OutputTokens > 0 {
		outputTokens = usage.OutputTokens
	}

	cacheReadTokens := usage.PromptTokensDetails.CachedTokens
	if usage.InputTokensDetails != nil && usage.InputTokensDetails.CachedTokens > cacheReadTokens {
		cacheReadTokens = usage.InputTokensDetails.CachedTokens
	}
	if usage.PromptCacheHitTokens > cacheReadTokens {
		cacheReadTokens = usage.PromptCacheHitTokens
	}

	if usage.UsageSemantic == dto.BillingUsageSemanticAnthropic && usage.InputTokens > 0 {
		inputTokens := usage.InputTokens - cacheReadTokens
		if inputTokens < 0 {
			inputTokens = 0
		}
		return resellerTokenQuota(inputTokens, outputTokens)
	}

	inputTokens := usage.PromptTokens
	if usage.UsageSemantic == dto.BillingUsageSemanticAnthropic {
		// In this legacy/fallback shape PromptTokens is already the uncached
		// portion. Cache reads stay free while cache creation remains billable.
		cacheWriteTokens := usage.PromptTokensDetails.CacheCreationTokensTotal()
		if usage.InputTokensDetails != nil {
			inputCacheWriteTokens := usage.InputTokensDetails.CacheCreationTokensTotal()
			if inputCacheWriteTokens > cacheWriteTokens {
				cacheWriteTokens = inputCacheWriteTokens
			}
		}
		return resellerTokenQuota(inputTokens, outputTokens, cacheWriteTokens)
	}

	if inputTokens == 0 && usage.InputTokens > 0 {
		inputTokens = usage.InputTokens
	}
	// Some embedding/rerank adapters only expose total_tokens.  Recover the
	// input portion from that total instead of silently charging zero.  If the
	// upstream omitted all usage fields, retain the local prompt estimate.
	if inputTokens == 0 && usage.TotalTokens > outputTokens {
		inputTokens = usage.TotalTokens - outputTokens
	}
	if inputTokens == 0 && fallbackPromptTokens > 0 && usage.TotalTokens == 0 {
		inputTokens = fallbackPromptTokens
	}
	if cacheReadTokens >= inputTokens {
		inputTokens = 0
	} else if cacheReadTokens > 0 {
		inputTokens -= cacheReadTokens
	}
	return resellerTokenQuota(inputTokens, outputTokens)
}

// OpenAI Realtime input_tokens includes cached_tokens, which are free for
// reseller allocations.
func resellerRealtimeTokenQuota(usage *dto.RealtimeUsage) (int, *common.QuotaClamp) {
	if usage == nil {
		return 0, nil
	}
	inputTokens := usage.InputTokens
	if inputTokens <= 0 && usage.TotalTokens > usage.OutputTokens {
		inputTokens = usage.TotalTokens - usage.OutputTokens
	}
	cacheReadTokens := usage.InputTokenDetails.CachedTokens
	if cacheReadTokens >= inputTokens {
		inputTokens = 0
	} else if cacheReadTokens > 0 {
		inputTokens -= cacheReadTokens
	}
	return resellerTokenQuota(inputTokens, usage.OutputTokens)
}
