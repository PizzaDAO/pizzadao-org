import { describe, expect, it } from 'vitest'
import { crewDiscordUrl } from './crew-discord-link'

const channels = [
  { id: '111111', name: 'education', type: 0 },
  { id: '222222', name: 'education-call', type: 2 },
  { id: '333333', name: 'category', type: 4 },
]

describe('crewDiscordUrl', () => {
  it('returns null for an empty cell', () => {
    expect(crewDiscordUrl('', '999999', channels)).toBeNull()
    expect(crewDiscordUrl(undefined, '999999', channels)).toBeNull()
  })
  it('keeps a link into our guild and rejects one into another guild', () => {
    expect(crewDiscordUrl('https://discord.com/channels/999999/111111', '999999')).toBe('https://discord.com/channels/999999/111111')
    expect(crewDiscordUrl('https://discord.com/channels/888888/111111', '999999')).toBeNull()
  })
  it('builds a link from a bare id or a mention', () => {
    expect(crewDiscordUrl('111111', '999999')).toBe('https://discord.com/channels/999999/111111')
    expect(crewDiscordUrl('<#111111>', '999999')).toBe('https://discord.com/channels/999999/111111')
  })
  it('resolves a channel name (with or without #) and ignores non-linkable types', () => {
    expect(crewDiscordUrl('#education', '999999', channels)).toBe('https://discord.com/channels/999999/111111')
    expect(crewDiscordUrl('Education Call', '999999', channels)).toBe('https://discord.com/channels/999999/222222')
    expect(crewDiscordUrl('category', '999999', channels)).toBeNull()
  })
  it('returns null without a guild id or channel list', () => {
    expect(crewDiscordUrl('111111', '')).toBeNull()
    expect(crewDiscordUrl('https://discord.com/channels/999999/111111', '')).toBeNull()
    expect(crewDiscordUrl('education', '999999', null)).toBeNull()
  })
})
