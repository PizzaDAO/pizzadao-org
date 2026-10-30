// app/lib/telegram/login-bot.ts
//
// Best-effort calls to OUR login bot (never the shared rsv.pizza bot). Failures are swallowed: the
// profile page polls and shows the outcome either way. Message text is never logged.

export async function loginBotCall(botToken: string, method: string, body: Record<string, unknown>): Promise<void> {
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        // Best effort.
    }
}

export const loginBotSend = (botToken: string, chatId: number | string, text: string, extra: Record<string, unknown> = {}) =>
    loginBotCall(botToken, "sendMessage", { chat_id: chatId, text, ...extra });
