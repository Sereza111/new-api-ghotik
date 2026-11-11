package controller

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

const (
	playgroundConversationMaxBodySize = model.PlaygroundConversationMaxMessagesBytes + 256*1024
)

type playgroundConversationConfig struct {
	Model            string  `json:"model"`
	Group            string  `json:"group"`
	Temperature      float64 `json:"temperature"`
	TopP             float64 `json:"top_p"`
	MaxTokens        int     `json:"max_tokens"`
	FrequencyPenalty float64 `json:"frequency_penalty"`
	PresencePenalty  float64 `json:"presence_penalty"`
	Seed             *int    `json:"seed"`
	Stream           bool    `json:"stream"`
	ReasoningEffort  string  `json:"reasoning_effort"`
}

type playgroundParameterEnabled struct {
	Temperature      bool `json:"temperature"`
	TopP             bool `json:"top_p"`
	MaxTokens        bool `json:"max_tokens"`
	FrequencyPenalty bool `json:"frequency_penalty"`
	PresencePenalty  bool `json:"presence_penalty"`
	Seed             bool `json:"seed"`
}

type playgroundMessageVersion struct {
	ID      string `json:"id"`
	Content string `json:"content"`
}

type playgroundMessageSource struct {
	Href  string `json:"href"`
	Title string `json:"title"`
}

type playgroundMessageReasoning struct {
	Content     string  `json:"content"`
	Duration    float64 `json:"duration"`
	StartedAt   *int64  `json:"startedAt,omitempty"`
	CompletedAt *int64  `json:"completedAt,omitempty"`
	DurationMs  *int64  `json:"durationMs,omitempty"`
}

// playgroundConversationMessage deliberately excludes images and inputImages.
// Clipboard data URLs are request-scoped and must not be persisted in the DB.
type playgroundConversationMessage struct {
	Key                  string                      `json:"key"`
	From                 string                      `json:"from"`
	Versions             []playgroundMessageVersion  `json:"versions"`
	CreatedAt            *int64                      `json:"createdAt,omitempty"`
	StartedAt            *int64                      `json:"startedAt,omitempty"`
	CompletedAt          *int64                      `json:"completedAt,omitempty"`
	DurationMs           *int64                      `json:"durationMs,omitempty"`
	Sources              []playgroundMessageSource   `json:"sources,omitempty"`
	Reasoning            *playgroundMessageReasoning `json:"reasoning,omitempty"`
	IsReasoningStreaming *bool                       `json:"isReasoningStreaming,omitempty"`
	IsReasoningComplete  *bool                       `json:"isReasoningComplete,omitempty"`
	IsContentComplete    *bool                       `json:"isContentComplete,omitempty"`
	Status               string                      `json:"status,omitempty"`
	ErrorCode            *string                     `json:"errorCode,omitempty"`
}

type createPlaygroundConversationRequest struct {
	Title            string                          `json:"title"`
	Config           playgroundConversationConfig    `json:"config"`
	ParameterEnabled playgroundParameterEnabled      `json:"parameter_enabled"`
	Messages         []playgroundConversationMessage `json:"messages"`
}

type updatePlaygroundConversationRequest struct {
	Revision         int64                            `json:"revision"`
	Title            *string                          `json:"title"`
	Config           *playgroundConversationConfig    `json:"config"`
	ParameterEnabled *playgroundParameterEnabled      `json:"parameter_enabled"`
	Messages         *[]playgroundConversationMessage `json:"messages"`
}

type playgroundConversationSummaryResponse struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Model        string `json:"model"`
	MessageCount int64  `json:"message_count"`
	Revision     int64  `json:"revision"`
	CreatedAt    int64  `json:"created_at"`
	UpdatedAt    int64  `json:"updated_at"`
}

type playgroundConversationResponse struct {
	playgroundConversationSummaryResponse
	Config           playgroundConversationConfig    `json:"config"`
	ParameterEnabled playgroundParameterEnabled      `json:"parameter_enabled"`
	Messages         []playgroundConversationMessage `json:"messages"`
}

func normalizePlaygroundConversationTitle(title string, messages []playgroundConversationMessage) (string, bool) {
	title = strings.TrimSpace(title)
	if title == "" {
		for _, message := range messages {
			if message.From != "user" || len(message.Versions) == 0 {
				continue
			}
			title = strings.TrimSpace(message.Versions[len(message.Versions)-1].Content)
			if title != "" {
				break
			}
		}
	}
	if title == "" {
		title = "New conversation"
	}
	runes := []rune(title)
	if len(runes) > model.PlaygroundConversationMaxTitleRunes {
		title = strings.TrimSpace(string(runes[:model.PlaygroundConversationMaxTitleRunes]))
	}
	return title, utf8.ValidString(title)
}

func validatePlaygroundConversationMessage(message playgroundConversationMessage) bool {
	if message.Key == "" || len(message.Key) > 128 || len(message.Versions) == 0 || len(message.Versions) > 20 {
		return false
	}
	if message.From != "user" && message.From != "assistant" && message.From != "system" {
		return false
	}
	for _, version := range message.Versions {
		if version.ID == "" || len(version.ID) > 128 {
			return false
		}
	}
	if len(message.Sources) > 50 {
		return false
	}
	switch message.Status {
	case "", "loading", "streaming", "complete", "error":
		return true
	default:
		return false
	}
}

func marshalPlaygroundConversationMessages(messages []playgroundConversationMessage) ([]string, error) {
	if len(messages) > model.PlaygroundConversationMaxMessages {
		return nil, model.ErrPlaygroundConversationInvalid
	}
	payloads := make([]string, 0, len(messages))
	for _, message := range messages {
		if !validatePlaygroundConversationMessage(message) {
			return nil, model.ErrPlaygroundConversationInvalid
		}
		payload, err := common.Marshal(message)
		if err != nil || len(payload) > model.PlaygroundConversationMaxMessageBytes {
			return nil, model.ErrPlaygroundConversationInvalid
		}
		payloads = append(payloads, string(payload))
	}
	return payloads, nil
}

func marshalPlaygroundConversationSettings(config playgroundConversationConfig, parameters playgroundParameterEnabled) (string, string, error) {
	if len(config.Model) > model.PlaygroundConversationMaxModelBytes || !utf8.ValidString(config.Model) {
		return "", "", model.ErrPlaygroundConversationInvalid
	}
	configJSON, err := common.Marshal(config)
	if err != nil || len(configJSON) > model.PlaygroundConversationMaxConfigBytes {
		return "", "", model.ErrPlaygroundConversationInvalid
	}
	parametersJSON, err := common.Marshal(parameters)
	if err != nil || len(parametersJSON) > model.PlaygroundConversationMaxConfigBytes {
		return "", "", model.ErrPlaygroundConversationInvalid
	}
	return string(configJSON), string(parametersJSON), nil
}

func buildPlaygroundConversationSummary(conversation model.PlaygroundConversation) playgroundConversationSummaryResponse {
	return playgroundConversationSummaryResponse{
		ID:           conversation.ID,
		Title:        conversation.Title,
		Model:        conversation.Model,
		MessageCount: conversation.MessageCount,
		Revision:     conversation.Revision,
		CreatedAt:    conversation.CreatedAt,
		UpdatedAt:    conversation.UpdatedAt,
	}
}

func buildPlaygroundConversationResponse(conversation *model.PlaygroundConversation, payloads []string) (*playgroundConversationResponse, error) {
	response := &playgroundConversationResponse{
		playgroundConversationSummaryResponse: buildPlaygroundConversationSummary(*conversation),
		Messages:                              make([]playgroundConversationMessage, 0, len(payloads)),
	}
	if err := common.UnmarshalJsonStr(conversation.Config, &response.Config); err != nil {
		return nil, err
	}
	if err := common.UnmarshalJsonStr(conversation.ParameterEnabled, &response.ParameterEnabled); err != nil {
		return nil, err
	}
	for _, payload := range payloads {
		var message playgroundConversationMessage
		if err := common.UnmarshalJsonStr(payload, &message); err != nil {
			return nil, err
		}
		response.Messages = append(response.Messages, message)
	}
	return response, nil
}

func writePlaygroundConversationError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, model.ErrPlaygroundConversationNotFound):
		common.ApiErrorStatus(c, http.StatusNotFound, err, gin.H{"code": "PLAYGROUND_SESSION_NOT_FOUND"})
	case errors.Is(err, model.ErrPlaygroundConversationConflict):
		common.ApiErrorStatus(c, http.StatusConflict, err, gin.H{"code": "PLAYGROUND_SESSION_CONFLICT"})
	case errors.Is(err, model.ErrPlaygroundConversationLimit):
		common.ApiErrorStatus(c, http.StatusConflict, err, gin.H{"code": "PLAYGROUND_SESSION_LIMIT"})
	case errors.Is(err, model.ErrPlaygroundConversationInvalid):
		common.ApiErrorStatus(c, http.StatusBadRequest, err, gin.H{"code": "PLAYGROUND_SESSION_INVALID"})
	default:
		common.ApiErrorStatus(c, http.StatusInternalServerError, errors.New("failed to store playground conversation"), gin.H{"code": "PLAYGROUND_SESSION_STORAGE_FAILED"})
	}
}

func ListPlaygroundConversations(c *gin.Context) {
	conversations, err := model.ListPlaygroundConversations(c.GetInt("id"))
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	items := make([]playgroundConversationSummaryResponse, 0, len(conversations))
	for _, conversation := range conversations {
		items = append(items, buildPlaygroundConversationSummary(conversation))
	}
	common.ApiSuccess(c, items)
}

func CreatePlaygroundConversation(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, playgroundConversationMaxBodySize)
	var request createPlaygroundConversationRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		writePlaygroundConversationError(c, model.ErrPlaygroundConversationInvalid)
		return
	}
	title, ok := normalizePlaygroundConversationTitle(request.Title, request.Messages)
	if !ok {
		writePlaygroundConversationError(c, model.ErrPlaygroundConversationInvalid)
		return
	}
	config, parameters, err := marshalPlaygroundConversationSettings(request.Config, request.ParameterEnabled)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	payloads, err := marshalPlaygroundConversationMessages(request.Messages)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	conversation, err := model.CreatePlaygroundConversation(c.GetInt("id"), title, request.Config.Model, config, parameters, payloads)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	response, err := buildPlaygroundConversationResponse(conversation, payloads)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	common.ApiSuccess(c, response)
}

func GetPlaygroundConversation(c *gin.Context) {
	conversation, payloads, err := model.GetPlaygroundConversation(c.GetInt("id"), strings.TrimSpace(c.Param("id")))
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	response, err := buildPlaygroundConversationResponse(conversation, payloads)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	common.ApiSuccess(c, response)
}

func UpdatePlaygroundConversation(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, playgroundConversationMaxBodySize)
	var request updatePlaygroundConversationRequest
	if err := c.ShouldBindJSON(&request); err != nil || request.Revision <= 0 {
		writePlaygroundConversationError(c, model.ErrPlaygroundConversationInvalid)
		return
	}
	if request.Title == nil && request.Config == nil && request.ParameterEnabled == nil && request.Messages == nil {
		writePlaygroundConversationError(c, model.ErrPlaygroundConversationInvalid)
		return
	}
	update := model.PlaygroundConversationUpdate{}
	if request.Title != nil {
		title, ok := normalizePlaygroundConversationTitle(*request.Title, nil)
		if !ok {
			writePlaygroundConversationError(c, model.ErrPlaygroundConversationInvalid)
			return
		}
		update.Title = &title
	}
	if request.Config != nil {
		configJSON, _, err := marshalPlaygroundConversationSettings(*request.Config, playgroundParameterEnabled{})
		if err != nil {
			writePlaygroundConversationError(c, err)
			return
		}
		update.Config = &configJSON
		update.Model = &request.Config.Model
	}
	if request.ParameterEnabled != nil {
		_, parametersJSON, err := marshalPlaygroundConversationSettings(playgroundConversationConfig{}, *request.ParameterEnabled)
		if err != nil {
			writePlaygroundConversationError(c, err)
			return
		}
		update.ParameterEnabled = &parametersJSON
	}
	if request.Messages != nil {
		payloads, err := marshalPlaygroundConversationMessages(*request.Messages)
		if err != nil {
			writePlaygroundConversationError(c, err)
			return
		}
		update.Messages = &payloads
	}
	conversation, payloads, err := model.UpdatePlaygroundConversation(
		c.GetInt("id"), strings.TrimSpace(c.Param("id")), request.Revision, update,
	)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	response, err := buildPlaygroundConversationResponse(conversation, payloads)
	if err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	common.ApiSuccess(c, response)
}

func DeletePlaygroundConversation(c *gin.Context) {
	if err := model.DeletePlaygroundConversation(c.GetInt("id"), strings.TrimSpace(c.Param("id"))); err != nil {
		writePlaygroundConversationError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
