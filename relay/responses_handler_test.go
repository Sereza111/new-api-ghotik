package relay

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeLegacyResponsesConfigurationUpdates(t *testing.T) {
	body := []byte(`{
		"model":"gpt-5.6-sol",
		"input":[
			{"type":"configuration_update","reasoning":{"effort":"high"}},
			{"role":"user","content":[{"type":"input_text","text":"hello"}]}
		],
		"unknown_field":{"large_number":9007199254740993}
	}`)

	normalized, err := normalizeLegacyResponsesConfigurationUpdates(body, "")
	require.NoError(t, err)
	var request map[string]any
	require.NoError(t, common.Unmarshal(normalized, &request))
	input, ok := request["input"].([]any)
	require.True(t, ok)
	require.Len(t, input, 1)
	assert.Equal(t, "user", input[0].(map[string]any)["role"])
	assert.Equal(t, "high", request["reasoning"].(map[string]any)["effort"])
	assert.Contains(t, string(normalized), "9007199254740993")
}

func TestNormalizeLegacyResponsesConfigurationUpdatesPreservesExplicitReasoning(t *testing.T) {
	body := []byte(`{"model":"gpt-5.6-sol","reasoning":{"effort":"low","summary":"auto"},"input":[{"type":"configuration_update","reasoning":{"effort":"high"}},{"role":"user","content":"hello"}]}`)

	normalized, err := normalizeLegacyResponsesConfigurationUpdates(body, "")
	require.NoError(t, err)
	assert.NotContains(t, string(normalized), "configuration_update")
	assert.Contains(t, string(normalized), `"effort":"low"`)
	assert.Contains(t, string(normalized), `"summary":"auto"`)
}

func TestNormalizeLegacyResponsesConfigurationUpdatesKeepsGPT6(t *testing.T) {
	body := []byte(`{"model":"gpt-6-astra","input":[{"type":"configuration_update","reasoning":{"effort":"max"}}]}`)

	normalized, err := normalizeLegacyResponsesConfigurationUpdates(body, "gpt-5.6-sol")
	require.NoError(t, err)
	assert.Equal(t, body, normalized)
}
