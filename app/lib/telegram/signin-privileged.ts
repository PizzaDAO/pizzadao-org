// app/lib/telegram/signin-privileged.ts
//
// Roles that carry app powers beyond an ordinary member's: guild admins, Dread Pizza Roberts, capos,
// mission reviewers, payment reviewers and treasury, and the newsletter / announce / mission-reviewer roles
// saved in settings. A member holding any of them must log in with Discord, not Telegram, unless
// auth.telegramSignInAdminAllowed is on. The ids come from the same constants and settings the guards use.
import { ADMIN_ROLE_IDS, CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, MISSION_REVIEWER_ROLE_IDS } from "@/app/ui/constants";
import { PAYMENT_REVIEWER_ROLE_IDS, PAYMENT_TREASURY_ROLE_IDS } from "@/app/lib/payments/access";
import { getSetting } from "@/app/lib/settings";
import { articleAuthorRoleIds } from "@/app/lib/settings/roles";
import { getAnnounceAccessConfig } from "@/app/lib/announce/access";
import { LIVE_HOST_ROLE_LINE } from "@/app/lib/settings/registry";

/** One role id per line of calls.liveHostRoleIds. */
function parseRoleLines(raw: string): string[] {
    return raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => LIVE_HOST_ROLE_LINE.test(l));
}

/** Throws when a saved role list cannot be read (the caller retries rather than guessing). */
export async function privilegedRoleIds(): Promise<Set<string>> {
    const [reviewers, approvers, announceSaved, liveHosts, authors] = await Promise.all([
        getSetting("missions.reviewerRoleIds"),
        getSetting("newsletter.approverRoleIds"),
        getSetting("announce.roleIds"),
        getSetting("calls.liveHostRoleIds"),
        articleAuthorRoleIds(), // never throws: falls back to the built-in list
    ]);
    // Who may announce: saved roles, else the env roles, else the admin roles (the chain canAnnounce uses).
    const announce = getAnnounceAccessConfig(process.env, announceSaved);
    return new Set<string>([
        ...ADMIN_ROLE_IDS,
        DREAD_PIZZA_ROBERTS_ROLE_ID,
        ...CALL_CAPO_ROLE_IDS,
        ...MISSION_REVIEWER_ROLE_IDS,
        ...PAYMENT_REVIEWER_ROLE_IDS,
        ...PAYMENT_TREASURY_ROLE_IDS,
        ...reviewers,
        ...approvers,
        ...(announce.mode === "roles" ? announce.roleIds : []),
        ...parseRoleLines(liveHosts),
        ...authors,
    ]);
}

/** The announce config's legacy hard-coded Discord user ids (used only when no announce or admin role env is set). */
export function legacyPrivilegedUserIds(): readonly string[] {
    const cfg = getAnnounceAccessConfig(process.env, []);
    return cfg.mode === "legacy-users" ? cfg.discordIds : [];
}

export async function holdsPrivilegedRole(roles: readonly string[], discordId?: string): Promise<boolean> {
    if (discordId && legacyPrivilegedUserIds().includes(discordId)) return true;
    const privileged = await privilegedRoleIds();
    return roles.some((r) => privileged.has(r));
}
