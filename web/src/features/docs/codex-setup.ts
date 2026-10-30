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

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
export type CodexPlatform = 'windows' | 'unix'

export type SetupFile = {
  filename: string
  snippet: string
}

export type CodexSetup = {
  configPath: string
  authPath: string
  files: SetupFile[]
}

export function getCodexSetup(
  baseUrl: string,
  platform: CodexPlatform
): CodexSetup {
  const isWindows = platform === 'windows'
  const configPath = isWindows
    ? '%USERPROFILE%\\.codex\\config.toml'
    : '~/.codex/config.toml'
  const authPath = isWindows
    ? '%USERPROFILE%\\.codex\\auth.json'
    : '~/.codex/auth.json'
  const windowsConfig = isWindows
    ? '\nwindows_wsl_setup_acknowledged = true'
    : ''

  return {
    configPath,
    authPath,
    files: [
      {
        filename: configPath,
        snippet: `model_provider = "OpenAI"
model = "gpt-5.6-sol"
review_model = "gpt-5.5"
model_reasoning_effort = "xhigh"
disable_response_storage = true
network_access = "enabled"${windowsConfig}

[model_providers.OpenAI]
name = "OpenAI"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true

[features]
goals = true`,
      },
      {
        filename: authPath,
        snippet: `{
  "OPENAI_API_KEY": "sk-your-vl-api-key"
}`,
      },
    ],
  }
}
