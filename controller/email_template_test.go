package controller

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRenderAuthEmailRendersRussianVerificationMessage(t *testing.T) {
	content, err := renderAuthEmail(authEmailData{
		SystemName:   "VL API",
		PreviewText:  "Код подтверждения: 37a9c0",
		Eyebrow:      "Подтверждение почты",
		Title:        "Подтвердите адрес электронной почты",
		Description:  "Введите код на странице регистрации.",
		Code:         "37a9c0",
		ValidMinutes: 10,
		ServerURL:    "https://example.com",
	})

	require.NoError(t, err)
	assert.Contains(t, content, "Подтвердите адрес электронной почты")
	assert.Contains(t, content, "37a9c0")
	assert.Contains(t, content, "Данные действительны 10 минут")
	assert.Contains(t, content, "https://example.com")
}

func TestRenderAuthEmailEscapesAdminControlledBranding(t *testing.T) {
	content, err := renderAuthEmail(authEmailData{
		SystemName:   `<img src=x onerror=alert(1)>`,
		Title:        "Подтверждение",
		ValidMinutes: 10,
	})

	require.NoError(t, err)
	assert.NotContains(t, content, `<img src=x onerror=alert(1)>`)
	assert.Contains(t, content, `&lt;img src=x onerror=alert(1)&gt;`)
}
