package openai

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/relayconvert"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/service"

	"github.com/gin-gonic/gin"
)

// resellerResponsesUsageForSettlement separates a completed upstream attempt
// from a transport rejection for legacy raw-token packages. Tariff packages
// use the ordinary panel usage fallback instead.
func resellerResponsesUsageForSettlement(info *relaycommon.RelayInfo, upstream *dto.Usage, body []byte) *dto.Usage {
	if info.ResellerTariffBilling || info.TokenUnlimited || (info.BillingSource != service.BillingSourceReseller && !model.IsResellerTokenKey(info.TokenKey)) {
		return nil
	}
	if usage := responsesUsageForBilling(upstream, body); usage != nil {
		return usage
	}
	return &dto.Usage{BillingUsage: &dto.BillingUsage{
		Source: dto.BillingUsageSourceOAIResponses, Semantic: dto.BillingUsageSemanticOpenAI, Estimated: true,
	}}
}

func finishResellerResponsesFailure(c *gin.Context, usage *dto.Usage, apiErr *types.NewAPIError, stream bool) (*dto.Usage, *types.NewAPIError) {
	if usage == nil {
		return nil, apiErr
	}
	if stream {
		_ = helper.ObjectData(c, map[string]any{"error": apiErr.ToOpenAIError()})
	} else {
		c.JSON(apiErr.StatusCode, gin.H{"error": apiErr.ToOpenAIError()})
	}
	return usage, nil
}

func OaiResponsesToChatHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	defer service.CloseResponseBodyGracefully(resp)

	var responsesResp dto.OpenAIResponsesResponse
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeReadResponseBodyFailed, http.StatusInternalServerError)
	}

	if err := common.Unmarshal(body, &responsesResp); err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	resellerUsage := resellerResponsesUsageForSettlement(info, responsesResp.Usage, body)
	isIncomplete := strings.EqualFold(strings.Trim(string(responsesResp.Status), "\" \t\r\n"), "incomplete")
	if resellerUsage != nil && responsesResp.Object == "response" && !isIncomplete && relaycommon.IsNonBillableResponsesStatus(responsesResp.Status) {
		service.IOCopyBytesGracefully(c, resp, body)
		return resellerUsage, nil
	}

	if oaiError := responsesResp.GetOpenAIError(); oaiError != nil && oaiError.Type != "" {
		return nil, types.WithOpenAIError(*oaiError, resp.StatusCode)
	}

	chatResult, err := relayconvert.ConvertResponse(c, info, types.RelayFormatOpenAI, &responsesResp)
	if err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError), false)
	}
	chatResp, ok := chatResult.Value.(*dto.OpenAITextResponse)
	if !ok {
		return nil, types.NewOpenAIError(fmt.Errorf("expected OpenAI chat response, got %T", chatResult.Value), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if chatID := helper.GetResponseID(c); chatID != "" {
		chatResp.Id = chatID
	}
	usage := chatResult.Usage
	if resellerUsage != nil {
		usage = resellerUsage
	}

	if resellerUsage == nil && (usage == nil || usage.TotalTokens == 0) {
		text := service.ExtractOutputTextFromResponses(&responsesResp)
		usage = service.ResponseText2Usage(c, text, info.UpstreamModelName, info.GetEstimatePromptTokens())
		chatResp.Usage = *usage
	}

	responseValue := any(chatResp)
	if info.RelayFormat != types.RelayFormatOpenAI {
		targetResult, err := relayconvert.ConvertResponse(c, info, info.RelayFormat, chatResp)
		if err != nil {
			return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError), false)
		}
		responseValue = targetResult.Value
	}
	responseBody, err := common.Marshal(responseValue)
	if err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError), false)
	}

	service.IOCopyBytesGracefully(c, resp, responseBody)
	return usage, nil
}

func OaiResponsesToChatBufferedStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	defer service.CloseResponseBodyGracefully(resp)

	accumulator := relayconvert.NewResponsesBufferedAccumulator()
	var finalResponse *dto.OpenAIResponsesResponse
	var streamErr *types.NewAPIError
	var resellerUsage *dto.Usage

	scanner := helper.NewStreamScanner(resp.Body)
	scanner.Split(bufio.ScanLines)
	for scanner.Scan() {
		line := scanner.Text()
		if len(line) < 6 || line[:5] != "data:" {
			continue
		}
		data := line[5:]
		data = strings.TrimSpace(data)
		if data == "" || data == "[DONE]" {
			if data == "[DONE]" {
				break
			}
			continue
		}

		var streamResp dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResp); err != nil {
			logger.LogError(c, "failed to unmarshal buffered responses stream event: "+err.Error())
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
			break
		}
		if resellerUsage == nil {
			resellerUsage = resellerResponsesUsageForSettlement(info, nil, nil)
		}
		switch streamResp.Type {
		case "response.completed", "response.done", "response.failed", "response.error", "response.incomplete", "response.cancelled", "response.canceled":
			var reported *dto.Usage
			if streamResp.Response != nil {
				reported = streamResp.Response.Usage
			}
			resellerUsage = resellerResponsesUsageForSettlement(info, reported, []byte(data))
			if resellerUsage != nil && streamResp.Type != "response.completed" && streamResp.Type != "response.done" && streamResp.Type != "response.incomplete" {
				c.Data(http.StatusOK, "application/json", []byte(data))
				return resellerUsage, nil
			}
		}
		accumulator.ProcessEvent(&streamResp)
		switch streamResp.Type {
		case "response.completed", "response.done", "response.incomplete":
			finalResponse = streamResp.Response
			if streamResp.Type == "response.incomplete" {
				if finalResponse == nil {
					finalResponse = &dto.OpenAIResponsesResponse{}
				}
				if len(finalResponse.Status) == 0 {
					finalResponse.Status = []byte(`"incomplete"`)
				}
			}
		case "response.failed", "response.error":
			if streamResp.Response != nil {
				if oaiErr := streamResp.Response.GetOpenAIError(); oaiErr != nil && oaiErr.Type != "" {
					streamErr = types.WithOpenAIError(*oaiErr, http.StatusInternalServerError)
					break
				}
			}
			streamErr = types.NewOpenAIError(fmt.Errorf("responses stream error: %s", streamResp.Type), types.ErrorCodeBadResponse, http.StatusInternalServerError)
		}
		if streamErr != nil || finalResponse != nil {
			break
		}
	}
	if streamErr != nil {
		return finishResellerResponsesFailure(c, resellerUsage, streamErr, false)
	}
	if err := scanner.Err(); err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError), false)
	}
	if finalResponse == nil {
		finalResponse = &dto.OpenAIResponsesResponse{
			ID:        helper.GetResponseID(c),
			CreatedAt: int(time.Now().Unix()),
			Model:     info.UpstreamModelName,
			Status:    []byte(`"completed"`),
		}
	}
	accumulator.SupplementResponseOutput(finalResponse)

	chatResult, err := relayconvert.ConvertResponse(c, info, types.RelayFormatOpenAI, finalResponse)
	if err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError), false)
	}
	chatResp, ok := chatResult.Value.(*dto.OpenAITextResponse)
	if !ok {
		return nil, types.NewOpenAIError(fmt.Errorf("expected OpenAI chat response, got %T", chatResult.Value), types.ErrorCodeBadResponseBody, http.StatusInternalServerError)
	}
	if chatID := helper.GetResponseID(c); chatID != "" {
		chatResp.Id = chatID
	}
	usage := chatResult.Usage
	if resellerUsage != nil {
		usage = resellerUsage
	}
	if resellerUsage == nil && (usage == nil || usage.TotalTokens == 0) {
		text := service.ExtractOutputTextFromResponses(finalResponse)
		usage = service.ResponseText2Usage(c, text, info.UpstreamModelName, info.GetEstimatePromptTokens())
		chatResp.Usage = *usage
	}

	responseValue := any(chatResp)
	if info.RelayFormat != types.RelayFormatOpenAI {
		targetResult, err := relayconvert.ConvertResponse(c, info, info.RelayFormat, chatResp)
		if err != nil {
			return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponseBody, http.StatusInternalServerError), false)
		}
		responseValue = targetResult.Value
	}
	responseBody, err := common.Marshal(responseValue)
	if err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError), false)
	}

	service.IOCopyBytesGracefully(c, resp, responseBody)
	return usage, nil
}

func OaiResponsesToChatStreamHandler(c *gin.Context, info *relaycommon.RelayInfo, resp *http.Response) (*dto.Usage, *types.NewAPIError) {
	if resp == nil || resp.Body == nil {
		return nil, types.NewOpenAIError(fmt.Errorf("invalid response"), types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}

	defer service.CloseResponseBodyGracefully(resp)

	responseId := helper.GetResponseID(c)
	createAt := time.Now().Unix()
	state, err := relayconvert.NewResponseStreamState(types.RelayFormatOpenAIResponses, info.RelayFormat, relayconvert.ResponseStreamOptions{
		ID:      responseId,
		Model:   info.UpstreamModelName,
		Created: createAt,
	})
	if err != nil {
		return nil, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
	}
	streamErr := (*types.NewAPIError)(nil)
	var resellerUsage *dto.Usage
	resellerTerminalForwarded := false

	if info.RelayFormat == types.RelayFormatClaude && info.ClaudeConvertInfo == nil {
		info.ClaudeConvertInfo = &relaycommon.ClaudeConvertInfo{LastMessagesType: relaycommon.LastMessageTypeNone}
	}

	sendGeminiResponse := func(geminiResponse *dto.GeminiChatResponse) bool {
		if geminiResponse == nil {
			return true
		}
		geminiResponseStr, err := common.Marshal(geminiResponse)
		if err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeJsonMarshalFailed, http.StatusInternalServerError)
			return false
		}
		c.Render(-1, common.CustomEvent{Data: "data: " + string(geminiResponseStr)})
		_ = helper.FlushWriter(c)
		return true
	}

	sendStreamResult := func(result relayconvert.ResponseResult) bool {
		switch value := result.Value.(type) {
		case dto.ChatCompletionsStreamResponse:
			if len(value.Choices) == 0 && value.Usage == nil {
				return true
			}
			if err := helper.ObjectData(c, &value); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			return true
		case *dto.ChatCompletionsStreamResponse:
			if value == nil || (len(value.Choices) == 0 && value.Usage == nil) {
				return true
			}
			if err := helper.ObjectData(c, value); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			return true
		case dto.ClaudeResponse:
			if err := helper.ClaudeData(c, value); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			return true
		case *dto.ClaudeResponse:
			if value == nil {
				return true
			}
			if err := helper.ClaudeData(c, *value); err != nil {
				streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
				return false
			}
			return true
		case dto.GeminiChatResponse:
			return sendGeminiResponse(&value)
		case *dto.GeminiChatResponse:
			return sendGeminiResponse(value)
		default:
			streamErr = types.NewOpenAIError(fmt.Errorf("unsupported converted stream response type %T", result.Value), types.ErrorCodeBadResponse, http.StatusInternalServerError)
			return false
		}
	}

	helper.StreamScannerHandler(c, resp, info, func(data string, sr *helper.StreamResult) {
		if streamErr != nil {
			sr.Stop(streamErr)
			return
		}
		if resellerUsage == nil {
			resellerUsage = resellerResponsesUsageForSettlement(info, nil, nil)
		}

		var streamResp dto.ResponsesStreamResponse
		if err := common.UnmarshalJsonStr(data, &streamResp); err != nil {
			logger.LogError(c, "failed to unmarshal responses stream event: "+err.Error())
			sr.Error(err)
			return
		}
		switch streamResp.Type {
		case "response.completed", "response.done", "response.failed", "response.error", "response.incomplete", "response.cancelled", "response.canceled":
			var reported *dto.Usage
			if streamResp.Response != nil {
				reported = streamResp.Response.Usage
			}
			resellerUsage = resellerResponsesUsageForSettlement(info, reported, []byte(data))
			if resellerUsage != nil && streamResp.Type != "response.completed" && streamResp.Type != "response.done" && streamResp.Type != "response.incomplete" {
				// Capture billing before the client write, which can fail after
				// the upstream has already consumed the full request.
				resellerTerminalForwarded = true
				writeErr := helper.ResponseChunkData(c, streamResp, data)
				sr.Stop(writeErr)
				return
			}
		}

		if streamResp.Type == "response.error" || streamResp.Type == "response.failed" {
			if streamResp.Response != nil {
				if oaiErr := streamResp.Response.GetOpenAIError(); oaiErr != nil && oaiErr.Type != "" {
					streamErr = types.WithOpenAIError(*oaiErr, http.StatusInternalServerError)
					sr.Stop(streamErr)
					return
				}
			}
			streamErr = types.NewOpenAIError(fmt.Errorf("responses stream error: %s", streamResp.Type), types.ErrorCodeBadResponse, http.StatusInternalServerError)
			sr.Stop(streamErr)
			return
		}

		results, err := relayconvert.ConvertStreamResponseChunk(c, info, state, &streamResp)
		if err != nil {
			streamErr = types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError)
			sr.Stop(streamErr)
			return
		}
		for _, result := range results {
			if !sendStreamResult(result) {
				sr.Stop(streamErr)
				return
			}
		}
	})

	if resellerTerminalForwarded {
		return resellerUsage, nil
	}
	if streamErr != nil {
		return finishResellerResponsesFailure(c, resellerUsage, streamErr, true)
	}

	usage := state.Usage()
	if resellerUsage != nil {
		usage = resellerUsage
		state.SetUsage(usage)
	}
	if resellerUsage == nil && (usage == nil || usage.TotalTokens == 0) {
		usage = service.ResponseText2Usage(c, state.UsageText(), info.UpstreamModelName, info.GetEstimatePromptTokens())
		state.SetUsage(usage)
	}

	if info.RelayFormat == types.RelayFormatClaude && info.ClaudeConvertInfo != nil {
		info.ClaudeConvertInfo.Usage = usage
	}
	finalResults, err := relayconvert.FinalizeStreamResponse(c, info, state)
	if err != nil {
		return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError), true)
	}
	for _, result := range finalResults {
		if !sendStreamResult(result) {
			return finishResellerResponsesFailure(c, resellerUsage, streamErr, true)
		}
	}
	if info.RelayFormat == types.RelayFormatOpenAI && info.ShouldIncludeUsage && usage != nil {
		if err := helper.ObjectData(c, helper.GenerateFinalUsageResponse(responseId, createAt, info.UpstreamModelName, *usage)); err != nil {
			return finishResellerResponsesFailure(c, resellerUsage, types.NewOpenAIError(err, types.ErrorCodeBadResponse, http.StatusInternalServerError), true)
		}
	}

	if info.RelayFormat == types.RelayFormatOpenAI {
		helper.Done(c)
	}
	return usage, nil
}
