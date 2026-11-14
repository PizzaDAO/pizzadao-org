// app/lib/newsletter/issue.ts
//
// Issue lifecycle: create a draft for a period, edit it, approve / unapprove. Nothing here sends mail
// to subscribers. Rules:
//  - status: draft -> approved -> (sent by phase 4) ; cancelled ends an issue;
//  - any edit to an approved issue returns it to draft and clears the approval;
//  - approval stores a content hash; a sender must recompute it and refuse a mismatch;
//  - approval needs the approver role (setting newsletter.approverRoleIds, empty = app admins only).
import { prisma } from "@/app/lib/db";
import { hasAnyRoleSafe, isAdminDiscordId } from "@/app/lib/auth-guards";
import { loadSettings, type Settings } from "@/app/lib/settings";
import { settingInt } from "@/app/lib/settings/numbers";
import { contentHash, partnerNeedsNotice, sectionsSchema, type NewsletterSections } from "./sections";
import { draftWithModelEnabled, fallbackSubject, gatherSections, writeDraftText } from "./draft";
import { citySection, loadMemberSpotlight, memberSection } from "./sources/spotlight";
import { buildXSpace, xSpaceConfig } from "./xspace";

export const FIRST_ISSUE_WINDOW_DAYS = 31;

/** The editable fields of an issue as the admin API sends them. */
export interface IssuePatch {
  subject?: string;
  preheader?: string;
  issueDate?: Date;
  xSpaceUrl?: string | null;
  sections?: NewsletterSections;
  sponsorNotified?: boolean;
  pickMember?: number;
  pickCity?: { key: string; notes: string };
}

export interface IssueState {
  id: string;
  status: string;
  subject: string;
  preheader: string;
  issueDate: Date;
  xSpaceUrl: string | null;
  sections: unknown;
  sponsorNotified: boolean;
  contentHash: string | null;
}

export const monthLabel = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" }).format(d);

/** First issue: the last 31 days; later issues start where the last sent one ended. */
export function periodFor(prevSentEnd: Date | null, now: Date, windowDays = FIRST_ISSUE_WINDOW_DAYS): { start: Date; end: Date } {
  return { start: prevSentEnd ?? new Date(now.getTime() - windowDays * 86_400_000), end: now };
}

/** "2026-12", or "2026-12-2" when that month already has an issue. */
export function slugFor(issueDate: Date, taken: ReadonlySet<string>): string {
  const base = issueDate.toISOString().slice(0, 7);
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now()}`;
}

// ---- permissions ----

/**
 * May this member approve? With approver roles saved: only holders of one of them. With none: app
 * admins. Unreadable or invalid settings: nobody (fail closed).
 */
export async function isApprover(discordId: string, settings: Settings): Promise<boolean> {
  if (settings.readFailed || settings.invalidKeys.includes("newsletter.approverRoleIds")) return false;
  const roles = settings.get("newsletter.approverRoleIds") as string[];
  return roles.length > 0 ? hasAnyRoleSafe(discordId, roles) : isAdminDiscordId(discordId);
}

// ---- pure state transitions ----

export function hashOf(i: Pick<IssueState, "subject" | "preheader" | "issueDate" | "xSpaceUrl" | "sections">): string {
  return contentHash({ subject: i.subject, preheader: i.preheader, issueDate: i.issueDate, xSpaceUrl: i.xSpaceUrl, sections: i.sections });
}

/** Why an issue cannot be approved right now (empty = it can). */
export function approvalBlockers(i: IssueState): string[] {
  const out: string[] = [];
  if (i.status !== "draft") out.push(`Only a draft can be approved (this one is ${i.status}).`);
  if (!i.subject.trim()) out.push("The subject is empty.");
  const parsed = sectionsSchema.safeParse(i.sections);
  if (!parsed.success) {
    out.push("The content is not valid.");
    return out;
  }
  const s = parsed.data;
  const any =
    s.intro.trim() ||
    (s.xSpace.enabled && s.xSpace.headline.trim()) ||
    (s.member.enabled && s.member.name.trim()) ||
    (s.city.enabled && s.city.name.trim()) ||
    (s.partner.enabled && s.partner.name.trim()) ||
    (s.events.enabled && s.events.items.some((e) => e.included)) ||
    (s.calls.enabled && s.calls.crews.some((c) => c.included)) ||
    (s.articles.enabled && s.articles.items.some((a) => a.included));
  if (!any) out.push("The issue has no content.");
  if (partnerNeedsNotice(s) && !i.sponsorNotified) out.push("Tell the featured sponsor first, then tick \"Sponsor notified\" (or hide the Partner Spotlight).");
  return out;
}

export interface EditData {
  subject?: string;
  preheader?: string;
  issueDate?: Date;
  xSpaceUrl?: string | null;
  sections?: NewsletterSections;
  sponsorNotified?: boolean;
  status?: string;
  approvedBy?: null;
  approvedAt?: null;
  contentHash?: null;
  sendAfter?: null;
  editedBy: string;
  editedAt: Date;
}

/**
 * The row update for an edit. The picks need data from the database, so they are resolved by the
 * caller into `picked`. An approved issue goes back to draft with its approval cleared.
 */
export function editData(
  cur: IssueState,
  patch: IssuePatch,
  ctx: { actor: string; now: Date; xSpace: ReturnType<typeof xSpaceConfig>; picked?: { member?: NewsletterSections["member"]; city?: NewsletterSections["city"] } },
): { data: EditData; invalidated: boolean } {
  const data: EditData = { editedBy: ctx.actor, editedAt: ctx.now };
  if (patch.subject !== undefined) data.subject = patch.subject.trim();
  if (patch.preheader !== undefined) data.preheader = patch.preheader.trim();
  if (patch.sponsorNotified !== undefined) data.sponsorNotified = patch.sponsorNotified;

  const curSections = sectionsSchema.safeParse(cur.sections);
  let sections: NewsletterSections | undefined = patch.sections ?? (curSections.success ? curSections.data : undefined);
  const dateChanged = patch.issueDate !== undefined && patch.issueDate.getTime() !== cur.issueDate.getTime();
  const urlChanged = patch.xSpaceUrl !== undefined && (patch.xSpaceUrl ?? null) !== cur.xSpaceUrl;
  if (patch.issueDate !== undefined) data.issueDate = patch.issueDate;
  if (patch.xSpaceUrl !== undefined) data.xSpaceUrl = patch.xSpaceUrl?.trim() || null;

  if (sections) {
    sections = JSON.parse(JSON.stringify(sections)) as NewsletterSections;
    // The invite follows the date and the Space link unless the editor changed the block in the same save.
    const xEditedHere = patch.sections && curSections.success && JSON.stringify(patch.sections.xSpace) !== JSON.stringify(curSections.data.xSpace);
    if ((dateChanged || urlChanged) && !xEditedHere) {
      const rebuilt = buildXSpace(patch.issueDate ?? cur.issueDate, ctx.xSpace, patch.xSpaceUrl !== undefined ? patch.xSpaceUrl : cur.xSpaceUrl);
      sections.xSpace = { ...rebuilt, enabled: sections.xSpace.enabled };
    }
    if (ctx.picked?.member) sections.member = ctx.picked.member;
    if (ctx.picked?.city) sections.city = ctx.picked.city;
    data.sections = sections;
  }

  const invalidated = cur.status === "approved";
  if (invalidated) {
    data.status = "draft";
    data.approvedBy = null;
    data.approvedAt = null;
    data.contentHash = null;
    data.sendAfter = null;
  }
  return { data, invalidated };
}

// ---- database operations ----

export class IssueError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const toState = (r: {
  id: string;
  status: string;
  subject: string;
  preheader: string;
  issueDate: Date;
  xSpaceUrl: string | null;
  sections: unknown;
  sponsorNotified: boolean;
  contentHash: string | null;
}): IssueState => r;

async function log(issueId: string, action: string, actor: string, data?: Record<string, unknown>) {
  await prisma.newsletterIssueEvent.create({ data: { issueId, action, actor, ...(data ? { data: data as object } : {}) } });
}

export interface CreateResult {
  id: string;
  slug: string;
  modelUsed: boolean;
  modelError: string | null;
}

/** Gather the data for a period and create the draft; the model writes the wording when drafting is switched on. */
export async function createDraft(o: { actor: string; issueDate: Date; now?: Date; settings?: Settings }): Promise<CreateResult> {
  const settings = o.settings ?? (await loadSettings());
  const now = o.now ?? new Date();
  const prev = await prisma.newsletterIssue.findFirst({ where: { status: "sent" }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } });
  const period = periodFor(prev?.periodEnd ?? null, now);
  const articlesSince = prev?.periodEnd ?? new Date(now.getTime() - settingInt("newsletter.articlesWindowDays", settings) * 86_400_000);
  const gathered = await gatherSections({ settings, issueDate: o.issueDate, period, articlesSince, xSpaceUrl: null });

  let sections = gathered.sections;
  let subject = fallbackSubject(monthLabel(o.issueDate));
  let preheader = "";
  let model: string | null = null;
  let modelError: string | null = null;
  if (draftWithModelEnabled(settings)) {
    try {
      const text = await writeDraftText(sections, monthLabel(o.issueDate), { settings });
      sections = text.sections;
      subject = text.subject || subject;
      preheader = text.preheader;
      model = text.model;
    } catch (err) {
      // Unreadable settings must not produce a draft written without the private instructions.
      if (settings.readFailed || settings.invalidKeys.includes("newsletter.promptExtra")) throw err;
      modelError = err instanceof Error ? err.message.slice(0, 200) : "model call failed";
    }
  }

  const taken = new Set((await prisma.newsletterIssue.findMany({ select: { slug: true } })).map((r) => r.slug));
  const slug = slugFor(o.issueDate, taken);
  const row = await prisma.newsletterIssue.create({
    data: {
      slug,
      issueDate: o.issueDate,
      periodStart: period.start,
      periodEnd: period.end,
      subject,
      preheader,
      sections: sections as object,
      sources: gathered.sources as object,
      model,
      generatedAt: now,
      createdBy: o.actor,
    },
    select: { id: true },
  });
  await log(row.id, "generate", o.actor, { model, modelError, calls: gathered.sources.callIds.length, articles: gathered.sources.articleIds.length });
  return { id: row.id, slug, modelUsed: !!model, modelError };
}

/** Re-run the model over the current sections (selections and edited fields it does not overwrite stay). */
export async function redraftText(id: string, actor: string): Promise<IssueState> {
  const settings = await loadSettings();
  if (!draftWithModelEnabled(settings)) throw new IssueError(409, "AI drafting is switched off (Settings, Newsletter).");
  const row = await prisma.newsletterIssue.findUnique({ where: { id } });
  if (!row) throw new IssueError(404, "Issue not found");
  const parsed = sectionsSchema.safeParse(row.sections);
  if (!parsed.success) throw new IssueError(409, "The content is not valid.");
  const text = await writeDraftText(parsed.data, monthLabel(row.issueDate), { settings });
  return updateIssue(id, { subject: text.subject, preheader: text.preheader, sections: text.sections }, actor, "redraft");
}

export async function updateIssue(id: string, patch: IssuePatch, actor: string, action = "edit"): Promise<IssueState> {
  const row = await prisma.newsletterIssue.findUnique({ where: { id } });
  if (!row) throw new IssueError(404, "Issue not found");
  if (row.status === "sent" || row.status === "cancelled") throw new IssueError(409, `A ${row.status} issue can't be edited.`);
  const settings = await loadSettings();
  const picked: { member?: NewsletterSections["member"]; city?: NewsletterSections["city"] } = {};
  if (patch.pickMember !== undefined) {
    const sub = await loadMemberSpotlight(patch.pickMember);
    if (!sub) throw new IssueError(400, "That submission can't be featured (not consented, not shortlisted, or already used).");
    picked.member = memberSection(sub);
  }
  if (patch.pickCity) {
    const c = citySection(patch.pickCity.key, patch.pickCity.notes);
    if (!c) throw new IssueError(400, "Unknown city");
    const keepBlurb = sectionsSchema.safeParse(row.sections);
    picked.city = { ...c, blurb: keepBlurb.success && keepBlurb.data.city.cityKey === c.cityKey ? keepBlurb.data.city.blurb : "" };
  }
  const { data, invalidated } = editData(toState(row), patch, { actor, now: new Date(), xSpace: xSpaceConfig(settings), picked });
  const res = await prisma.newsletterIssue.updateMany({
    where: { id, updatedAt: row.updatedAt, status: { in: ["draft", "approved"] } },
    data: data as object,
  });
  if (res.count === 0) throw new IssueError(409, "The issue changed while you were editing. Reload and try again.");
  await log(id, action, actor, { invalidatedApproval: invalidated });
  const fresh = await prisma.newsletterIssue.findUniqueOrThrow({ where: { id } });
  return toState(fresh);
}

export async function approveIssue(id: string, actor: string, settings: Settings): Promise<IssueState> {
  if (!(await isApprover(actor, settings))) throw new IssueError(403, "You are not allowed to approve newsletters.");
  const row = await prisma.newsletterIssue.findUnique({ where: { id } });
  if (!row) throw new IssueError(404, "Issue not found");
  const blockers = approvalBlockers(toState(row));
  if (blockers.length) throw new IssueError(409, blockers.join(" "));
  const now = new Date();
  const hash = hashOf(row);
  // Bound to the version just read: an edit in between changes updatedAt and the approval does not apply.
  const res = await prisma.newsletterIssue.updateMany({
    where: { id, status: "draft", updatedAt: row.updatedAt },
    data: { status: "approved", approvedBy: actor, approvedAt: now, contentHash: hash },
  });
  if (res.count === 0) throw new IssueError(409, "The issue changed while you were approving. Review it and approve again.");
  await log(id, "approve", actor, { hash });
  return toState(await prisma.newsletterIssue.findUniqueOrThrow({ where: { id } }));
}

export async function unapproveIssue(id: string, actor: string): Promise<IssueState> {
  const res = await prisma.newsletterIssue.updateMany({
    where: { id, status: "approved" },
    data: { status: "draft", approvedBy: null, approvedAt: null, contentHash: null, sendAfter: null },
  });
  if (res.count === 0) throw new IssueError(409, "Only an approved issue can be unapproved.");
  await log(id, "unapprove", actor);
  return toState(await prisma.newsletterIssue.findUniqueOrThrow({ where: { id } }));
}
