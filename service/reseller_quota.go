/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/shopspring/decimal"
)

func isResellerBilling(relayInfo *relaycommon.RelayInfo) bool {
	return relayInfo != nil &&
		(relayInfo.BillingSource == BillingSourceReseller || model.IsResellerTokenKey(relayInfo.TokenKey))
}

func usesRawTokenQuota(relayInfo *relaycommon.RelayInfo) bool {
	return isResellerBilling(relayInfo) ||
		(relayInfo != nil && relayInfo.TokenQuotaMode == model.TokenQuotaModeTokens)
}

// tracksRawTokenQuota reports whether a raw-token key has a finite allocation
// that must be reserved and settled. Unlimited keys retain the historical
// money-quota semantics: they are still billed through the user's wallet or
// subscription, but no token-key balance is mutated.
func tracksRawTokenQuota(relayInfo *relaycommon.RelayInfo) bool {
	return usesRawTokenQuota(relayInfo) && relayInfo != nil && !relayInfo.TokenUnlimited
}

func resellerTokenQuota(parts ...int) (int, *common.QuotaClamp) {
	total := decimal.Zero
	for _, part := range parts {
		if part > 0 {
			total = total.Add(decimal.NewFromInt(int64(part)))
		}
	}
	return common.QuotaFromDecimalChecked(total)
}

func hasReportedTextTokenUsage(usage *dto.Usage) bool {
	if usage == nil {
		return false
	}
	return usage.PromptTokens > 0 || usage.CompletionTokens > 0 || usage.TotalTokens > 0 ||
		usage.InputTokens > 0 || usage.OutputTokens > 0 || usage.PromptCacheHitTokens > 0 ||
		usage.PromptTokensDetails.CachedTokens > 0 || usage.PromptTokensDetails.CacheCreationTokensTotal() > 0 ||
		(usage.InputTokensDetails != nil && (usage.InputTokensDetails.CachedTokens > 0 ||
			usage.InputTokensDetails.CacheCreationTokensTotal() > 0))
}

// authoritativeTextTokenQuota accepts only usage measured by the upstream.
// Local token counts and BillingUsage values explicitly marked as estimated
// are useful for monetary billing, but cannot release a finite raw-token
// reservation. A structured/source-tagged upstream usage remains authoritative
// even when every counter is zero, so a genuine zero can refund the hold.
func authoritativeTextTokenQuota(usage *dto.Usage, locallyCounted bool, fallbackPromptTokens int) (int, *common.QuotaClamp, bool) {
	if usage == nil || locallyCounted {
		return 0, nil, false
	}
	if usage.BillingUsage != nil && usage.BillingUsage.Estimated {
		return 0, nil, false
	}

	effectiveUsage := usage
	if normalizedUsage, ok := usageFromBillingUsage(usage); ok {
		effectiveUsage = normalizedUsage
	} else if !hasReportedTextTokenUsage(usage) && strings.TrimSpace(usage.UsageSource) == "" {
		return 0, nil, false
	}

	if !hasReportedTextTokenUsage(effectiveUsage) {
		// A source-tagged all-zero object is an explicit upstream report, not a
		// missing-usage fallback. Do not replace it with the prompt estimate.
		fallbackPromptTokens = 0
	}
	quota, clamp := resellerTextTokenQuota(effectiveUsage, fallbackPromptTokens)
	return quota, clamp, true
}

func hasReportedRealtimeTokenUsage(usage *dto.RealtimeUsage) bool {
	if usage == nil {
		return false
	}
	return usage.TotalTokens > 0 || usage.InputTokens > 0 || usage.OutputTokens > 0 ||
		usage.InputTokenDetails.CachedTokens > 0
}

// Every accepted reseller request is reserved against the complete prepaid
// allocation. Prompt estimation can be disabled or incomplete for embeddings,
// reranking, and provider-normalized generation requests, so an estimate is
// not a trustworthy hard cap. Settlement returns the unused portion.
func resellerNeedsFullBalanceReservation(relayInfo *relaycommon.RelayInfo) bool {
	return relayInfo != nil
}

// resellerTextTokenQuota charges input + output - cache-read tokens. Effective
// Anthropic usage exposes aggregate input separately from uncached prompt input.
func resellerTextTokenQuota(usage *dto.Usage, fallbackPromptTokens int) (int, *common.QuotaClamp) {
	if usage == nil {
		return resellerTokenQuota(fallbackPromptTokens)
	}

	outputTokens := usage.CompletionTokens
	if outputTokens == 0 && usage.OutputTokens > 0 {
		outputTokens = usage.OutputTokens
	}

	cacheReadTokens := usage.PromptTokensDetails.CachedTokens
	if usage.InputTokensDetails != nil && usage.InputTokensDetails.CachedTokens > cacheReadTokens {
		cacheReadTokens = usage.InputTokensDetails.CachedTokens
	}
	if usage.PromptCacheHitTokens > cacheReadTokens {
		cacheReadTokens = usage.PromptCacheHitTokens
	}

	if usage.UsageSemantic == dto.BillingUsageSemanticAnthropic && usage.InputTokens > 0 {
		inputTokens := usage.InputTokens - cacheReadTokens
		if inputTokens < 0 {
			inputTokens = 0
		}
		return resellerTokenQuota(inputTokens, outputTokens)
	}

	inputTokens := usage.PromptTokens
	if usage.UsageSemantic == dto.BillingUsageSemanticAnthropic {
		// In this legacy/fallback shape PromptTokens is already the uncached
		// portion. Cache reads stay free while cache creation remains billable.
		cacheWriteTokens := usage.PromptTokensDetails.CacheCreationTokensTotal()
		if usage.InputTokensDetails != nil {
			inputCacheWriteTokens := usage.InputTokensDetails.CacheCreationTokensTotal()
			if inputCacheWriteTokens > cacheWriteTokens {
				cacheWriteTokens = inputCacheWriteTokens
			}
		}
		return resellerTokenQuota(inputTokens, outputTokens, cacheWriteTokens)
	}

	if inputTokens == 0 && usage.InputTokens > 0 {
		inputTokens = usage.InputTokens
	}
	// Some embedding/rerank adapters only expose total_tokens.  Recover the
	// input portion from that total instead of silently charging zero.  If the
	// upstream omitted all usage fields, retain the local prompt estimate.
	if inputTokens == 0 && usage.TotalTokens > outputTokens {
		inputTokens = usage.TotalTokens - outputTokens
	}
	if inputTokens == 0 && fallbackPromptTokens > 0 && usage.TotalTokens == 0 {
		inputTokens = fallbackPromptTokens
	}
	if cacheReadTokens >= inputTokens {
		inputTokens = 0
	} else if cacheReadTokens > 0 {
		inputTokens -= cacheReadTokens
	}
	return resellerTokenQuota(inputTokens, outputTokens)
}

// OpenAI Realtime input_tokens includes cached_tokens, which are free for
// reseller allocations.
func resellerRealtimeTokenQuota(usage *dto.RealtimeUsage) (int, *common.QuotaClamp) {
	if usage == nil {
		return 0, nil
	}
	inputTokens := usage.InputTokens
	if inputTokens <= 0 && usage.TotalTokens > usage.OutputTokens {
		inputTokens = usage.TotalTokens - usage.OutputTokens
	}
	cacheReadTokens := usage.InputTokenDetails.CachedTokens
	if cacheReadTokens >= inputTokens {
		inputTokens = 0
	} else if cacheReadTokens > 0 {
		inputTokens -= cacheReadTokens
	}
	return resellerTokenQuota(inputTokens, usage.OutputTokens)
}
