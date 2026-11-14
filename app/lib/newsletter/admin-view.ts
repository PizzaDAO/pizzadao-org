// app/lib/newsletter/admin-view.ts
//
// What the admin editor API returns for an issue: the row, a preview rendered by the same function a
// sender uses, the approval blockers, and the pick lists. Request body validation lives here too.
import { z } from "zod";
import { prisma } from "@/app/lib/db";
import { NextResponse } from "next/server";
import { loadSettings, type Settings } from "@/app/lib/settings";
import { resolveToggle } from "@/app/lib/settings/toggles";
import { isAdminDiscordId } from "@/app/lib/auth-guards";
import { approvalBlockers, isApprover, IssueError } from "./issue";
import { renderNewsletter } from "./render";
import { newsletterSender } from "./sender";
import { sectionsSchema, emptySections } from "./sections";
import { cityOptions, loadMemberCandidates } from "./sources/spotlight";

export const patchSchema = z
  .object({
    subject: z.string().max(200).optional(),
    preheader: z.string().max(300).optional(),
    issueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    xSpaceUrl: z.union([z.literal(""), z.string().max(500).regex(/^https:\/\//i, "Use a full https:// link")]).nullable().optional(),
    sections: sectionsSchema.optional(),
    sponsorNotified: z.boolean().optional(),
    pickMember: z.number().int().positive().optional(),
    updatedAt: z.string().min(1).max(40),
    pickCity: z.object({ key: z.string().min(1).max(120), notes: z.string().max(2000) }).optional(),
  })
  .strict();

/** A calendar date stored at 12:00 UTC (the same day in every time zone from the Americas to Asia). */
export function dateAtNoonUtc(ymd: string): Date | null {
  const d = new Date(`${ymd}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd ? null : d;
}

export async function issueView(id: string, discordId: string, settings?: Settings) {
  const s = settings ?? (await loadSettings());
  const row = await prisma.newsletterIssue.findUnique({ where: { id } });
  if (!row) throw new IssueError(404, "Issue not found");
  const parsed = sectionsSchema.safeParse(row.sections);
  const sections = parsed.success ? parsed.data : emptySections();
  // Approvers who are not app admins get a read-only view without pick lists or actor ids.
  const admin = await isAdminDiscordId(discordId);
  const [events, members, canApprove] = await Promise.all([
    prisma.newsletterIssueEvent.findMany({ where: { issueId: id }, orderBy: { createdAt: "desc" }, take: 20, select: { action: true, actor: true, createdAt: true } }),
    admin ? loadMemberCandidates().then((m) => m.candidates).catch(() => []) : Promise.resolve([]),
    isApprover(discordId, s),
  ]);
  const preview = renderNewsletter({ subject: row.subject, preheader: row.preheader, sections });
  return {
    issue: {
      id: row.id,
      slug: row.slug,
      status: row.status,
      issueDate: row.issueDate.toISOString().slice(0, 10),
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      subject: row.subject,
      preheader: row.preheader,
      xSpaceUrl: row.xSpaceUrl,
      sponsorNotified: row.sponsorNotified,
      sections,
      model: row.model,
      approvedBy: admin ? row.approvedBy : null,
      approvedAt: row.approvedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    },
    preview,
    blockers: approvalBlockers({ ...row }),
    canApprove,
    readOnly: !admin,
    candidates: { members, cities: admin ? cityOptions() : [] },
    flags: {
      draftEnabled: resolveToggle("newsletter.draftEnabled", s) === true,
      senderConfigured: newsletterSender(s) !== null,
      emailEnabled: resolveToggle("newsletter.confirmEmailsEnabled", s) === true,
    },
    audit: events.map((e) => ({ action: e.action, actor: admin ? e.actor : null, at: e.createdAt.toISOString() })),
  };
}

/** Maps the lifecycle errors to JSON responses. */
export function errorResponse(err: unknown): NextResponse | null {
  if (err instanceof IssueError) return NextResponse.json({ error: err.message }, { status: err.status });
  return null;
}
