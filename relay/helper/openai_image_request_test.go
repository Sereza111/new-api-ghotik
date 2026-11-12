package helper

import (
	"bytes"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/pkg/billingexpr"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLegacyDalleValidationAndPricesRemainCompatible(t *testing.T) {
	for _, tc := range []struct {
		body, size, quality string
		ratio               float64
		invalid             bool
	}{
		{body: `{"model":"dall-e-2"}`, size: "1024x1024", ratio: 1},
		{body: `{"model":"dall-e"}`, size: "1024x1024", ratio: 1},
		{body: `{"model":"dall-e-3"}`, size: "1024x1024", quality: "standard", ratio: 1},
		{body: `{"model":"dall-e-2","size":"256x256"}`, size: "256x256", ratio: 0.4},
		{body: `{"model":"dall-e-2","size":"512x512","quality":"hd"}`, size: "512x512", quality: "hd", ratio: 0.45},
		{body: `{"model":"dall-e-3","quality":"hd"}`, size: "1024x1024", quality: "hd", ratio: 2},
		{body: `{"model":"dall-e-3","size":"1024x1792","quality":"hd"}`, size: "1024x1792", quality: "hd", ratio: 3},
		{body: `{"model":"dall-e-3","size":"1792x1024"}`, size: "1792x1024", quality: "standard", ratio: 2},
		{body: `{"model":"dall-e-3","size":"256x256"}`, invalid: true},
		{body: `{"model":"dall-e-2","size":"1024x1792"}`, invalid: true},
	} {
		t.Run(tc.body, func(t *testing.T) {
			c, _ := gin.CreateTestContext(httptest.NewRecorder())
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tc.body))
			c.Request.Header.Set("Content-Type", "application/json")
			request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			if tc.invalid {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tc.size, request.Size)
			assert.Equal(t, tc.quality, request.Quality)
			assert.Equal(t, tc.ratio, request.GetTokenCountMeta().ImagePriceRatio)
		})
	}
}

// TestGetAndValidOpenAIImageRequestMultipartStream verifies multipart image
// edit parsing: the stream field is parsed and validated, and the request body
// stays replayable for the upstream request.
func TestGetAndValidOpenAIImageRequestMultipartStream(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newContext := func(t *testing.T, streamValue string, withImage bool) (*gin.Context, string) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", "edit this image"))
		require.NoError(t, writer.WriteField("stream", streamValue))
		if withImage {
			part, err := writer.CreateFormFile("image", "input.png")
			require.NoError(t, err)
			_, err = part.Write([]byte("fake image"))
			require.NoError(t, err)
		}
		require.NoError(t, writer.Close())
		originalBody := body.String()

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		return c, originalBody
	}

	t.Run("valid stream value keeps body replayable", func(t *testing.T) {
		c, originalBody := newContext(t, "true", true)

		req, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
		require.NoError(t, err)
		require.NotNil(t, req.Stream)
		require.True(t, *req.Stream)
		require.True(t, req.IsStream(c.Request))

		bodyAfterValidation, err := io.ReadAll(c.Request.Body)
		require.NoError(t, err)
		require.Equal(t, originalBody, string(bodyAfterValidation))

		form, err := common.ParseMultipartFormReusable(c)
		require.NoError(t, err)
		require.Equal(t, "true", url.Values(form.Value).Get("stream"))
		require.Len(t, form.File["image"], 1)
		billing, err := ResolveImageBillingRequestInput(c, &relaycommon.RelayInfo{Request: req}, billingexpr.RequestInput{})
		require.NoError(t, err)
		require.Equal(t, 1, *billing.ImageCount)
		require.Equal(t, "2K", *billing.ImageSize)
		require.JSONEq(t, `{"model":"gpt-image-1","n":1,"size":"2K","quality":"standard"}`, string(billing.Body))
		require.NotContains(t, string(billing.Body), "fake image")
		require.NotContains(t, string(billing.Body), "edit this image")
	})

	t.Run("invalid stream value is rejected", func(t *testing.T) {
		c, _ := newContext(t, "notabool", false)

		_, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
		require.Error(t, err)
		require.Contains(t, err.Error(), "invalid stream value")
	})
}

// Provider `parameters.n` is still bounded at ingress so a malformed multiplier
// is a client error, but the billing quantity always follows the top-level n:
// Ali image requests are served by the alibaba task plugin, which owns the
// DashScope parameters.n semantics.
func TestImageBillingRequestValidatesProviderCountWithoutOverriding(t *testing.T) {
	for _, tc := range []struct {
		body    string
		count   int
		invalid bool
	}{
		{`{"model":"z-image","n":2,"parameters":{"n":3,"prompt_extend":true}}`, 2, false},
		{`{"model":"gpt-image-2","n":2,"parameters":{"n":3}}`, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":129}}`, 0, true},
		{`{"model":"z-image","parameters":{"n":-1}}`, 0, true},
		{`{"model":"z-image","n":2,"parameters":{}}`, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":null}}`, 2, false},
		{`{"model":"z-image","n":2,"parameters":{"n":0}}`, 2, false},
		{`{"model":"z-image","parameters":{"n":1.5}}`, 0, true},
		{`{"model":"z-image","parameters":{"n":18446744073686646784}}`, 0, true},
		{`{"model":"z-image","parameters":{"n":128}}`, 1, false},
		{`{"model":"z-image","n":0}`, 1, false},
		{`{"model":"gpt-image-2","n":2,"parameters":{"n":0}}`, 2, false},
	} {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(tc.body))
		c.Request.Header.Set("Content-Type", "application/json")
		common.SetContextKey(c, constant.ContextKeyChannelType, constant.ChannelTypeOpenAI)
		request, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
		if tc.invalid {
			require.Error(t, err, tc.body)
			continue
		}
		require.NoError(t, err, tc.body)
		input, err := ResolveImageBillingRequestInput(c, &relaycommon.RelayInfo{Request: request}, billingexpr.RequestInput{})
		require.NoError(t, err)
		require.Equal(t, tc.count, *input.ImageCount, tc.body)
		require.Equal(t, "2K", *input.ImageSize, tc.body)
		cost, _, err := billingexpr.RunExprWithRequest(`tier("image", fixed(0.04)) * image_count`, billingexpr.TokenParams{}, input)
		require.NoError(t, err)
		require.Equal(t, float64(tc.count)*40000, cost)
	}
}

// TestGetAndValidOpenAIImageRequestNBounds guards the billing invariant that
// the image generation count can never reach quota calculation with a value
// large enough to overflow int64 into a negative charge.
func TestGetAndValidOpenAIImageRequestNBounds(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newJSONContext := func(t *testing.T, body string) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/generations", bytes.NewBufferString(body))
		c.Request.Header.Set("Content-Type", "application/json")
		return c
	}

	boundErr := fmt.Sprintf("n must be an integer between 1 and %d", dto.MaxImageN)

	tests := []struct {
		name    string
		body    string
		wantErr string
		wantN   uint
	}{
		{
			name:    "overflowed uint64 n is rejected",
			body:    `{"model":"gpt-image-1","prompt":"a cat","n":18446744073686646784}`,
			wantErr: boundErr,
		},
		{
			name:    "n above max is rejected",
			body:    fmt.Sprintf(`{"model":"gpt-image-1","prompt":"a cat","n":%d}`, dto.MaxImageN+1),
			wantErr: boundErr,
		},
		{
			name:  "n at max is accepted",
			body:  fmt.Sprintf(`{"model":"gpt-image-1","prompt":"a cat","n":%d}`, dto.MaxImageN),
			wantN: dto.MaxImageN,
		},
		{
			name:  "explicit n is accepted",
			body:  `{"model":"gpt-image-1","prompt":"a cat","n":3}`,
			wantN: 3,
		},
		{
			name:  "zero n defaults to 1",
			body:  `{"model":"gpt-image-1","prompt":"a cat","n":0}`,
			wantN: 1,
		},
		{
			name:  "absent n defaults to 1",
			body:  `{"model":"gpt-image-1","prompt":"a cat"}`,
			wantN: 1,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newJSONContext(t, tt.body)
			req, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesGenerations)
			if tt.wantErr != "" {
				require.Error(t, err)
				require.Contains(t, err.Error(), tt.wantErr)
				return
			}
			require.NoError(t, err)
			require.NotNil(t, req.N)
			require.Equal(t, tt.wantN, *req.N)
			require.Equal(t, float64(tt.wantN), req.GetTokenCountMeta().BillingRatios["n"])
		})
	}

	t.Run("negative multipart n is rejected", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-1"))
		require.NoError(t, writer.WriteField("prompt", "edit this image"))
		require.NoError(t, writer.WriteField("n", "-22904832"))
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())

		_, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
		require.Error(t, err)
		require.Contains(t, err.Error(), boundErr)
	})
}

func TestOpenAIImageResolutionPricing(t *testing.T) {
	tests := []struct {
		name      string
		size      string
		wantTier  string
		wantRatio float64
	}{
		{name: "named 1K", size: "1K", wantTier: "1K", wantRatio: 1},
		{name: "one kilopixel dimensions", size: "1024x1024", wantTier: "1K", wantRatio: 1},
		{name: "named 2K", size: "2K", wantTier: "2K", wantRatio: 1.5},
		{name: "two kilopixel dimensions", size: "2048x1152", wantTier: "2K", wantRatio: 1.5},
		{name: "unicode dimensions", size: "2048\u00d71152", wantTier: "2K", wantRatio: 1.5},
		{name: "named 4K", size: "4K", wantTier: "4K", wantRatio: 2},
		{name: "four kilopixel dimensions", size: "3840x2160", wantTier: "4K", wantRatio: 2},
		{name: "just above 1K", size: "1025x1024", wantTier: "2K", wantRatio: 1.5},
		{name: "just above 2K", size: "2049x1024", wantTier: "4K", wantRatio: 2},
		{name: "automatic size", size: "auto", wantTier: "2K", wantRatio: 1.5},
		{name: "empty size", size: "", wantTier: "2K", wantRatio: 1.5},
		{name: "malformed size", size: "large", wantTier: "2K", wantRatio: 1.5},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &dto.ImageRequest{Model: "gpt-image-2.5-sunburst", Prompt: "draw a cat", Size: tt.size}
			meta := req.GetTokenCountMeta()
			require.Equal(t, tt.wantTier, dto.ImageRequestSizePriceTier(tt.size))
			require.Equal(t, tt.wantRatio, meta.BillingRatios["image_size"])
			require.Equal(t, 1.0, meta.BillingRatios["n"])
		})
	}

	t.Run("sunburst preserves native fields without bypassing 4K billing", func(t *testing.T) {
		body := `{
			"model":"gpt-image-2.6-sunburst",
			"prompt":"animate the reference",
			"size":"4K",
			"quality":"high",
			"output_format":"svg",
			"markup":{"image_url":"data:image/png;base64,aW1hZ2U="}
		}`
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", bytes.NewBufferString(body))
		c.Request.Header.Set("Content-Type", "application/json")

		req, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
		require.NoError(t, err)
		require.Equal(t, 2.0, req.GetTokenCountMeta().BillingRatios["image_size"])

		upstreamBody, err := common.Marshal(req)
		require.NoError(t, err)
		var upstream map[string]any
		require.NoError(t, common.Unmarshal(upstreamBody, &upstream))
		require.Equal(t, "4K", upstream["size"])
		require.Equal(t, "high", upstream["quality"])
		require.Equal(t, "svg", upstream["output_format"])
		markup, ok := upstream["markup"].(map[string]any)
		require.True(t, ok)
		require.Equal(t, "data:image/png;base64,aW1hZ2U=", markup["image_url"])
	})

	t.Run("DALL-E keeps legacy size and quality pricing", func(t *testing.T) {
		req := &dto.ImageRequest{Model: "dall-e-3", Prompt: "draw a cat", Size: "1024x1792", Quality: "hd"}
		meta := req.GetTokenCountMeta()
		require.Equal(t, 3.0, meta.ImagePriceRatio)
		require.NotContains(t, meta.BillingRatios, "image_size")
	})

	t.Run("unrelated image model does not gain OpenAI resolution pricing", func(t *testing.T) {
		req := &dto.ImageRequest{Model: "custom-image-model", Prompt: "draw a cat", Size: "4K"}
		require.NotContains(t, req.GetTokenCountMeta().BillingRatios, "image_size")
	})

	t.Run("multipart edit carries size and count billing ratios", func(t *testing.T) {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		require.NoError(t, writer.WriteField("model", "gpt-image-2.5-sunburst"))
		require.NoError(t, writer.WriteField("prompt", "edit this image"))
		require.NoError(t, writer.WriteField("size", "3840x2160"))
		require.NoError(t, writer.WriteField("n", "2"))
		part, err := writer.CreateFormFile("image", "input.png")
		require.NoError(t, err)
		_, err = part.Write([]byte("fake image"))
		require.NoError(t, err)
		require.NoError(t, writer.Close())

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/images/edits", &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())

		req, err := GetAndValidOpenAIImageRequest(c, relayconstant.RelayModeImagesEdits)
		require.NoError(t, err)
		meta := req.GetTokenCountMeta()
		require.Equal(t, 2.0, meta.BillingRatios["image_size"])
		require.Equal(t, 2.0, meta.BillingRatios["n"])
		input, err := ResolveImageBillingRequestInput(c, &relaycommon.RelayInfo{Request: req}, billingexpr.RequestInput{})
		require.NoError(t, err)
		require.Equal(t, "4K", *input.ImageSize)
		require.Contains(t, string(input.Body), `"size":"4K"`)
	})
}
