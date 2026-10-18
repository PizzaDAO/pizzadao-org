/**
 * The bot shows "PizzaDAO Bot 🔴 REC" as its server nickname while recording.
 * The previous nickname is saved to disk first and the file is only deleted
 * after a successful restore, so even a crash (or failed restore) mid-call is
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

const RESTORE_ATTEMPTS = 4
const REC_MARK = '🔴 REC'

export class NicknameManager {
  private readonly file: string

  constructor(
    dataDir: string,
    private readonly log: (msg: string) => void,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.file = path.join(dataDir, 'nickname-restore.json')
  }

  /** Set the REC nickname. Returns whether it worked (missing Change Nickname returns false). */
  async acquire(guild: Guild): Promise<boolean> {
    try {
      const me = await guild.members.fetchMe()
      // Never overwrite the saved original with our own REC name (e.g. after a switch or failed restore).
      if (!existsSync(this.file)) {
        const saved: Saved = { guildId: guild.id, nickname: me.nickname?.includes(REC_MARK) ? null : me.nickname }
        writeFileSync(this.file, JSON.stringify(saved))
      }
      await me.setNickname(REC_NICKNAME, 'Recording the call')
      return true
    } catch (err) {
      this.log(`could not set nickname: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** Restore the saved nickname, retrying with backoff. Never throws. Returns whether it is restored. */
  async release(guild: Guild): Promise<boolean> {
    if (!existsSync(this.file)) return true
    let saved: Saved
    try {
      saved = JSON.parse(readFileSync(this.file, 'utf8')) as Saved
    } catch {
      saved = { guildId: guild.id, nickname: null }
    }
    for (let attempt = 1; attempt <= RESTORE_ATTEMPTS; attempt++) {
      try {
        const me = await guild.members.fetchMe()
        await me.setNickname(saved.nickname, 'Call recording ended')
        rmSync(this.file, { force: true })
        return true
      } catch (err) {
        this.log(`could not restore nickname (attempt ${attempt}/${RESTORE_ATTEMPTS}): ${err instanceof Error ? err.message : String(err)}`)
        if (attempt < RESTORE_ATTEMPTS) await this.sleep(500 * 4 ** (attempt - 1))
      }
    }
    // The saved file stays on the volume; the next boot tries again.
    return false
  }

  /**
   * On boot with no recording running: undo a nickname a crash left behind. If the
   * saved previous nickname is gone but the bot is still called "... 🔴 REC", reset it.
   */
  async recoverOnBoot(guild: Guild): Promise<void> {
    if (existsSync(this.file)) {
      await this.release(guild)
      return
    }
    try {
      const me = await guild.members.fetchMe()
      if (me.nickname?.includes(REC_MARK)) {
        this.log('bot nickname still says REC with no recording running; resetting it')
        await me.setNickname(null, 'No call is being recorded')
      }
    } catch (err) {
      this.log(`could not check the bot nickname: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
