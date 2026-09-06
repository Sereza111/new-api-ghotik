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
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

const { createInstance } = await import('i18next')
const { I18nextProvider, initReactI18next } = await import('react-i18next')
const { QueryClient, QueryClientProvider } =
  await import('@tanstack/react-query')
const { api } = await import('@/lib/api')
const { ApiKeysProvider } = await import('../api-keys-provider')
const { ApiKeysMutateDrawer } = await import('../api-keys-mutate-drawer')
const { apiKeySchema } = await import('../../types')

const i18n = createInstance()
await i18n.use(initReactI18next).init({
  lng: 'en',
  resources: { en: { translation: {} } },
})

type ApiMethod = (url: string, data?: unknown) => Promise<{ data: unknown }>
type MockableApi = {
  get: ApiMethod
  post: ApiMethod
  put: ApiMethod
}
type RenderedDrawer = {
  queryClient: InstanceType<typeof QueryClient>
}

const apiClient = api as unknown as MockableApi
const originalGet = apiClient.get
const originalPost = apiClient.post
const originalPut = apiClient.put
let renderedDrawer: RenderedDrawer | null = null

const tokenModeApiKey = apiKeySchema.parse({
  id: 42,
  name: 'token-mode key',
  key: 'masked',
  status: 1,
  remain_quota: 1_000_000,
  used_quota: 0,
  quota_mode: 'tokens',
  unlimited_quota: false,
  expired_time: -1,
  created_time: 1,
  accessed_time: 0,
  group: 'default',
  auto_groups: null,
  cross_group_retry: false,
  model_limits_enabled: false,
  model_limits: '',
  allow_ips: '',
})

const resellerTokenApiKey = apiKeySchema.parse({
  ...tokenModeApiKey,
  id: 43,
  name: 'reseller token key',
  remain_quota: 8_000_000,
  used_quota: 2_000_000,
  is_reseller: true,
  reseller_base_cost_per_million: 0.12,
})

function installApiFixtures(createdPayloads: Array<Record<string, unknown>>) {
  apiClient.get = async (url) => {
    switch (url) {
      case '/api/status':
        return { data: { data: { default_use_auto_group: true } } }
      case '/api/user/models':
        return { data: { success: true, data: [] } }
      case '/api/user/self/groups':
        return {
          data: {
            success: true,
            data: {
              auto: { desc: 'Automatic routing', ratio: 'auto' },
              default: { desc: 'Standard access', ratio: 1 },
              vip: { desc: 'Priority access', ratio: 2 },
            },
          },
        }
      case '/api/token/auto-groups':
        return {
          data: {
            success: true,
            data: { groups: ['vip', 'default'], max_count: 3 },
          },
        }
      case `/api/token/${tokenModeApiKey.id}`:
        return { data: { success: true, data: tokenModeApiKey } }
      case `/api/token/${resellerTokenApiKey.id}`:
        return { data: { success: true, data: resellerTokenApiKey } }
      default:
        throw new Error(`Unexpected GET ${url}`)
    }
  }
  apiClient.post = async (url, data) => {
    expect(url).toBe('/api/token/')
    expect(data && typeof data === 'object').toBeTruthy()
    createdPayloads.push(data as Record<string, unknown>)
    return { data: { success: true, data: {} } }
  }
}

async function renderDrawer(
  currentRow?: typeof tokenModeApiKey
): Promise<void> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const freshAt = Date.now() + 60_000
  queryClient.setQueryData(
    ['status'],
    { default_use_auto_group: true },
    { updatedAt: freshAt }
  )
  if (currentRow) {
    queryClient.setQueryData(
      ['api-key', currentRow.id],
      { success: true, data: currentRow },
      { updatedAt: freshAt }
    )
  }
  queryClient.setQueryData(
    ['user-models'],
    { success: true, data: [] },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['user-groups'],
    {
      success: true,
      data: {
        auto: { desc: 'Automatic routing', ratio: 'auto' },
        default: { desc: 'Standard access', ratio: 1 },
        vip: { desc: 'Priority access', ratio: 2 },
      },
    },
    { updatedAt: freshAt }
  )
  queryClient.setQueryData(
    ['token-auto-groups'],
    {
      success: true,
      data: { groups: ['vip', 'default'], max_count: 3 },
    },
    { updatedAt: freshAt }
  )
  renderedDrawer = { queryClient }

  render(
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <ApiKeysProvider>
          <ApiKeysMutateDrawer
            open
            onOpenChange={() => undefined}
            currentRow={currentRow}
          />
        </ApiKeysProvider>
      </I18nextProvider>
    </QueryClientProvider>
  )
  await waitFor(
    () => {
      const saveButton = findButton('Save changes', false)
      expect(saveButton).toBeEnabled()
    },
    { timeout: 1500 }
  )
}

function findButton(text: string, required: true): HTMLButtonElement
function findButton(text: string, required: false): HTMLButtonElement | null
function findButton(text: string, required = true): HTMLButtonElement | null {
  const button = screen
    .queryAllByRole<HTMLButtonElement>('button')
    .find((candidate) => candidate.textContent?.includes(text))
  if (required && !button) {
    throw new Error(`Expected button containing "${text}"`)
  }
  return button ?? null
}

function getControlByLabel(
  labelText:
    | 'Name'
    | 'Quantity'
    | 'Quota (Million tokens)'
    | 'Total quota (million tokens)'
): HTMLInputElement
function getControlByLabel(labelText: 'Group'): HTMLButtonElement
function getControlByLabel(labelText: 'Auto group order'): HTMLElement
function getControlByLabel(labelText: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText
  )
  if (!label) {
    throw new Error(`Expected label "${labelText}"`)
  }

  const control =
    label.control ??
    label
      .closest('[data-slot="form-item"]')
      ?.querySelector<HTMLElement>(
        '[data-slot="form-control"], input, textarea, button[role="combobox"], [role="group"]'
      )
  if (!control) {
    throw new Error(`Expected control for label "${labelText}"`)
  }
  return control
}

function changeInput(input: HTMLInputElement, value: string): void {
  fireEvent.input(input, { target: { value } })
}

function getSwitchByLabel(labelText: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLLabelElement>('label')].find(
    (candidate) => candidate.textContent?.trim() === labelText
  )
  const control = label
    ?.closest('[data-slot="form-item"]')
    ?.querySelector<HTMLElement>('[role="switch"]')
  if (!control) {
    throw new Error(`Expected switch for label "${labelText}"`)
  }
  return control
}

function selectComboboxOption(
  trigger: HTMLButtonElement,
  optionDescription: string
): void {
  fireEvent.click(trigger)
  const option = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="command-item"]'),
  ].find((candidate) => candidate.textContent?.includes(optionDescription))
  if (!option) {
    throw new Error(`Expected option containing "${optionDescription}"`)
  }
  fireEvent.click(option)
}

afterEach(() => {
  apiClient.get = originalGet
  apiClient.post = originalPost
  apiClient.put = originalPut
  localStorage.clear()
  if (renderedDrawer) {
    renderedDrawer.queryClient.clear()
    renderedDrawer = null
  }
})

describe('API keys mutate drawer Auto group integration', () => {
  test('inherits the root Auto order and sends an empty override for every batch-created key', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    const groupTrigger = getControlByLabel('Group')
    expect(groupTrigger.textContent?.includes('auto')).toBe(true)
    expect(
      document.body.textContent?.includes(
        'Using the complete global Auto order (2 groups)'
      )
    ).toBe(true)
    expect(
      [
        ...document.querySelectorAll('[data-slot="global-auto-order-name"]'),
      ].map((item) => item.textContent)
    ).toEqual(['vip', 'default'])
    expect(findButton('Restore global Auto', true).disabled).toBe(true)

    changeInput(getControlByLabel('Name'), 'batch')
    changeInput(getControlByLabel('Quantity'), '2')
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(2))

    expect(createdPayloads.length).toBe(2)
    expect(createdPayloads[0]?.name).toBe('batch')
    for (const payload of createdPayloads) {
      expect(payload.group).toBe('auto')
      expect(payload.auto_groups).toEqual([])
      expect(payload.cross_group_retry).toBe(true)
    }
  })

  test('preserves an unsaved custom order and mode after Auto to ordinary to Auto changes', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    const autoOrderControl = getControlByLabel('Auto group order')
    const addGroupTrigger = autoOrderControl.querySelector<HTMLButtonElement>(
      'button[role="combobox"]'
    )
    if (!addGroupTrigger) {
      throw new Error('Expected Auto group order combobox')
    }
    selectComboboxOption(addGroupTrigger, 'Priority access')

    expect(
      document.querySelector('button[aria-label="Remove vip"]')
    ).toBeTruthy()
    expect(document.body.textContent?.includes('1 / 3 groups selected')).toBe(
      true
    )
    expect(findButton('Restore global Auto', true).disabled).toBe(false)

    const groupTrigger = getControlByLabel('Group')
    selectComboboxOption(groupTrigger, 'Standard access')
    expect(document.querySelector('button[aria-label="Remove vip"]')).toBe(null)
    selectComboboxOption(groupTrigger, 'Automatic routing')

    expect(
      document.querySelector('button[aria-label="Remove vip"]')
    ).toBeTruthy()
    expect(document.body.textContent?.includes('1 / 3 groups selected')).toBe(
      true
    )
    expect(findButton('Restore global Auto', true).disabled).toBe(false)

    changeInput(getControlByLabel('Name'), 'custom')
    fireEvent.click(findButton('Save changes', true))
    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.auto_groups).toEqual(['vip'])
  })
})

describe('API keys mutate drawer quota mode', () => {
  test('submits an entered million-token quota as raw tokens', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer()

    changeInput(getControlByLabel('Name'), 'token-limited')
    fireEvent.click(getSwitchByLabel('Unlimited Quota'))
    fireEvent.click(screen.getByRole('button', { name: 'Million tokens' }))

    const quotaInput = getControlByLabel(
      'Quota (Million tokens)'
    ) as HTMLInputElement
    changeInput(quotaInput, '1.25')
    fireEvent.click(findButton('Save changes', true))

    await waitFor(() => expect(createdPayloads).toHaveLength(1))
    expect(createdPayloads[0]?.quota_mode).toBe('tokens')
    expect(createdPayloads[0]?.remain_quota).toBe(1_250_000)
    expect(createdPayloads[0]?.unlimited_quota).toBe(false)
  })

  test('keeps quota mode immutable while editing an existing key', async () => {
    const createdPayloads: Array<Record<string, unknown>> = []
    installApiFixtures(createdPayloads)
    await renderDrawer(tokenModeApiKey)

    expect(
      screen.getByRole('button', { name: 'Million tokens' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: /Billing currency/ })
    ).toBeDisabled()
    expect(getControlByLabel('Quota (Million tokens)')).toHaveValue(1)
    expect(getControlByLabel('Quota (Million tokens)')).toBeDisabled()
    expect(getSwitchByLabel('Unlimited Quota')).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  test('updates reseller metadata and its changed total quota separately', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    const quotaPayloads: Array<Record<string, unknown>> = []
    installApiFixtures([])
    apiClient.put = async (url, data) => {
      expect(url).toBe('/api/token/')
      updatedPayloads.push(data as Record<string, unknown>)
      return { data: { success: true, data: resellerTokenApiKey } }
    }
    apiClient.post = async (url, data) => {
      expect(url).toBe(`/api/reseller/keys/${resellerTokenApiKey.id}/quota`)
      quotaPayloads.push(data as Record<string, unknown>)
      return { data: { success: true } }
    }
    await renderDrawer(resellerTokenApiKey)

    const totalQuotaInput = getControlByLabel(
      'Total quota (million tokens)'
    ) as HTMLInputElement
    expect(totalQuotaInput).toHaveValue(10)
    expect(totalQuotaInput).toBeEnabled()
    expect(totalQuotaInput).toHaveAttribute('min', '2')
    expect(totalQuotaInput).toHaveAttribute('max', '1000')
    expect(totalQuotaInput).toHaveAttribute('step', '1')
    expect(document.body).toHaveTextContent(
      'Increasing it charges your balance; decreasing it does not refund funds.'
    )
    expect(getSwitchByLabel('Unlimited Quota')).toHaveAttribute(
      'aria-disabled',
      'true'
    )

    changeInput(getControlByLabel('Name'), 'renamed reseller key')
    changeInput(totalQuotaInput, '12')
    fireEvent.click(findButton('Save changes', true))

    expect(updatedPayloads).toHaveLength(0)
    expect(await screen.findByText('Confirm paid quota increase')).toBeVisible()
    expect(screen.getByText('2M')).toBeVisible()
    expect(screen.getByText('$0.24')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm purchase' }))

    await waitFor(() => expect(updatedPayloads).toHaveLength(1))
    await waitFor(() => expect(quotaPayloads).toHaveLength(1))
    expect(updatedPayloads[0]?.name).toBe('renamed reseller key')
    expect(quotaPayloads[0]).toEqual({
      mode: 'set',
      token_millions: 12,
      expected_total_millions: 10,
      request_id: expect.any(String),
    })
  })

  test('preserves and disables an established reseller group that is no longer selectable', async () => {
    const unavailableGroupKey = apiKeySchema.parse({
      ...resellerTokenApiKey,
      group: 'archived-reseller',
    })
    const updatedPayloads: Array<Record<string, unknown>> = []
    installApiFixtures([])
    const fixtureGet = apiClient.get
    apiClient.get = async (url, data) => {
      if (url === `/api/token/${unavailableGroupKey.id}`) {
        return { data: { success: true, data: unavailableGroupKey } }
      }
      return fixtureGet(url, data)
    }
    apiClient.put = async (_url, data) => {
      updatedPayloads.push(data as Record<string, unknown>)
      return { data: { success: true, data: unavailableGroupKey } }
    }
    await renderDrawer(unavailableGroupKey)

    const groupTrigger = getControlByLabel('Group')
    expect(groupTrigger).toBeDisabled()
    expect(groupTrigger).toHaveTextContent('archived-reseller')

    changeInput(getControlByLabel('Name'), 'metadata only')
    fireEvent.click(findButton('Save changes', true))

    await waitFor(() => expect(updatedPayloads).toHaveLength(1))
    expect(updatedPayloads[0]?.group).toBe('archived-reseller')
  })

  test('does not call the reseller quota endpoint when total quota is unchanged', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []
    const quotaPayloads: Array<Record<string, unknown>> = []
    installApiFixtures([])
    apiClient.put = async (_url, data) => {
      updatedPayloads.push(data as Record<string, unknown>)
      return { data: { success: true, data: resellerTokenApiKey } }
    }
    apiClient.post = async (_url, data) => {
      quotaPayloads.push(data as Record<string, unknown>)
      return { data: { success: true } }
    }
    await renderDrawer(resellerTokenApiKey)

    changeInput(getControlByLabel('Name'), 'metadata only')
    fireEvent.click(findButton('Save changes', true))

    await waitFor(() => expect(updatedPayloads).toHaveLength(1))
    expect(quotaPayloads).toHaveLength(0)
  })

  test('reuses the reseller quota request id when the same total is retried', async () => {
    const quotaPayloads: Array<Record<string, unknown>> = []
    let detailFetches = 0
    installApiFixtures([])
    const fixtureGet = apiClient.get
    apiClient.get = async (url, data) => {
      if (url === `/api/token/${resellerTokenApiKey.id}`) detailFetches++
      return fixtureGet(url, data)
    }
    apiClient.put = async () => ({ data: { success: true } })
    apiClient.post = async (_url, data) => {
      quotaPayloads.push(data as Record<string, unknown>)
      return {
        data:
          quotaPayloads.length === 1
            ? { success: false, message: 'temporary failure' }
            : { success: true },
      }
    }
    await renderDrawer(resellerTokenApiKey)
    const detailFetchesBeforeFailure = detailFetches

    changeInput(getControlByLabel('Total quota (million tokens)'), '12')
    fireEvent.click(findButton('Save changes', true))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm purchase' })
    )
    await waitFor(() => expect(quotaPayloads).toHaveLength(1))
    await waitFor(() =>
      expect(detailFetches).toBeGreaterThan(detailFetchesBeforeFailure)
    )
    await waitFor(() => expect(findButton('Save changes', true)).toBeEnabled())
    fireEvent.click(findButton('Save changes', true))
    fireEvent.click(
      await screen.findByRole('button', { name: 'Confirm purchase' })
    )
    await waitFor(() => expect(quotaPayloads).toHaveLength(2))

    expect(quotaPayloads[1]?.request_id).toBe(quotaPayloads[0]?.request_id)
    expect(quotaPayloads[1]?.expected_total_millions).toBe(10)
  })
})
