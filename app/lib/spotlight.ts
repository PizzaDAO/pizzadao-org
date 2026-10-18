// app/lib/spotlight.ts
//
// Mafia Spotlight submissions (blackolive-55617): validation, limits,
// serialization and the Discord notification for new submissions.

import type { SpotlightSubmission, SpotlightStatus } from "@prisma/client";
import { getWebhookUrl } from "./discord-webhook";
import { isOwnBlobUrl } from "./blob-url";
import {
    ADMIN_NOTES_MAX_LEN,
    CITY_MAX_LEN,
    LINK_MAX_LEN,
    MAX_LINKS,
    NAME_MAX_LEN,
    PITCH_MAX_LEN,
    SPOTLIGHT_STATUSES,
} from "./spotlight-shared";

export * from "./spotlight-shared";

/** Abuse controls, enforced per Discord account. */
export const MAX_SUBMISSIONS_PER_DAY = 3;
export const MAX_PENDING = 5;

export function isSpotlightStatus(v: unknown): v is SpotlightStatus {
    return typeof v === "string" && (SPOTLIGHT_STATUSES as readonly string[]).includes(v);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

export type SubmissionInput = {
    isSelf: boolean;
    nomineeName: string | null;
    nomineeDiscord: string | null;
    city: string | null;
    pitch: string;
    links: string[];
    photoUrl: string | null;
    consent: true;
};

function isHttpUrl(v: string): boolean {
    try {
        const u = new URL(v);
        return u.protocol === "http:" || u.protocol === "https:";
    } catch {
        return false;
    }
}

/**
 * Validate a member's new-submission payload. When `isSelf`, the route fills
 * the nominee from the session, so `nomineeName` is null here. `discordId`
 * ties the photo URL to the uploader (`/spotlight/<discordId>/`).
 */
export function parseSubmissionInput(payload: unknown, discordId: string): Parsed<SubmissionInput> {
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

    const isSelf = p.isSelf === true;

    const pitch = str(p.pitch);
    if (!pitch) return { ok: false, error: "Please tell us why they should be spotlighted", field: "pitch" };
    if (pitch.length > PITCH_MAX_LEN) {
        return { ok: false, error: `Pitch is too long (max ${PITCH_MAX_LEN} characters)`, field: "pitch" };
    }

    let nomineeName: string | null = null;
    let nomineeDiscord: string | null = null;
    if (!isSelf) {
        nomineeName = str(p.nomineeName);
        if (!nomineeName) return { ok: false, error: "Nominee name is required", field: "nomineeName" };
        if (nomineeName.length > NAME_MAX_LEN) {
            return { ok: false, error: `Name is too long (max ${NAME_MAX_LEN} characters)`, field: "nomineeName" };
        }
        nomineeDiscord = str(p.nomineeDiscord) || null;
        if (nomineeDiscord && nomineeDiscord.length > NAME_MAX_LEN) {
            return {
                ok: false,
                error: `Discord handle is too long (max ${NAME_MAX_LEN} characters)`,
                field: "nomineeDiscord",
            };
        }
    }

    const city = str(p.city) || null;
    if (city && city.length > CITY_MAX_LEN) {
        return { ok: false, error: `City is too long (max ${CITY_MAX_LEN} characters)`, field: "city" };
    }

    const rawLinks = p.links === undefined || p.links === null ? [] : p.links;
    if (!Array.isArray(rawLinks)) return { ok: false, error: "Invalid links", field: "links" };
    const links = rawLinks.map(str).filter(Boolean);
    if (links.length > MAX_LINKS) {
        return { ok: false, error: `You can add at most ${MAX_LINKS} links`, field: "links" };
    }
    for (const l of links) {
        if (l.length > LINK_MAX_LEN) {
            return { ok: false, error: `Links are too long (max ${LINK_MAX_LEN} characters)`, field: "links" };
        }
        if (!isHttpUrl(l)) return { ok: false, error: "Links must start with http:// or https://", field: "links" };
    }

    let photoUrl: string | null = null;
    if (p.photoUrl !== undefined && p.photoUrl !== null && p.photoUrl !== "") {
        if (typeof p.photoUrl !== "string" || !isOwnBlobUrl(p.photoUrl.trim(), `/spotlight/${discordId}/`)) {
            return { ok: false, error: "Invalid photo", field: "photoUrl" };
        }
        photoUrl = p.photoUrl.trim();
    }

    if (p.consent !== true) {
        return { ok: false, error: "Please confirm the consent checkbox", field: "consent" };
    }

    return { ok: true, value: { isSelf, nomineeName, nomineeDiscord, city, pitch, links, photoUrl, consent: true } };
}

export type AdminUpdate = { status?: SpotlightStatus; adminNotes?: string | null; featuredOn?: Date | null };

/** Validate an admin update (status, notes and/or featuredOn ISO date). */
export function parseAdminUpdate(payload: unknown): Parsed<AdminUpdate> {
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const out: AdminUpdate = {};
    if (p.status !== undefined) {
        if (!isSpotlightStatus(p.status)) return { ok: false, error: "Invalid status", field: "status" };
        out.status = p.status;
    }
    if (p.adminNotes !== undefined) {
        if (p.adminNotes !== null && typeof p.adminNotes !== "string") {
            return { ok: false, error: "Invalid notes", field: "adminNotes" };
        }
        const notes = typeof p.adminNotes === "string" ? p.adminNotes.trim() : "";
        if (notes.length > ADMIN_NOTES_MAX_LEN) {
            return { ok: false, error: `Notes are too long (max ${ADMIN_NOTES_MAX_LEN} characters)`, field: "adminNotes" };
        }
        out.adminNotes = notes || null;
    }
    if (p.featuredOn !== undefined) {
        if (p.featuredOn === null || p.featuredOn === "") {
            out.featuredOn = null;
        } else {
            const d = typeof p.featuredOn === "string" ? new Date(p.featuredOn) : null;
            if (!d || Number.isNaN(d.getTime())) return { ok: false, error: "Invalid date", field: "featuredOn" };
            out.featuredOn = d;
        }
    }
    if (out.status === undefined && out.adminNotes === undefined && out.featuredOn === undefined) {
        return { ok: false, error: "Nothing to update" };
    }
    return { ok: true, value: out };
}

/** Member-facing view. Admin notes and internal ids are omitted. */
export function toMemberSubmission(s: SpotlightSubmission) {
    return {
        id: s.id,
        isSelf: s.isSelf,
        nomineeName: s.nomineeName,
        city: s.city,
        pitch: s.pitch,
        links: s.links,
        photoUrl: s.photoUrl,
        status: s.status,
        featuredOn: s.featuredOn ? s.featuredOn.toISOString() : null,
        createdAt: s.createdAt.toISOString(),
    };
}

export type MemberSubmission = ReturnType<typeof toMemberSubmission>;

/** Admin view: everything. */
export function toAdminSubmission(s: SpotlightSubmission) {
    return {
        ...toMemberSubmission(s),
        submitterDiscordId: s.submitterDiscordId,
        submitterMemberId: s.submitterMemberId,
        submitterName: s.submitterName,
        nomineeDiscord: s.nomineeDiscord,
        nomineeDiscordId: s.nomineeDiscordId,
        nomineeMemberId: s.nomineeMemberId,
        consent: s.consent,
        adminNotes: s.adminNotes,
        updatedAt: s.updatedAt.toISOString(),
    };
}

export type AdminSubmission = ReturnType<typeof toAdminSubmission>;

/**
 * Channel name looked up in the Discord webhooks sheet. Add a row with this
 * name (default "Mafia Spotlight") pointing at the hosts' channel.
 */
export function spotlightWebhookChannel(): string {
    return process.env.SPOTLIGHT_DISCORD_CHANNEL?.trim() || "Mafia Spotlight";
}

/**
 * Best-effort Discord ping for a new submission. Never throws. Only the first
 * ~300 characters of the pitch are posted; admins read the rest at
 * /admin/spotlight.
 */
export async function notifyNewSubmission(
    s: Pick<SpotlightSubmission, "id" | "nomineeName" | "pitch" | "submitterDiscordId" | "submitterName">,
): Promise<boolean> {
    try {
        const url = await getWebhookUrl(spotlightWebhookChannel());
        if (!url) return false;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://app.pizzadao.org";
        const who = s.submitterName ? `${s.submitterName} (<@${s.submitterDiscordId}>)` : `<@${s.submitterDiscordId}>`;
        const pitch = s.pitch.length > 300 ? `${s.pitch.slice(0, 300)}…` : s.pitch;
        const content = [
            `**🌟 New Mafia Spotlight submission #${s.id}**`,
            `Nominee: ${s.nomineeName.slice(0, NAME_MAX_LEN)}`,
            pitch,
            `From ${who}`,
            `${baseUrl}/admin/spotlight`,
        ].join("\n");
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
            signal: AbortSignal.timeout(5000),
        });
        return res.ok;
    } catch {
        return false;
    }
}
