/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.
*/
package constant

const CodexMaxOutputTokens = 128_000

var codexModelNames = [...]string{
	"gpt-6-astra",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"gpt-5.5",
	"gpt-5.4",
	"gpt-5.4-mini",
	"gpt-5.3-codex-spark",
	"codex-auto-review",
}

func CodexModelNames() []string {
	models := make([]string, len(codexModelNames))
	copy(models, codexModelNames[:])
	return models
}

// CodexModelOutputTokenLimit returns a trusted upstream-enforced ceiling.
// Unknown models must fail closed because the Codex adaptor cannot forward a
// client max_output_tokens value.
func CodexModelOutputTokenLimit(model string) (int, bool) {
	for _, supported := range codexModelNames {
		if model == supported {
			return CodexMaxOutputTokens, true
		}
	}
	return 0, false
}
