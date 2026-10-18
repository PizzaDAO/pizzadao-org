/**
 * The bot shows "PizzaDAO Bot 🔴 REC" as its server nickname while recording.
 * The previous nickname is saved to disk first, so even a crash mid-call is
 * undone on the next boot.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Guild } from 'discord.js'
import { REC_NICKNAME } from './config.js'

interface Saved {
  guildId: string
  nickname: string | null
}

export class NicknameManager {
  private readonly file: string

  constructor(
    dataDir: string,
    private readonly log: (msg: string) => void,
  ) {
    this.file = path.join(dataDir, 'nickname-restore.json')
  }

  /** Set the REC nickname. Returns whether it worked (missing Change Nickname returns false). */
  async acquire(guild: Guild): Promise<boolean> {
    try {
      const me = await guild.members.fetchMe()
      // Never overwrite the saved original with our own REC name (e.g. after a switch).
      if (!existsSync(this.file)) {
        const saved: Saved = { guildId: guild.id, nickname: me.nickname === REC_NICKNAME ? null : me.nickname }
        writeFileSync(this.file, JSON.stringify(saved))
      }
      await me.setNickname(REC_NICKNAME, 'Recording the call')
      return true
    } catch (err) {
      this.log(`could not set nickname: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** Restore the nickname saved by acquire(). */
  async release(guild: Guild): Promise<void> {
    if (!existsSync(this.file)) return
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8')) as Saved
      const me = await guild.members.fetchMe()
      await me.setNickname(saved.nickname, 'Call recording ended')
      rmSync(this.file, { force: true })
    } catch (err) {
      this.log(`could not restore nickname: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** On boot with no recording running: undo a nickname a crash left behind. */
  recoverOnBoot(guild: Guild): Promise<void> {
    return this.release(guild)
  }
}
