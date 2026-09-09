package dto

import (
	"encoding/json"
	"testing"

	kitutil "github.com/QuantumNous/new-api/relaykit/relayconvert/kitutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestGeneralOpenAIRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"stream":false,
		"max_tokens":0,
		"max_completion_tokens":0,
		"top_p":0,
		"top_k":0,
		"n":0,
		"frequency_penalty":0,
		"presence_penalty":0,
		"seed":0,
		"logprobs":false,
		"top_logprobs":0,
		"dimensions":0,
		"return_images":false,
		"return_related_questions":false
	}`)

	var req GeneralOpenAIRequest
	err := kitutil.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_completion_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_k").Exists())
	require.True(t, gjson.GetBytes(encoded, "n").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "seed").Exists())
	require.True(t, gjson.GetBytes(encoded, "logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_logprobs").Exists())
	require.True(t, gjson.GetBytes(encoded, "dimensions").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_images").Exists())
	require.True(t, gjson.GetBytes(encoded, "return_related_questions").Exists())
}

func TestGeneralOpenAIRequestPreserveQwenThinkingBudget(t *testing.T) {
	raw := []byte(`{
		"model":"qwen-plus",
		"thinking_budget":0
	}`)

	var req GeneralOpenAIRequest
	err := kitutil.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	value := gjson.GetBytes(encoded, "thinking_budget")
	assert.True(t, value.Exists())
	assert.Equal(t, int64(0), value.Int())
}

func TestGeneralOpenAIRequestPreserveQwQThinkingBudget(t *testing.T) {
	req := GeneralOpenAIRequest{
		Model:          "QwQ-32B",
		ThinkingBudget: json.RawMessage(`128`),
	}

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	value := gjson.GetBytes(encoded, "thinking_budget")
	assert.True(t, value.Exists())
	assert.Equal(t, int64(128), value.Int())
}

func TestGeneralOpenAIRequestDropsThinkingBudgetForNonQwenModel(t *testing.T) {
	req := GeneralOpenAIRequest{
		Model:          "gpt-4.1",
		ThinkingBudget: json.RawMessage(`128`),
	}

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	assert.False(t, gjson.GetBytes(encoded, "thinking_budget").Exists())
}

func TestIsQwenThinkingBudgetModel(t *testing.T) {
	tests := []struct {
		model string
		want  bool
	}{
		{model: "qwen-plus", want: true},
		{model: "Qwen/Qwen3-235B-A22B-Thinking-2507", want: true},
		{model: "qwq-32b", want: true},
		{model: "provider/qwen-plus", want: true},
		{model: "provider/qwq-32b", want: true},
		{model: "gpt-4.1", want: false},
		{model: "deepseek-r1", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			assert.Equal(t, tt.want, IsQwenThinkingBudgetModel(tt.model))
		})
	}
}

func TestOpenAIResponsesRequestPreserveExplicitZeroValues(t *testing.T) {
	raw := []byte(`{
		"model":"gpt-4.1",
		"max_output_tokens":0,
		"max_tool_calls":0,
		"stream":false,
		"top_p":0,
		"frequency_penalty":0,
		"presence_penalty":0
	}`)

	var req OpenAIResponsesRequest
	err := kitutil.Unmarshal(raw, &req)
	require.NoError(t, err)

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	require.True(t, gjson.GetBytes(encoded, "max_output_tokens").Exists())
	require.True(t, gjson.GetBytes(encoded, "max_tool_calls").Exists())
	require.True(t, gjson.GetBytes(encoded, "stream").Exists())
	require.True(t, gjson.GetBytes(encoded, "top_p").Exists())
	require.True(t, gjson.GetBytes(encoded, "frequency_penalty").Exists())
	require.True(t, gjson.GetBytes(encoded, "presence_penalty").Exists())
}

func TestOpenAIResponsesRequestPreserveQwenThinkingBudget(t *testing.T) {
	req := OpenAIResponsesRequest{
		Model:          "qwen-plus",
		ThinkingBudget: json.RawMessage(`0`),
	}

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	value := gjson.GetBytes(encoded, "thinking_budget")
	assert.True(t, value.Exists())
	assert.Equal(t, int64(0), value.Int())
}

func TestOpenAIResponsesRequestPreserveQwQThinkingBudget(t *testing.T) {
	req := OpenAIResponsesRequest{
		Model:          "provider/QwQ-32B",
		ThinkingBudget: json.RawMessage(`128`),
	}

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	value := gjson.GetBytes(encoded, "thinking_budget")
	assert.True(t, value.Exists())
	assert.Equal(t, int64(128), value.Int())
}

func TestOpenAIResponsesRequestDropsThinkingBudgetForNonQwenModel(t *testing.T) {
	req := OpenAIResponsesRequest{
		Model:          "gpt-4.1",
		ThinkingBudget: json.RawMessage(`128`),
	}

	encoded, err := kitutil.Marshal(req)
	require.NoError(t, err)

	assert.False(t, gjson.GetBytes(encoded, "thinking_budget").Exists())
}

func TestGeneralOpenAIRequestGetSystemRoleName(t *testing.T) {
	tests := []struct {
		name  string
		model string
		want  string
	}{
		{name: "o1 uses developer", model: "o1", want: "developer"},
		{name: "o3 family uses developer", model: "o3-mini-high", want: "developer"},
		{name: "o4 family uses developer", model: "o4-mini", want: "developer"},
		{name: "o1 mini stays system", model: "o1-mini", want: "system"},
		{name: "o1 preview stays system", model: "o1-preview", want: "system"},
		{name: "gpt 5 uses developer", model: "gpt-5", want: "developer"},
		{name: "omni is not o series", model: "omni-moderation-latest", want: "system"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := GeneralOpenAIRequest{Model: tt.model}

			require.Equal(t, tt.want, req.GetSystemRoleName())
		})
	}
}

func TestOpenAIResponsesInputTokenMetadata(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []MediaInput
	}{
		{
			name:  "plain prompt",
			input: `"Read the project"`,
			want:  []MediaInput{{Type: "input_text", Text: "Read the project"}},
		},
		{
			name: "agent tool history",
			input: `[
				{"role":"user","content":"Read the project"},
				{"type":"message","role":"assistant","content":[{"type":"output_text","text":"I will inspect the files"}]},
				{"type":"function_call","call_id":"call_1","name":"exec_command","arguments":"{\"cmd\":\"rg --files\"}"},
				{"type":"function_call_output","call_id":"call_1","output":"main.go\nservice/billing_session.go"},
				{"type":"input_text","text":"Continue"}
			]`,
			want: []MediaInput{
				{Type: "input_text", Text: "Read the project"},
				{Type: "input_text", Text: "I will inspect the files"},
				{Type: "input_text", Text: "exec_command"},
				{Type: "input_text", Text: `{"cmd":"rg --files"}`},
				{Type: "input_text", Text: "main.go\nservice/billing_session.go"},
				{Type: "input_text", Text: "Continue"},
			},
		},
		{
			name: "custom tool and structured output",
			input: `[
				{"type":"custom_tool_call","name":"apply_patch","input":"*** Begin Patch\n*** End Patch"},
				{"type":"custom_tool_call_output","output":[{"type":"input_text","text":"Patched"},{"type":"input_image","image_url":"https://example.com/result.png","detail":"high"}]},
				{"type":"function_call_output","output":[{"type":"input_text","text":"Report"},{"type":"input_file","file_url":{"url":"https://example.com/report.pdf"}}]}
			]`,
			want: []MediaInput{
				{Type: "input_text", Text: "apply_patch"},
				{Type: "input_text", Text: "*** Begin Patch\n*** End Patch"},
				{Type: "input_text", Text: "Patched"},
				{Type: "input_image", ImageUrl: "https://example.com/result.png", Detail: "high"},
				{Type: "input_text", Text: "Report"},
				{Type: "input_file", FileUrl: "https://example.com/report.pdf"},
			},
		},
		{
			name: "visible reasoning and refusal are not encrypted state",
			input: `[
				{"type":"reasoning","summary":[{"type":"summary_text","text":"Inspected the request"}],"content":[{"type":"reasoning_text","text":"Reviewing the result"}],"encrypted_content":"opaque-state-not-countable"},
				{"type":"message","role":"assistant","content":[{"type":"refusal","refusal":"Cannot perform this action"}]},
				{"type":"item_reference","id":"server-side-history"}
			]`,
			want: []MediaInput{
				{Type: "input_text", Text: "Inspected the request"},
				{Type: "input_text", Text: "Reviewing the result"},
				{Type: "input_text", Text: "Cannot perform this action"},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := OpenAIResponsesRequest{
				Model: "gpt-5",
				Input: json.RawMessage(tt.input),
				Tools: json.RawMessage(`[{"type":"function","name":"exec_command","description":"Run a shell command","parameters":{"type":"object","properties":{"cmd":{"type":"string"}}}}]`),
			}
			before, err := kitutil.Marshal(req)
			require.NoError(t, err)
			assert.Equal(t, tt.want, req.ParseInput())
			meta := req.GetTokenCountMeta()
			require.NotNil(t, meta)
			for _, part := range tt.want {
				if part.Type == "input_text" {
					assert.Contains(t, meta.CombineText, part.Text)
				}
			}
			assert.Contains(t, meta.CombineText, string(req.Tools))
			assert.NotContains(t, meta.CombineText, "opaque-state-not-countable")
			assert.NotContains(t, meta.CombineText, "server-side-history")
			after, err := kitutil.Marshal(req)
			require.NoError(t, err)
			assert.Equal(t, before, after, "token counting must not alter the forwarded request")
		})
	}
}
