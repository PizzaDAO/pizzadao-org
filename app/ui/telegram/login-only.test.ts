import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), 'utf8')

describe('Telegram is login-only in the app', () => {
  it('the Login Widget does not request write access', () => {
    expect(read('app/ui/telegram/TelegramLinker.tsx')).not.toMatch(/script\.setAttribute\("data-request-access"/)
  })
  it('the webhook route, its handlers and the set-webhook script are gone', () => {
    for (const p of ['app/api/telegram/webhook/route.ts', 'app/lib/followups/telegram-updates.ts', 'app/lib/followups/webhook-auth.ts', 'scripts/telegram-set-webhook.mjs']) {
      expect(existsSync(join(root, p)), p).toBe(false)
    }
  })
  it('the old shared env names are no longer read by the app', () => {
    for (const p of ['app/lib/telegram-auth.ts', 'app/api/telegram/account/route.ts', 'app/lib/followups/telegram.ts']) {
      expect(read(p), p).not.toMatch(/process\.env\.TELEGRAM_BOT_TOKEN|TELEGRAM_BOT_USERNAME|TELEGRAM_WEBHOOK_SECRET/)
    }
  })
})
