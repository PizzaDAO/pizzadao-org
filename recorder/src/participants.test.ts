import { describe, expect, it } from 'vitest'
import { participantIds } from './manifest.js'

describe('participantIds', () => {
  it('merges present records, drops purged users, sorted and unique', () => {
    expect(
      participantIds([
        { t: 'present', userIds: ['3', '1'] },
        { t: 'present', userIds: ['1', '2'] },
        { t: 'purge', userId: '2' },
      ]),
    ).toEqual(['1', '3'])
  })
  it('is empty with no present records', () => {
    expect(participantIds([])).toEqual([])
  })
})
