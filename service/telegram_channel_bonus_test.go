package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeTelegramChannelAcceptsPublicUsernameForms(t *testing.T) {
	tests := []string{"@VL_API", "VL_API", "https://t.me/VL_API/"}
	for _, input := range tests {
		chatId, publicURL, err := NormalizeTelegramChannel(input)
		require.NoError(t, err)
		assert.Equal(t, "@VL_API", chatId)
		assert.Equal(t, "https://t.me/VL_API", publicURL)
	}
	_, _, err := NormalizeTelegramChannel("https://example.com/channel")
	assert.Error(t, err)
}

func TestTelegramChannelMemberStatusIsActive(t *testing.T) {
	tests := []struct {
		status   string
		isMember bool
		want     bool
	}{
		{status: "creator", want: true},
		{status: "administrator", want: true},
		{status: "member", want: true},
		{status: "restricted", isMember: true, want: true},
		{status: "restricted", isMember: false, want: false},
		{status: "left", want: false},
		{status: "kicked", want: false},
	}
	for _, test := range tests {
		assert.Equal(t, test.want, telegramChannelMemberStatusIsActive(test.status, test.isMember))
	}
}
