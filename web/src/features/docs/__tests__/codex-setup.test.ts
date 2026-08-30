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
import { describe, expect, it } from 'vitest'

import { getCodexSetup } from '../codex-setup'

describe('Codex setup guide', () => {
  it('uses the Responses provider, production base URL, and default model', () => {
    const setup = getCodexSetup('https://new-api.yozik.ru/v1', 'windows')

    expect(setup.files[0]?.snippet).toContain('model = "gpt-5.6-sol"')
    expect(setup.files[0]?.snippet).toContain(
      'base_url = "https://new-api.yozik.ru/v1"'
    )
    expect(setup.files[0]?.snippet).toContain('wire_api = "responses"')
    expect(setup.files[0]?.snippet).toContain('requires_openai_auth = true')
    expect(setup.files[0]?.snippet).not.toContain('env_key')
  })

  it('shows the correct Windows paths and acknowledgement', () => {
    const setup = getCodexSetup('https://new-api.yozik.ru/v1', 'windows')

    expect(setup.configPath).toBe('%USERPROFILE%\\.codex\\config.toml')
    expect(setup.authPath).toBe('%USERPROFILE%\\.codex\\auth.json')
    expect(setup.files[0]?.snippet).toContain(
      'windows_wsl_setup_acknowledged = true'
    )
  })

  it('uses home paths without Windows-only settings on macOS and Linux', () => {
    const setup = getCodexSetup('https://new-api.yozik.ru/v1', 'unix')

    expect(setup.configPath).toBe('~/.codex/config.toml')
    expect(setup.authPath).toBe('~/.codex/auth.json')
    expect(setup.files[0]?.snippet).not.toContain(
      'windows_wsl_setup_acknowledged'
    )
  })

  it('keeps the API key as a placeholder in auth.json', () => {
    const setup = getCodexSetup('https://new-api.yozik.ru/v1', 'windows')

    expect(setup.files[1]?.snippet).toBe(`{
  "OPENAI_API_KEY": "sk-your-vl-api-key"
}`)
  })
})
