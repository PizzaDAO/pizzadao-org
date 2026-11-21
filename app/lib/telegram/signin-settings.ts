// app/lib/telegram/signin-settings.ts
//
// The settings behind "Sign in with Telegram" (plans/calzone-93434.md), read in one place.
import { getSetting } from "@/app/lib/settings";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { SIGNIN_DEFAULT_TTL_MINUTES } from "@/app/lib/telegram/signin-code";

export interface SigninConfig {
    enabled: boolean;
    /** Discord ids; empty = everyone (once enabled). */
    allowlist: string[];
    ttlMinutes: number;
}

/** Never throws: anything unreadable means "off". */
export async function signinConfig(): Promise<SigninConfig> {
    const off = { enabled: false, allowlist: [], ttlMinutes: SIGNIN_DEFAULT_TTL_MINUTES };
    const enabled = await toggleEnabled("auth.telegramSignInEnabled").catch(() => false);
    if (!enabled) return off;
    const [allowlist, ttlMinutes] = await Promise.all([
        getSetting("auth.telegramSignInAllowlist").catch(() => null),
        getSetting("auth.telegramSignInTtlMinutes").catch(() => SIGNIN_DEFAULT_TTL_MINUTES),
    ]);
    // An allowlist that cannot be read must not open sign-in to everyone.
    if (allowlist === null) return off;
    return { enabled: true, allowlist, ttlMinutes };
}

export const signinAllowed = (cfg: SigninConfig, discordId: string) =>
    cfg.enabled && (cfg.allowlist.length === 0 || cfg.allowlist.includes(discordId));
