// app/ui/telegram/errors.ts
//
// Maps the `code` the Telegram API routes return to a `telegramLink` message key, so the card shows a
// translated string instead of the server's English `error` text. Unknown codes fall back to `fallback`.

export type TelegramErrorKey = "errAlreadyLinked" | "errInvalidLogin" | "errNothingPending" | "errLinkFailed" | "appLinkFailed";

export function telegramErrorKey(code: unknown, fallback: TelegramErrorKey = "errLinkFailed"): TelegramErrorKey {
    switch (code) {
        case "already_linked":
            return "errAlreadyLinked";
        case "invalid_auth":
            return "errInvalidLogin";
        case "nothing_pending":
            return "errNothingPending";
        default:
            return fallback;
    }
}
