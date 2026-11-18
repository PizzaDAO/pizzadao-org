import { describe, it, expect } from 'vitest'
import { buildPublicProfile } from './public-profile'

const build = (row: Record<string, string>) => {
  const headers = Object.keys(row)
  const vals = Object.values(row)
  return buildPublicProfile(headers, (i) => vals[i])
}

describe('buildPublicProfile', () => {
  it('never exposes sensitive or unknown columns', () => {
    const out = build({
      Name: 'A', 'Wallet Address': '0x1', 'ETH Address': '0x2', 'Discord ID': '1', Email: 'a@b.c',
      Phone: '555', 'Telegram Handle': 't', 'Brand New Column': 'x',
    })
    expect(Object.keys(out)).toEqual(['Name'])
  })
  it('keeps the fields clients use', () => {
    const out = build({ Name: 'A', Crews: 'x, y', City: 'NYC', Orgs: 'o', Skills: 's', Turtles: 'l', Region: 'r', Notes: 'n', Status: 'ok' })
    expect(Object.keys(out).sort()).toEqual(['City', 'Crews', 'Name', 'Notes', 'Orgs', 'Region', 'Skills', 'Status', 'Turtles'])
  })
  it('folds alias columns into the public field without exposing them', () => {
    const out = build({ Frequency: 'weekly', Affiliation: 'o', Specialties: 's' })
    expect(out).toEqual({ Status: 'weekly', Orgs: 'o', Skills: 's' })
  })
  it('matches headers case-insensitively', () => {
    expect(build({ name: 'A', CREWS: 'x' })).toEqual({ Name: 'A', Crews: 'x' })
  })
})
