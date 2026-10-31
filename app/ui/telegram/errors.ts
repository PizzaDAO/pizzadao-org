// app/ui/telegram/errors.ts
//
// Maps the `code` the Telegram API routes return to a `telegramLink` message key, so the card shows a
// translated string instead of the server's English `error` text. Unknown codes get the generic link failure.

export type TelegramErrorKey = "errAlreadyLinked" | "errInvalidLogin" | "errLinkFailed";

export function telegramErrorKey(code: unknown): TelegramErrorKey {
    switch (code) {
        case "already_linked":
            return "errAlreadyLinked";
        case "invalid_auth":
            return "errInvalidLogin";
        default:
            return "errLinkFailed";
    }
}
