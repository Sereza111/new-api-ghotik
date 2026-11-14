package main

import (
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentManifestsAreEmbeddedAsJSON(t *testing.T) {
	for _, path := range []string{
		"web/dist/.well-known/ai-catalog.json",
		"web/dist/.well-known/ard.json",
	} {
		t.Run(path, func(t *testing.T) {
			content, err := buildFS.ReadFile(path)
			require.NoError(t, err)

			var manifest map[string]any
			require.NoError(t, common.Unmarshal(content, &manifest))
			assert.NotEmpty(t, manifest)
			assert.False(t, strings.Contains(strings.ToLower(string(content)), "<html"))
		})
	}
}
