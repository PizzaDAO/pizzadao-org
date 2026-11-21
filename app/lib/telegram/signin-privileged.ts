// app/lib/telegram/signin-privileged.ts
//
// Roles that carry app powers beyond an ordinary member's: guild admins, Dread Pizza Roberts, capos,
// mission reviewers, payment reviewers and treasury, and the newsletter / announce / mission-reviewer roles
// saved in settings. A member holding any of them must log in with Discord, not Telegram, unless
// auth.telegramSignInAdminAllowed is on. The ids come from the same constants and settings the guards use.
import { ADMIN_ROLE_IDS, CALL_CAPO_ROLE_IDS, DREAD_PIZZA_ROBERTS_ROLE_ID, MISSION_REVIEWER_ROLE_IDS } from "@/app/ui/constants";
import { PAYMENT_REVIEWER_ROLE_IDS, PAYMENT_TREASURY_ROLE_IDS } from "@/app/lib/payments/access";
import { getSetting } from "@/app/lib/settings";

/** Throws when a saved role list cannot be read (the caller retries rather than guessing). */
export async function privilegedRoleIds(): Promise<Set<string>> {
    const [reviewers, approvers, announce] = await Promise.all([
        getSetting("missions.reviewerRoleIds"),
        getSetting("newsletter.approverRoleIds"),
        getSetting("announce.roleIds"),
    ]);
    return new Set<string>([
        ...ADMIN_ROLE_IDS,
        DREAD_PIZZA_ROBERTS_ROLE_ID,
        ...CALL_CAPO_ROLE_IDS,
        ...MISSION_REVIEWER_ROLE_IDS,
        ...PAYMENT_REVIEWER_ROLE_IDS,
        ...PAYMENT_TREASURY_ROLE_IDS,
        ...reviewers,
        ...approvers,
        ...announce,
    ]);
}

export async function holdsPrivilegedRole(roles: readonly string[]): Promise<boolean> {
    const privileged = await privilegedRoleIds();
    return roles.some((r) => privileged.has(r));
}
