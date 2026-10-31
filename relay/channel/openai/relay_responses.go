package openai

import (
	"fmt"
	"io"
	"net/http"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/logger"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"
)

// responsesUsageForBilling keeps provider counters separate from local estimates.
// Presence matters: an explicit zero is billable usage, whereas an empty usage
// object cannot prove that a request consumed no tokens.
func responsesUsageForBilling(upstream *dto.Usage, responseBody []byte) *dto.Usage {
	if upstream == nil {
		return nil
	}
	type reportedCounters struct {
		InputTokens  *int `json:"input_tokens"`
		OutputTokens *int `json:"output_tokens"`
	}
	var envelope struct {
		Usage    *reportedCounters `json:"usage"`
		Response *struct {
			Usage *reportedCounters `json:"usage"`
		} `json:"response"`
	}
	decodeErr := common.Unmarshal(responseBody, &envelope)
	reported := envelope.Usage
	if envelope.Response != nil {
		reported = envelope.Response.Usage
	}
	estimated := decodeErr != nil || reported == nil || reported.InputTokens == nil || reported.OutputTokens == nil

	usage := *upstream
	usage.BillingUsage = nil
	usage.PromptTokens = upstream.InputTokens
	usage.CompletionTokens = upstream.OutputTokens
	if upstream.InputTokensDetails != nil {
		details := *upstream.InputTokensDetails
		usage.InputTokensDetails = &details
		usage.PromptTokensDetails = details
	}
	usage.UsageSource = dto.BillingUsageSourceOAIResponses
	usage.UsageSemantic = dto.BillingUsageSemanticOpenAI
	billingUsage := usage
	usage.BillingUsage = &dto.BillingUsage{
		Source:      dto.BillingUsageSourceOAIResponses,
		Semantic:    dto.BillingUsageSemanticOpenAI,
		Estimated:   estimated,
		OpenAIUsage: &billingUsage,
	}
	return &usage
}

func OaiResponsesHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	defer service.CloseResponseBodyGracefully(resp)

	// read response body
	var responsesResponse dto.OpenAIResponsesResponse
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}
	err = common.Unmarshal(responseBody, &responsesResponse)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	// A terminal Response object can contain both an error and billable usage.
	// Forward that outcome and settle it; treating it as a transport rejection
	// would retry the request and refund work the upstream already performed.
	isTerminalResponse := responsesResponse.Object == "response" && relaycommon.IsNonBillableResponsesStatus(responsesResponse.Status)
	if oaiError := responsesResponse.GetOpenAIError(); oaiError != nil && oaiError.Type != "" && !isTerminalResponse {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	info.ObserveResponseModel(responsesResponse.Model)
	responseBody = rewriteSGLangResponsesCreatedAt(info, responseBody, "created_at", responsesResponse.CreatedAt)

	// 写入新的 response body
	service.IOCopyBytesGracefully(c, resp, responseBody)

	// compute usage
	usage := responsesUsageForBilling(responsesResponse.Usage, responseBody)
	if usage == nil {
		usage = &dto.Usage{BillingUsage: &dto.BillingUsage{
			Source:    dto.BillingUsageSourceOAIResponses,
			Semantic:  dto.BillingUsageSemanticOpenAI,
			Estimated: true,
		}}
	}
	// Count actual tool invocations from Output (not tool declarations).
	for _, output := range responsesResponse.Output {
		switch output.Type {
		case dto.BuildInCallWebSearchCall:
			info.CountBillableToolCall(dto.BuildInCallWebSearchCall, "")
		case dto.BuildInCallFileSearchCall:
			info.CountBillableToolCall(dto.BuildInCallFileSearchCall, "")
		case dto.BuildInCallFunctionCall:
			info.CountBillableToolCall(dto.BuildInCallFunctionCall, output.Name)
		}
	}
	info.ApplyVendorToolUsage(responseBody)

	imageCounter := &relaycommon.ImageGenerationCallCounter{}
	for i := range responsesResponse.Output {
		imageCounter.Observe(&responsesResponse.Output[i], &i)
	}
	imageCounter.Commit(info)

	return usage, nil
}

func OaiResponsesStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		logger.LogError(c, common.LogText("invalid response or response body"))
		return nil, types.NewError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse)
	}

	defer service.CloseResponseBodyGracefully(resp)

	accumulator := service.NewResponsesUsageAccumulator(info)
	var reportedUsage *dto.Usage
	hasReportedUsage := false

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {

		// 检查当前数据是否包含 completed 状态和 usage 信息
		var streamResponse dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResponse); err != nil {
			logger.LogError(c, common.LogText("failed to unmarshal stream response: %s", err.Error()))
			sr.Error(err)
			return
		}
		if streamResponse.Response != nil {
			data = string(rewriteSGLangResponsesCreatedAt(info, []byte(data), "response.created_at", streamResponse.Response.CreatedAt))
		}
		switch streamResponse.Type {
		case "response.completed", "response.done", "response.failed", "response.error", "response.incomplete", "response.cancelled", "response.canceled":
			if streamResponse.Response != nil && streamResponse.Response.Usage != nil {
				reportedUsage = responsesUsageForBilling(streamResponse.Response.Usage, []byte(data))
				hasReportedUsage = true
			}
		}
		accumulator.Observe(&streamResponse, common.StringToByteSlice(data))
		if err := helper.ResponseChunkData(c, streamResponse, data); err != nil {
			sr.Stop(err)
			return
		}
		if (streamResponse.Type == "response.completed" || streamResponse.Type == "response.done") &&
			streamResponse.Response != nil && info.StreamStatus.ResponseOutcome() == string(relaycommon.ResponseOutcomeCompleted) {
			sr.Done()
		}
	})

	common.SetContextKey(c, constant.ContextKeyResponseStreamStatus, info.StreamStatus)
	info.StreamStatus.RequireTerminal()
	usage := accumulator.Finish()
	if hasReportedUsage {
		return reportedUsage, nil
	}
	common.SetContextKey(c, constant.ContextKeyLocalCountTokens, true)
	usage.BillingUsage = &dto.BillingUsage{
		Source:    dto.BillingUsageSourceOAIResponses,
		Semantic:  dto.BillingUsageSemanticOpenAI,
		Estimated: true,
	}
	return usage, nil
}

func rewriteSGLangResponsesCreatedAt(info *relaycommon.RelayInfo, payload []byte, path string, createdAt dto.IntValue) []byte {
	if info.GetChannelType() != constant.ChannelTypeSGLang {
		return payload
	}
	if !gjson.GetBytes(payload, path).Exists() {
		return payload
	}
	patched, err := sjson.SetBytes(payload, path, int(createdAt))
	if err != nil {
		return payload
	}
	return patched
}
