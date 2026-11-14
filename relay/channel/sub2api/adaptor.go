package sub2api

import (
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/claude"
	"github.com/QuantumNous/new-api/relay/channel/newapi"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	relayconstant "github.com/QuantumNous/new-api/relay/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/relaykit/types"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/gin-gonic/gin"
)

type Adaptor struct {
	newapi.Adaptor
}

// Sub2API's Chat Completions bridge translates Claude 4.6 effort into manual
// thinking budgets, including an invalid budget for "none". The playground
// already has a native converter that preserves adaptive thinking correctly.
func UsesNativePlaygroundClaude(info *relaycommon.RelayInfo) bool {
	return info.ChannelType == constant.ChannelTypeSub2API && info.IsPlayground && info.RelayMode == relayconstant.RelayModeChatCompletions &&
		strings.HasPrefix(strings.ToLower(info.UpstreamModelName), "claude-") &&
		!info.ChannelSetting.PassThroughBodyEnabled && !model_setting.GetGlobalSettings().PassThroughRequestEnabled
}

func (a *Adaptor) GetRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if UsesNativePlaygroundClaude(info) {
		return relaycommon.GetFullRequestURL(info.ChannelBaseUrl, "/v1/messages", info.ChannelType), nil
	}
	return a.Adaptor.GetRequestURL(info)
}

func (a *Adaptor) SetupRequestHeader(c *gin.Context, headers *http.Header, info *relaycommon.RelayInfo) error {
	if err := a.Adaptor.SetupRequestHeader(c, headers, info); err != nil {
		return err
	}
	if UsesNativePlaygroundClaude(info) {
		headers.Set("x-api-key", info.ApiKey)
		if headers.Get("anthropic-version") == "" {
			headers.Set("anthropic-version", "2023-06-01")
		}
	}
	return nil
}

func (a *Adaptor) ConvertOpenAIRequest(c *gin.Context, info *relaycommon.RelayInfo, request *dto.GeneralOpenAIRequest) (any, error) {
	if UsesNativePlaygroundClaude(info) {
		return (&claude.Adaptor{}).ConvertOpenAIRequest(c, info, request)
	}
	return a.Adaptor.ConvertOpenAIRequest(c, info, request)
}

func (a *Adaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, body io.Reader) (any, error) {
	return channel.DoApiRequest(a, c, info, body)
}

func (a *Adaptor) DoResponse(c *gin.Context, response *http.Response, info *relaycommon.RelayInfo) (any, *types.NewAPIError) {
	if UsesNativePlaygroundClaude(info) {
		return (&claude.Adaptor{}).DoResponse(c, response, info)
	}
	return a.Adaptor.DoResponse(c, response, info)
}

func (a *Adaptor) GetModelList() []string {
	return ModelList
}

func (a *Adaptor) GetChannelName() string {
	return ChannelName
}
