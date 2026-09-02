package service

import (
	"sort"
	"strings"
	"unicode"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
)

const RoutingSourceFallbackDescription = "If the selected source does not support the requested model, routing falls back to the API token or account group."

type RoutingSource struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	Description     string  `json:"description"`
	PriceMultiplier float64 `json:"price_multiplier"`
	ModelCount      int     `json:"model_count"`
	IsDefault       bool    `json:"is_default"`
	IsSelected      bool    `json:"is_selected,omitempty"`
}

type RoutingSourceFamily struct {
	ID                  string          `json:"id"`
	Label               string          `json:"label"`
	SelectedSourceID    string          `json:"selected_source_id"`
	DefaultSourceID     string          `json:"default_source_id"`
	Sources             []RoutingSource `json:"sources"`
	FallbackDescription string          `json:"fallback_description"`
}

type RoutingSourceCatalog struct {
	Families []RoutingSourceFamily `json:"families"`
	Sources  []RoutingSource       `json:"sources"`
}

func RoutingModelFamily(modelName string) string {
	modelName = strings.ToLower(strings.TrimSpace(modelName))
	if modelName == "" {
		return ""
	}

	segments := strings.FieldsFunc(modelName, func(r rune) bool {
		return r == '/' || r == '\\'
	})
	for _, segment := range segments {
		if family := knownRoutingModelFamily(segment); family != "" {
			return family
		}
	}
	if family := knownRoutingModelFamily(modelName); family != "" {
		return family
	}

	candidate := modelName
	if len(segments) > 0 {
		candidate = segments[len(segments)-1]
	}
	end := strings.IndexFunc(candidate, func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r))
	})
	if end >= 0 {
		candidate = candidate[:end]
	}
	return strings.TrimSpace(candidate)
}

func knownRoutingModelFamily(modelName string) string {
	switch {
	case strings.HasPrefix(modelName, "gpt-"),
		strings.HasPrefix(modelName, "chatgpt-"),
		strings.HasPrefix(modelName, "codex-"),
		strings.HasPrefix(modelName, "text-embedding-"),
		strings.HasPrefix(modelName, "text-moderation-"),
		strings.HasPrefix(modelName, "omni-moderation-"),
		strings.HasPrefix(modelName, "dall-e"),
		strings.HasPrefix(modelName, "whisper-"),
		strings.HasPrefix(modelName, "tts-"),
		isOpenAIReasoningModel(modelName):
		return "gpt"
	case strings.HasPrefix(modelName, "claude"):
		return "claude"
	case strings.HasPrefix(modelName, "gemini"), strings.HasPrefix(modelName, "gemma"):
		return "gemini"
	case strings.HasPrefix(modelName, "grok"):
		return "grok"
	case strings.HasPrefix(modelName, "deepseek"):
		return "deepseek"
	case strings.HasPrefix(modelName, "glm"), strings.HasPrefix(modelName, "chatglm"):
		return "glm"
	default:
		return ""
	}
}

func isOpenAIReasoningModel(modelName string) bool {
	if len(modelName) < 2 || modelName[0] != 'o' || modelName[1] < '0' || modelName[1] > '9' {
		return false
	}
	return len(modelName) == 2 || modelName[2] == '-' || modelName[2] == '_'
}

func routingFamilyLabel(family string) string {
	switch family {
	case "gpt":
		return "GPT"
	case "grok":
		return "Grok"
	case "claude":
		return "Claude"
	case "gemini":
		return "Gemini"
	case "deepseek":
		return "DeepSeek"
	case "glm":
		return "GLM"
	default:
		return strings.ToUpper(family)
	}
}

func GetRoutingSourceCatalog(userGroup string, settings dto.UserSetting) RoutingSourceCatalog {
	usableGroups := GetUserUsableGroups(userGroup)
	groupNames := make([]string, 0, len(usableGroups))
	for group := range usableGroups {
		if IsUserSelectableGroup(userGroup, group) {
			groupNames = append(groupNames, group)
		}
	}
	sort.Strings(groupNames)

	type sourceModelCounts struct {
		total       int
		byFamily    map[string]int
		description string
	}
	countsBySource := make(map[string]sourceModelCounts, len(groupNames))
	familyNames := make(map[string]struct{})
	for _, group := range groupNames {
		seenModels := make(map[string]struct{})
		familyCounts := make(map[string]int)
		for _, modelName := range model.GetGroupEnabledModels(group) {
			if _, duplicate := seenModels[modelName]; duplicate {
				continue
			}
			seenModels[modelName] = struct{}{}
			family := RoutingModelFamily(modelName)
			if family == "" {
				continue
			}
			familyCounts[family]++
			familyNames[family] = struct{}{}
		}
		countsBySource[group] = sourceModelCounts{
			total:       len(seenModels),
			byFamily:    familyCounts,
			description: usableGroups[group],
		}
	}

	sources := make([]RoutingSource, 0, len(groupNames))
	for _, group := range groupNames {
		counts := countsBySource[group]
		if counts.total == 0 {
			continue
		}
		sources = append(sources, RoutingSource{
			ID:              group,
			Label:           group,
			Description:     counts.description,
			PriceMultiplier: GetUserGroupRatio(userGroup, group),
			ModelCount:      counts.total,
			IsDefault:       group == userGroup,
		})
	}

	sortedFamilies := make([]string, 0, len(familyNames))
	for family := range familyNames {
		sortedFamilies = append(sortedFamilies, family)
	}
	sort.Strings(sortedFamilies)

	families := make([]RoutingSourceFamily, 0, len(sortedFamilies))
	for _, family := range sortedFamilies {
		familySources := make([]RoutingSource, 0, len(groupNames))
		selectedSource := strings.TrimSpace(settings.RoutingSources[family])
		selectionValid := false
		for _, group := range groupNames {
			counts := countsBySource[group]
			modelCount := counts.byFamily[family]
			if modelCount == 0 {
				continue
			}
			isSelected := group == selectedSource
			selectionValid = selectionValid || isSelected
			familySources = append(familySources, RoutingSource{
				ID:              group,
				Label:           group,
				Description:     counts.description,
				PriceMultiplier: GetUserGroupRatio(userGroup, group),
				ModelCount:      modelCount,
				IsDefault:       group == userGroup,
				IsSelected:      isSelected,
			})
		}
		if !selectionValid {
			selectedSource = ""
		}
		families = append(families, RoutingSourceFamily{
			ID:                  family,
			Label:               routingFamilyLabel(family),
			SelectedSourceID:    selectedSource,
			DefaultSourceID:     "",
			Sources:             familySources,
			FallbackDescription: RoutingSourceFallbackDescription,
		})
	}

	return RoutingSourceCatalog{Families: families, Sources: sources}
}

func RoutingSourceAvailable(catalog RoutingSourceCatalog, family, sourceID string) bool {
	for _, candidateFamily := range catalog.Families {
		if candidateFamily.ID != family {
			continue
		}
		for _, source := range candidateFamily.Sources {
			if source.ID == sourceID {
				return true
			}
		}
		return false
	}
	return false
}

// ApplyRoutingSourcePreference converts an account preference into the
// existing ordered auto-group route. The token route remains the fallback.
func ApplyRoutingSourcePreference(c *gin.Context, modelName, explicitGroup string) bool {
	if c == nil || strings.TrimSpace(explicitGroup) != "" {
		return false
	}
	if _, pinned, _ := GetChannelConstraints(c).ResolvedPin(); pinned {
		return false
	}

	family := RoutingModelFamily(modelName)
	settings, ok := common.GetContextKeyType[dto.UserSetting](c, constant.ContextKeyUserSetting)
	if !ok || family == "" {
		return false
	}
	selectedSource := strings.TrimSpace(settings.RoutingSources[family])
	userGroup := common.GetContextKeyString(c, constant.ContextKeyUserGroup)
	if !IsUserSelectableGroup(userGroup, selectedSource) {
		return false
	}

	originalTokenGroup := common.GetContextKeyString(c, constant.ContextKeyTokenGroup)
	originalUsingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	fallbackGroups := make([]string, 0)
	if originalTokenGroup == "auto" || (originalTokenGroup == "" && originalUsingGroup == "auto") {
		fallbackGroups = append(fallbackGroups, GetRequestAutoGroups(c, userGroup)...)
	} else if originalTokenGroup != "" {
		fallbackGroups = append(fallbackGroups, originalTokenGroup)
	} else if originalUsingGroup != "" {
		fallbackGroups = append(fallbackGroups, originalUsingGroup)
	}
	orderedGroups := []string{selectedSource}
	seen := map[string]struct{}{selectedSource: {}}
	for _, group := range fallbackGroups {
		if !IsUserSelectableGroup(userGroup, group) {
			continue
		}
		if _, duplicate := seen[group]; duplicate {
			continue
		}
		seen[group] = struct{}{}
		orderedGroups = append(orderedGroups, group)
	}

	common.SetContextKey(c, constant.ContextKeyUsingGroup, "auto")
	common.SetContextKey(c, constant.ContextKeyTokenGroup, "auto")
	common.SetContextKey(c, constant.ContextKeyTokenAutoGroups, orderedGroups)
	common.SetContextKey(c, constant.ContextKeyTokenCrossGroupRetry, true)
	common.SetContextKey(c, constant.ContextKeyRoutingSourceGroupLimit, len(orderedGroups))
	return true
}
