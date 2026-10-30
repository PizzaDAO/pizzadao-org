import { describe, it, expect, vi } from 'vitest'
import { sendTelegramMessage, telegramBotToken, telegramSenderAvailable } from './telegram'

describe('follow-up Telegram sender (login-only bot: no sender token in the app)', () => {
  it('is unavailable, whatever the env says', () => {
    vi.stubEnv('TELEGRAM_LOGIN_BOT_TOKEN', 'login-token')
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'old-token')
    expect(telegramBotToken()).toBeNull()
    expect(telegramSenderAvailable()).toBe(false)
    vi.unstubAllEnvs()
  })
  it('never attempts a network send without a token', async () => {
    const fetchImpl = vi.fn()
    await expect(sendTelegramMessage('1', 'hi', { fetchImpl: fetchImpl as never })).rejects.toMatchObject({ description: 'not_configured' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
