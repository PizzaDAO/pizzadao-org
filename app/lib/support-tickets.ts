// app/lib/support-tickets.ts
//
// Support tickets (buffalo-96244): validation, limits, serialization and the
// Discord notification for new tickets.

import type { SupportTicket, SupportTicketStatus } from "@prisma/client";
import { getWebhookUrl } from "./discord-webhook";

import {
    ADMIN_NOTES_MAX_LEN,
    BODY_MAX_LEN,
    SUBJECT_MAX_LEN,
    SUPPORT_STATUSES,
} from "./support-tickets-shared";

export * from "./support-tickets-shared";

/** Abuse controls, enforced per Discord account. */
export const MAX_TICKETS_PER_DAY = 5;
export const MAX_OPEN_TICKETS = 10;

export function isSupportStatus(v: unknown): v is SupportTicketStatus {
    return typeof v === "string" && (SUPPORT_STATUSES as readonly string[]).includes(v);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string; field?: string };

/** Validate a member's new-ticket payload. */
export function parseTicketInput(payload: unknown): Parsed<{ subject: string; body: string }> {
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const subject = typeof p.subject === "string" ? p.subject.trim() : "";
    const body = typeof p.body === "string" ? p.body.trim() : "";
    if (!subject) return { ok: false, error: "Subject is required", field: "subject" };
    if (subject.length > SUBJECT_MAX_LEN) {
        return { ok: false, error: `Subject is too long (max ${SUBJECT_MAX_LEN} characters)`, field: "subject" };
    }
    if (!body) return { ok: false, error: "Please describe the issue", field: "body" };
    if (body.length > BODY_MAX_LEN) {
        return { ok: false, error: `Message is too long (max ${BODY_MAX_LEN} characters)`, field: "body" };
    }
    return { ok: true, value: { subject, body } };
}

/** Validate an admin update (status and/or notes). */
export function parseAdminUpdate(
    payload: unknown,
): Parsed<{ status?: SupportTicketStatus; adminNotes?: string | null }> {
    const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const out: { status?: SupportTicketStatus; adminNotes?: string | null } = {};
    if (p.status !== undefined) {
        if (!isSupportStatus(p.status)) return { ok: false, error: "Invalid status", field: "status" };
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
    if (out.status === undefined && out.adminNotes === undefined) {
        return { ok: false, error: "Nothing to update" };
    }
    return { ok: true, value: out };
}

/** Member-facing view of a ticket. Admin notes are internal and omitted. */
export function toMemberTicket(t: SupportTicket) {
    return {
        id: t.id,
        subject: t.subject,
        body: t.body,
        status: t.status,
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
        closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    };
}

export type MemberTicket = ReturnType<typeof toMemberTicket>;

/** Admin view: everything. */
export function toAdminTicket(t: SupportTicket) {
    return {
        ...toMemberTicket(t),
        discordId: t.discordId,
        memberId: t.memberId,
        displayName: t.displayName,
        adminNotes: t.adminNotes,
    };
}

export type AdminTicket = ReturnType<typeof toAdminTicket>;

/**
 * Channel name looked up in the Discord webhooks sheet. Add a row with this
 * name (default "Support") pointing at the admins' support channel.
 */
export function supportWebhookChannel(): string {
    return process.env.SUPPORT_DISCORD_CHANNEL?.trim() || "Support";
}

/**
 * Best-effort Discord ping for a new ticket. Never throws. Only the subject
 * is posted (the body may contain private details); admins read the rest at
 * /admin/support.
 */
export async function notifyNewTicket(
    ticket: Pick<SupportTicket, "id" | "subject" | "discordId" | "displayName">,
): Promise<boolean> {
    try {
        const url = await getWebhookUrl(supportWebhookChannel());
        if (!url) return false;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://app.pizzadao.org";
        const who = ticket.displayName ? `${ticket.displayName} (<@${ticket.discordId}>)` : `<@${ticket.discordId}>`;
        const content = [
            `**🎫 New support ticket #${ticket.id}**`,
            ticket.subject.slice(0, SUBJECT_MAX_LEN),
            `From ${who}`,
            `${baseUrl}/admin/support`,
        ].join("\n");
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
        });
        return res.ok;
    } catch {
        return false;
    }
}
