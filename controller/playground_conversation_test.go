package controller

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPlaygroundComparisonConfigValidation(t *testing.T) {
	tests := []struct {
		name       string
		comparison *playgroundComparisonConfig
		wantErr    bool
	}{
		{name: "legacy config", comparison: nil},
		{name: "disabled empty config", comparison: &playgroundComparisonConfig{}},
		{
			name: "enabled comparison",
			comparison: &playgroundComparisonConfig{
				Enabled:         true,
				Model:           "gpt-6-sol",
				Group:           "default",
				ReasoningEffort: "max",
			},
		},
		{
			name:       "enabled without model",
			comparison: &playgroundComparisonConfig{Enabled: true, Group: "default"},
			wantErr:    true,
		},
		{
			name:       "enabled without group",
			comparison: &playgroundComparisonConfig{Enabled: true, Model: "gpt-6-sol"},
			wantErr:    true,
		},
		{
			name:       "oversized model",
			comparison: &playgroundComparisonConfig{Model: strings.Repeat("m", model.PlaygroundConversationMaxModelBytes+1)},
			wantErr:    true,
		},
		{
			name:       "oversized group",
			comparison: &playgroundComparisonConfig{Group: strings.Repeat("g", playgroundComparisonMaxGroupBytes+1)},
			wantErr:    true,
		},
		{
			name:       "invalid utf8",
			comparison: &playgroundComparisonConfig{Model: string([]byte{0xff})},
			wantErr:    true,
		},
		{
			name:       "non canonical reasoning effort",
			comparison: &playgroundComparisonConfig{ReasoningEffort: "ultra"},
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := marshalPlaygroundConversationSettings(
				playgroundConversationConfig{Model: "gpt-4o", Comparison: tt.comparison},
				playgroundParameterEnabled{},
			)
			if tt.wantErr {
				assert.ErrorIs(t, err, model.ErrPlaygroundConversationInvalid)
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestPlaygroundPrimaryReasoningEffortValidation(t *testing.T) {
	tests := []struct {
		name   string
		effort string
		valid  bool
	}{
		{name: "legacy empty", valid: true},
		{name: "canonical max", effort: "max", valid: true},
		{name: "non canonical ultra", effort: "ultra"},
		{name: "unknown effort", effort: "extreme"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := marshalPlaygroundConversationSettings(
				playgroundConversationConfig{
					Model:           "gpt-6-sol",
					ReasoningEffort: tt.effort,
				},
				playgroundParameterEnabled{},
			)
			if tt.valid {
				require.NoError(t, err)
				return
			}
			assert.ErrorIs(t, err, model.ErrPlaygroundConversationInvalid)
		})
	}
}

func TestPlaygroundMessageLaneAndTurnValidation(t *testing.T) {
	validMessage := playgroundConversationMessage{
		Key:      "message-1",
		From:     "user",
		Versions: []playgroundMessageVersion{{ID: "version-1", Content: "hello"}},
	}

	tests := []struct {
		name   string
		mutate func(*playgroundConversationMessage)
		valid  bool
	}{
		{name: "legacy message", valid: true},
		{
			name: "primary lane with turn",
			mutate: func(message *playgroundConversationMessage) {
				message.Lane = "primary"
				message.TurnID = "turn-1"
			},
			valid: true,
		},
		{
			name: "secondary lane with turn",
			mutate: func(message *playgroundConversationMessage) {
				message.Lane = "secondary"
				message.TurnID = "turn-1"
			},
			valid: true,
		},
		{
			name: "unknown lane",
			mutate: func(message *playgroundConversationMessage) {
				message.Lane = "other"
			},
		},
		{
			name: "oversized turn id",
			mutate: func(message *playgroundConversationMessage) {
				message.TurnID = strings.Repeat("t", playgroundMessageMaxTurnIDBytes+1)
			},
		},
		{
			name: "invalid turn id utf8",
			mutate: func(message *playgroundConversationMessage) {
				message.TurnID = string([]byte{0xff})
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			message := validMessage
			if tt.mutate != nil {
				tt.mutate(&message)
			}
			assert.Equal(t, tt.valid, validatePlaygroundConversationMessage(message))
		})
	}
}
