import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('Telegram is login-only in the app', () => {
  it('the Login Widget does not request write access', () => {
    expect(read('app/ui/telegram/TelegramLinker.tsx')).not.toMatch(/script\.setAttribute\("data-request-access"/)
  })
  it('the old rsv bot webhook route, its handlers and the set-webhook script are gone', () => {
    for (const p of ['app/api/telegram/webhook/route.ts', 'app/lib/followups/telegram-updates.ts', 'app/lib/followups/webhook-auth.ts', 'scripts/telegram-set-webhook.mjs']) {
      expect(existsSync(join(root, p)), p).toBe(false)
    }
  })
  it('the old shared env names are no longer read by the app', () => {
    for (const p of ['app/lib/telegram-auth.ts', 'app/api/telegram/account/route.ts', 'app/lib/telegram/rsv-client.ts', 'app/lib/telegram/reach.ts']) {
      expect(read(p), p).not.toMatch(/process\.env\.TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_USERNAME|TELEGRAM_WEBHOOK_SECRET/)
    }
  })
  it('scripts/telegram-login-webhook.mjs is the only setWebhook caller, and only for the login bot', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(rel)
      }
    }
    walk('app')
    walk('scripts')
    const callers = files.filter((f) => /setWebhook/.test(read(f)))
    expect(callers).toEqual(['scripts/telegram-login-webhook.mjs'])
    const script = read('scripts/telegram-login-webhook.mjs')
    expect(script).toContain('TELEGRAM_LOGIN_BOT_TOKEN')
    // The sender bot's username is read only to refuse it; its token and the rsv settings never appear.
    expect(script).not.toMatch(/RSV|(?<!LOGIN_)TELEGRAM_BOT_TOKEN/)
    expect(script.match(/TELEGRAM_SENDER\w*/g)).toEqual(['TELEGRAM_SENDER_BOT_USERNAME'])
    expect(existsSync(join(root, 'app/api/telegram/login-bot/webhook/route.ts'))).toBe(true)
  })
})
