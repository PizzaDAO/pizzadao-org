/**
 * Minimal Telegram Bot API client for follow-up DMs. The app holds no sender token: the login bot only verifies
 * the widget and never sends, so Telegram DMs are unavailable until they go through the rsv.pizza
 * proxy (plans/telegram-shared-bot.md, PR P2). Plain text only (no parse_mode), so message text can
 * never break formatting. The token is never put in an error message or log line.
 */

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly description: string,
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

export const TELEGRAM_TEXT_LIMIT = 4096

/** The app has no Telegram sender token (the login bot never sends). Always null until P2. */
export function telegramBotToken(): string | null {
  return null
}

/** Whether follow-ups can send Telegram DMs at all. False until P2; callers then use Discord only. */
export function telegramSenderAvailable(): boolean {
  return telegramBotToken() !== null
}

export async function telegramApi<T>(
  method: string,
  body: Record<string, unknown>,
  opts: { token?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const token = opts.token === undefined ? telegramBotToken() : opts.token
  if (!token) throw new TelegramApiError('Telegram is not configured', 503, 'not_configured')
  const doFetch = opts.fetchImpl ?? fetch
  const res = await doFetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null
  if (!res.ok || !json?.ok) {
    const description = String(json?.description ?? `HTTP ${res.status}`).slice(0, 200)
    throw new TelegramApiError(`Telegram ${method} failed (${res.status}): ${description}`, res.status, description)
  }
  return json.result as T
}

/** The bot cannot message this chat (blocked it, never started it, or the chat is gone). */
export function cannotMessage(err: unknown): boolean {
  if (!(err instanceof TelegramApiError)) return false
  return err.status === 403 || (err.status === 400 && /chat not found|user not found/i.test(err.description))
}

export type InlineButton = { text: string; callback_data: string }

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts: { keyboard?: InlineButton[][]; forceReply?: boolean; token?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<{ messageId: number }> {
  const result = await telegramApi<{ message_id: number }>(
    'sendMessage',
    {
      chat_id: chatId,
      text: text.slice(0, TELEGRAM_TEXT_LIMIT),
      disable_web_page_preview: true,
      ...(opts.keyboard ? { reply_markup: { inline_keyboard: opts.keyboard } } : opts.forceReply ? { reply_markup: { force_reply: true, selective: true } } : {}),
    },
    { token: opts.token, fetchImpl: opts.fetchImpl },
  )
  return { messageId: result.message_id }
}
