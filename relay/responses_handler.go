package relay

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

func ResponsesHelper(c *gin.Context, info *relaycommon.RelayInfo) (newAPIError *types.NewAPIError) {
	var responsesReq *dto.OpenAIResponsesRequest
	switch req := info.Request.(type) {
	case *dto.OpenAIResponsesRequest:
		responsesReq = req
	case *dto.OpenAIResponsesCompactionRequest:
		// Only fields documented for POST /v1/responses/compact are forwarded:
		// model, input, instructions, previous_response_id, prompt_cache_key,
		// prompt_cache_options, prompt_cache_retention, service_tier.
		// Undocumented Codex-parity fields (tools, reasoning, text) are parsed
		// for client compatibility but intentionally not sent upstream.
		responsesReq = &dto.OpenAIResponsesRequest{
			Model:                req.Model,
			Input:                req.Input,
			Instructions:         req.Instructions,
			PreviousResponseID:   req.PreviousResponseID,
			ParallelToolCalls:    req.ParallelToolCalls,
			ServiceTier:          req.ServiceTier,
			PromptCacheKey:       req.PromptCacheKey,
			PromptCacheOptions:   req.PromptCacheOptions,
			PromptCacheRetention: req.PromptCacheRetention,
		}
	default:
		return types.NewErrorWithStatusCode(
			fmt.Errorf("invalid request type, expected dto.OpenAIResponsesRequest or dto.OpenAIResponsesCompactionRequest, got %T", info.Request),
			types.ErrorCodeInvalidRequest,
			http.StatusBadRequest,
			types.ErrOptionWithSkipRetry(),
		)
	}

	adaptor, requestBody, closer, apiErr := PrepareResponsesRequest(c, info, responsesReq)
	if apiErr != nil {
		return apiErr
	}
	defer closer.Close()

	var httpResp *http.Response
	resp, err := adaptor.DoRequest(c, info, requestBody)
	if err != nil {
		return types.NewOpenAIError(err, types.ErrorCodeDoRequestFailed, http.StatusInternalServerError)
	}

	statusCodeMappingStr := c.GetString("status_code_mapping")

	if resp != nil {
		httpResp = resp.(*http.Response)

		if httpResp.StatusCode != http.StatusOK {
			newAPIError = service.RelayErrorHandler(c.Request.Context(), httpResp, false)
			// reset status code 重置状态码
			service.ResetStatusCode(newAPIError, statusCodeMappingStr)
			return newAPIError
		}
	}

	usage, newAPIError := adaptor.DoResponse(c, httpResp, info)
	if newAPIError != nil {
		// reset status code 重置状态码
		service.ResetStatusCode(newAPIError, statusCodeMappingStr)
		return newAPIError
	}

	usageDto := usage.(*dto.Usage)
	if info.RelayMode == relayconstant.RelayModeResponsesCompact {
		originModelName := info.OriginModelName
		originPriceData := info.PriceData

		_, err := helper.ModelPriceHelper(c, info, info.GetEstimatePromptTokens(), &types.TokenCountMeta{})
		if err != nil {
			info.OriginModelName = originModelName
			info.PriceData = originPriceData
			return types.NewError(err, types.ErrorCodeModelPriceError, types.ErrOptionWithSkipRetry(), types.ErrOptionWithStatusCode(http.StatusBadRequest))
		}
		service.PostTextConsumeQuota(c, info, usageDto, nil)

		info.OriginModelName = originModelName
		info.PriceData = originPriceData
		return nil
	}

	ConsumeResponsesQuota(c, info, usageDto)
	return nil
}

// ConsumeResponsesQuota applies the same settlement dispatch to HTTP and
// WebSocket Responses usage. Compact requests keep their separate repricing.
func ConsumeResponsesQuota(c *gin.Context, info *relaycommon.RelayInfo, usage *dto.Usage) {
	if strings.HasPrefix(info.OriginModelName, "gpt-4o-audio") {
		service.PostAudioConsumeQuota(c, info, usage, nil)
		return
	}
	service.PostTextConsumeQuota(c, info, usage, nil)
}

func normalizeLegacyResponsesConfigurationUpdates(jsonData []byte, fallbackModel string) ([]byte, error) {
	var request map[string]json.RawMessage
	if err := common.Unmarshal(jsonData, &request); err != nil {
		return nil, err
	}
	modelName := strings.TrimSpace(fallbackModel)
	if rawModel, exists := request["model"]; exists {
		var requestedModel string
		if err := common.Unmarshal(rawModel, &requestedModel); err == nil && strings.TrimSpace(requestedModel) != "" {
			modelName = strings.TrimSpace(requestedModel)
		}
	}
	if strings.HasPrefix(strings.ToLower(modelName), "gpt-6") {
		return jsonData, nil
	}

	rawInput, exists := request["input"]
	inputJSON := strings.TrimSpace(string(rawInput))
	if !exists || inputJSON == "" || inputJSON[0] != '[' {
		return jsonData, nil
	}
	var input []json.RawMessage
	if err := common.Unmarshal(rawInput, &input); err != nil {
		return nil, err
	}
	filtered := make([]json.RawMessage, 0, len(input))
	configuredEffort := ""
	for _, item := range input {
		var fields map[string]json.RawMessage
		if err := common.Unmarshal(item, &fields); err != nil || fields == nil {
			filtered = append(filtered, item)
			continue
		}
		var itemType string
		if err := common.Unmarshal(fields["type"], &itemType); err != nil || itemType != "configuration_update" {
			filtered = append(filtered, item)
			continue
		}
		if rawReasoning, exists := fields["reasoning"]; exists {
			var reasoning map[string]json.RawMessage
			if err := common.Unmarshal(rawReasoning, &reasoning); err != nil {
				return nil, err
			}
			if rawEffort, exists := reasoning["effort"]; exists {
				var effort string
				if err := common.Unmarshal(rawEffort, &effort); err != nil {
					return nil, err
				}
				if strings.TrimSpace(effort) != "" {
					configuredEffort = strings.TrimSpace(effort)
				}
			}
		}
	}
	if len(filtered) == len(input) {
		return jsonData, nil
	}
	encodedInput, err := common.Marshal(filtered)
	if err != nil {
		return nil, err
	}
	request["input"] = encodedInput
	if configuredEffort != "" {
		var reasoning map[string]json.RawMessage
		if rawReasoning, exists := request["reasoning"]; exists {
			if err := common.Unmarshal(rawReasoning, &reasoning); err != nil {
				return nil, err
			}
		}
		if reasoning == nil {
			reasoning = make(map[string]json.RawMessage)
		}
		var existingEffort string
		if rawEffort, exists := reasoning["effort"]; exists {
			_ = common.Unmarshal(rawEffort, &existingEffort)
		}
		if strings.TrimSpace(existingEffort) == "" {
			reasoning["effort"], err = common.Marshal(configuredEffort)
			if err != nil {
				return nil, err
			}
			request["reasoning"], err = common.Marshal(reasoning)
			if err != nil {
				return nil, err
			}
		}
	}
	return common.Marshal(request)
}
