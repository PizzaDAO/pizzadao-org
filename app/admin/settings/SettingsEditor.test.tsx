import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { SettingsEditor, type SettingsLabels } from './SettingsEditor'

const labels = new Proxy({}, { get: (_t, k) => String(k) }) as unknown as SettingsLabels

const view = (over: Record<string, unknown> = {}) => ({
  key: 'disavow.enabled', area: 'disavow', areaLabel: 'Disavow list', label: 'Disavow list switch', help: 'h',
  input: { type: 'bool' }, stricterOnly: false, default: false, value: true, override: null, modified: false, invalid: false,
  updatedAt: null, updatedBy: null,
  toggle: { env: 'DISAVOW_ENABLED', envKill: false, envOn: true, effective: true },
  ...over,
})

let calls: Array<{ method: string; body: unknown }>
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method !== 'GET') calls.push({ method, body: JSON.parse(String(init?.body)) })
    return new Response(JSON.stringify(method === 'GET' ? { settings: [view()], changes: [], nonProduction: false } : { ok: true }), { status: 200 })
  }))
})

describe('SettingsEditor switch', () => {
  it('env on and no saved row: the box starts ticked and Save is disabled; unticking enables Save and sends false', async () => {
    render(<SettingsEditor labels={labels} />)
    const box = (await screen.findByRole('checkbox', { name: 'Disavow list switch' })) as HTMLInputElement
    expect(box.checked).toBe(true)
    const save = screen.getByRole('button', { name: 'save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.click(box)
    expect(box.checked).toBe(false)
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { key: 'disavow.enabled', value: false } })
  })
})
