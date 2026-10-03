import { describe, it, expect } from 'vitest'
import { levelUpToCelebrate } from './level-up'

const LEVELS = [
  { level: 1, title: 'Pizza Trainee', reward: 69 },
  { level: 2, title: 'Pizza Noob', reward: 420 },
  { level: 3, title: null, reward: 1337 },
  { level: 4, title: null, reward: 3141 },
]
const snap = (currentLevel: number, levelTitle: string | null = null) => ({ levels: LEVELS, currentLevel, levelTitle })

describe('levelUpToCelebrate', () => {
  it('nothing before the first level is complete', () => {
    expect(levelUpToCelebrate(snap(1), 0)).toBeNull()
  })

  it('nothing once the current level has been celebrated', () => {
    expect(levelUpToCelebrate(snap(3), 3)).toBeNull()
    expect(levelUpToCelebrate(snap(3), 5)).toBeNull()
  })

  it('a level-up approved while away: the level reached, with the reward that level paid', () => {
    expect(levelUpToCelebrate(snap(3), 2)).toEqual({ level: 3, levelTitle: null, reward: 420, isFinal: false })
  })

  it('several uncelebrated levels fold into one modal with the summed reward', () => {
    expect(levelUpToCelebrate(snap(4), 2)).toEqual({ level: 4, levelTitle: null, reward: 420 + 1337, isFinal: true })
    // never celebrated anything: every completed level counts
    expect(levelUpToCelebrate(snap(3, 'x'), 0)).toEqual({ level: 3, levelTitle: 'x', reward: 69 + 420, isFinal: false })
  })

  it('the final level comes from the data, not a hard-coded 8', () => {
    expect(levelUpToCelebrate(snap(5), 4)?.isFinal).toBe(true) // all 4 done
    expect(levelUpToCelebrate(snap(2), 1)).toMatchObject({ level: 2, levelTitle: 'Pizza Noob', reward: 69, isFinal: false })
  })
})
