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

describe('SettingsEditor role income table', () => {
  const rows = [
    { name: 'Crew Member', amount: 42, intervalHours: 24 },
    { name: 'Box Mafia', amount: 42, intervalHours: 24 },
  ]
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'GET') calls.push({ method, body: JSON.parse(String(init?.body)) })
      const income = view({ key: 'economy.roleIncome', area: 'economy', areaLabel: 'Economy', label: 'Role income table', input: { type: 'roleIncome' }, stricterOnly: true, default: rows, value: rows, toggle: undefined })
      return new Response(JSON.stringify(method === 'GET' ? { settings: [income], changes: [], nonProduction: false } : { ok: true }), { status: 200 })
    }))
  })

  it('lowering an amount and removing a row sends the edited table', async () => {
    render(<SettingsEditor labels={labels} />)
    const amount = (await screen.findByRole('spinbutton', { name: 'Crew Member incomeAmount' })) as HTMLInputElement
    const save = screen.getByRole('button', { name: 'save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(amount, { target: { value: '30' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'incomeRemove' })[1])
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { key: 'economy.roleIncome', value: [{ name: 'Crew Member', amount: 30, intervalHours: 24 }] } })
  })
})

describe('SettingsEditor phase 5 inputs', () => {
  function serve(settings: unknown[]) {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'GET') calls.push({ method, body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify(method === 'GET' ? { settings, changes: [], nonProduction: false } : { ok: true }), { status: 200 })
    }))
  }

  it('a saved role income table that is not in force shows the warning', async () => {
    serve([view({ key: 'economy.roleIncome', input: { type: 'roleIncome' }, toggle: undefined, default: [], value: [], invalid: true, modified: true, warning: 'The saved role income table is NOT in force.' })])
    render(<SettingsEditor labels={labels} />)
    expect(await screen.findByText(/NOT in force/)).toBeTruthy()
  })

  it('a private text setting starts empty (the value is never sent) and saves what is typed', async () => {
    serve([view({ key: 'calls.summaryPromptExtra', input: { type: 'text', maxLength: 2000, multiline: true }, toggle: undefined, private: true, default: 'not set', value: 'set', override: 'set', modified: true, updatedAt: '2026-11-01T00:00:00Z', updatedBy: 'x' })])
    render(<SettingsEditor labels={labels} />)
    await screen.findByText('Disavow list switch')
    const box = document.querySelector('textarea') as HTMLTextAreaElement
    expect(box.value).toBe('')
    const save = screen.getByRole('button', { name: 'save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'new text' } })
    expect(save.disabled).toBe(false)
    fireEvent.click(save)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { key: 'calls.summaryPromptExtra', value: 'new text' } })
  })

  it('a managed setting links to its page and offers no save or reset', async () => {
    serve([view({ key: 'calls.postFilter', input: { type: 'managed', href: '/admin/calls' }, toggle: undefined, private: true, default: 'not set', value: 'set', override: 'set', modified: true })])
    render(<SettingsEditor labels={labels} />)
    const link = (await screen.findByText('editedElsewhere')) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/admin/calls')
    expect(screen.queryByRole('button', { name: 'save' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'reset' })).toBeNull()
  })

  it('a string list is edited one per line and sent as a list', async () => {
    serve([view({ key: 'work.prompts', input: { type: 'stringList', maxItems: 20, maxLength: 500 }, toggle: undefined, default: ['a {amount}'], value: ['a {amount}', 'b {amount}'] })])
    render(<SettingsEditor labels={labels} />)
    const box = (await screen.findByLabelText('Disavow list switch')) as HTMLTextAreaElement
    expect(box.value).toBe('a {amount}\nb {amount}')
    fireEvent.change(box, { target: { value: 'c {amount}\n\nd {amount}' } })
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { key: 'work.prompts', value: ['c {amount}', 'd {amount}'] } })
  })

  it('a table with fixed rows edits the numbers and sends every row', async () => {
    const input = { type: 'table', columns: [{ key: 'id', label: 'Source', kind: 'text', fixed: true }, { key: 'points', label: 'Points', kind: 'int', min: 0, max: 1000000 }], maxRows: 2, fixedRows: true }
    serve([view({ key: 'mafia.sourcePoints', input, toggle: undefined, default: [], value: [{ id: 'a', points: 5 }, { id: 'b', points: 6 }] })])
    render(<SettingsEditor labels={labels} />)
    const pts = (await screen.findByLabelText('a Points')) as HTMLInputElement
    fireEvent.change(pts, { target: { value: '9' } })
    expect(screen.queryByText('addRow')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'save' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { key: 'mafia.sourcePoints', value: [{ id: 'a', points: 9 }, { id: 'b', points: 6 }] } })
  })
})
