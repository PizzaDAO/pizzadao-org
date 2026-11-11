// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { countedAttendees, DEFAULT_THRESHOLDS, measuredSeconds, type CountedRecording } from './attendance-from-recordings'
import { excludedFromSettings, parseExcludeIds } from './attendance-exclude'
import { SETTINGS, type SettingKey } from '@/app/lib/settings/registry'
import type { Settings } from '@/app/lib/settings'

const PERSON = '111111111111111111'
const BOT = '222222222222222222'

const settings = (value: string, readFailed = false): Settings => ({
  readFailed,
  invalidKeys: [],
  isSet: () => true,
  get: ((k: SettingKey) => (k === 'calls.attendanceExcludeIds' ? value : SETTINGS[k].default)) as Settings['get'],
})

describe('calls.attendanceExcludeIds', () => {
  it('defaults to empty', () => {
    expect(SETTINGS['calls.attendanceExcludeIds'].default).toBe('')
  })
  it('parses one id per line and skips junk', () => {
    expect([...parseExcludeIds(` ${BOT}\nnot-an-id\n\n${PERSON}\n${BOT}`)].sort()).toEqual([PERSON, BOT].sort())
  })
  it('excludes nobody when settings cannot be read', () => {
    expect(excludedFromSettings(settings(BOT, true)).size).toBe(0)
    expect(excludedFromSettings(settings(BOT)).has(BOT)).toBe(true)
  })
})

describe('attendance counting with excluded accounts', () => {
  const rec: CountedRecording = {
    source: 'DISCORD',
    durationSec: 3600,
    participantIds: [PERSON, BOT],
    speakers: [{ discordId: BOT, displayName: 'Radio', talkTimeSec: 600 }],
    presence: [
      { discordId: PERSON, presentSec: 1800 },
      { discordId: BOT, presentSec: 3600 },
    ],
  }
  it('leaves them out of the counted attendees and the minutes', () => {
    expect([...countedAttendees([rec], DEFAULT_THRESHOLDS).keys()].sort()).toEqual([PERSON, BOT].sort())
    expect([...countedAttendees([rec], DEFAULT_THRESHOLDS, new Set([BOT])).keys()]).toEqual([PERSON])
    expect([...measuredSeconds([rec], new Set([BOT])).keys()]).toEqual([PERSON])
  })
})
