// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/app/lib/db', () => ({ prisma: {} }))

import { HANDBOOK_LOADERS } from '@/content/handbook'
import { SUPPORTED_LOCALES } from '@/app/lib/i18n/locales'
import { extractAnchors, renderPlaceholders } from '@/app/lib/handbook'

const EMPTY = {
  discordUrl: '', eventsUrl: '', gppDate: '', gppEdition: '', hostCapUsd: '', budgetTemplateUrl: '',
  paymentFormUrl: '', hostPlaybookUrl: '', hashtags: '', hostDeadlines: '',
}
const FILLED = {
  discordUrl: 'https://discord.example.org/invite',
  eventsUrl: 'https://events.example.org',
  gppDate: 'DATE-FILLED',
  gppEdition: '9',
  hostCapUsd: 'CAP-FILLED',
  budgetTemplateUrl: 'https://sheet.example.org/budget',
  paymentFormUrl: 'https://forms.example.org/pay',
  hostPlaybookUrl: 'https://docs.example.org/playbook',
  hashtags: '#examplepizza',
  hostDeadlines: '- DEADLINE-ONE\n- DEADLINE-TWO',
}

describe.each(SUPPORTED_LOCALES)('host-a-party (%s)', (locale) => {
  it('with no facts set, hides every dependent sentence and section cleanly', async () => {
    const out = renderPlaceholders((await HANDBOOK_LOADERS['host-a-party'][locale]()).body, EMPTY)
    expect(out).not.toMatch(/\{\{|\}\}|::if|::end/)
    expect(out).not.toMatch(/\]\(\)/) // no link left with an empty destination
    expect(out).not.toContain('{#gpp}')
    expect(out).not.toContain('{#deadlines}')
    expect(out).not.toMatch(/undefined|NaN/)
    // The always-visible anchors survive.
    for (const a of ['before', 'budget', 'pizza-math', 'poaps', 'announce', 'day-of', 'after']) expect(out).toContain(`{#${a}}`)
  })

  it('with facts set, shows them (and only then)', async () => {
    const out = renderPlaceholders((await HANDBOOK_LOADERS['host-a-party'][locale]()).body, FILLED)
    for (const needle of [
      'CAP-FILLED', 'DATE-FILLED', '(https://sheet.example.org/budget)', '(https://forms.example.org/pay)',
      '(https://docs.example.org/playbook)', '(https://events.example.org)', '#examplepizza', 'DEADLINE-ONE', 'DEADLINE-TWO', '{#gpp}', '{#deadlines}',
    ]) {
      expect(out, needle).toContain(needle)
    }
    expect(out).not.toMatch(/\{\{|::if|::end/)
  })

  it('never states a number from config (cap, party date or deadlines) in its own text', async () => {
    const body = (await HANDBOOK_LOADERS['host-a-party'][locale]()).body
    expect(body).not.toMatch(/\$\s?\d|\d\s?(USD|dollars|dólares|dollars|US\$)/i)
    expect(body).not.toMatch(/\b20\d\d\b/)
  })

  it('states exactly one pizza-ordering rule (the budget template\'s)', async () => {
    const body = (await HANDBOOK_LOADERS['host-a-party'][locale]()).body
    const section = body.split('{#pizza-math}')[1].split(/\n## /)[0]
    expect(section).toMatch(/45/)
    expect(section.match(/\b\d+\b/g)).toEqual(['45'])
  })

  it('has the anchors the Drive pointers and missions rely on', async () => {
    const anchors = extractAnchors((await HANDBOOK_LOADERS['host-a-party'][locale]()).body)
    expect(anchors).toEqual(expect.arrayContaining(['after', 'poaps', 'budget', 'gpp']))
  })
})
