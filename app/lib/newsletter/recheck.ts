// app/lib/newsletter/recheck.ts
//
// Re-validation of an issue's content against the privacy rules AS THEY ARE NOW. Content is gathered
// at draft time, but a call can be unpublished, a speaker hidden, a crew excluded or a blocked term
// added before the issue goes out. Approval runs this and refuses on any problem (so the approver
// re-reviews); the phase 4 sender must call it again right before sending.
// Messages name the field, never the blocked term.
import { prisma } from "@/app/lib/db";
import { importedAllowed, isImportedSource } from "@/app/lib/calls/imported";
import { isCrewExcluded, loadPostFilter, mentionsBlockedTerm, type PostFilter } from "@/app/lib/calls/post-filters";
import { redactionsNewerThanSummary } from "@/app/lib/calls/recap";
import { sectionsSchema, type NewsletterSections } from "./sections";

export interface RecheckCall {
  id: string;
  status: string;
  source?: string | null;
  crewId: string | null;
  crewLabel: string | null;
  eventName?: string | null;
  redactionsUpdatedAt?: Date | null;
  summaryGeneratedAt?: Date | null;
  summaryEditedAt?: Date | null;
}

/** Every piece of text a reader of an enabled section would see, with a label for messages. */
export function visibleTexts(subject: string, preheader: string, s: NewsletterSections): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [
    { where: "subject", text: subject },
    { where: "preheader", text: preheader },
    { where: "opening", text: s.intro },
  ];
  if (s.xSpace.enabled) out.push({ where: "X Space invite", text: `${s.xSpace.headline} ${s.xSpace.detail}` });
  if (s.member.enabled) out.push({ where: "Member Spotlight", text: `${s.member.name} ${s.member.city} ${s.member.blurb}` });
  if (s.city.enabled) out.push({ where: "City Spotlight", text: `${s.city.name} ${s.city.blurb}` });
  if (s.partner.enabled) out.push({ where: "Partner Spotlight", text: `${s.partner.name} ${s.partner.blurb}` });
  if (s.events.enabled) {
    out.push({ where: "Upcoming events", text: s.events.intro });
    for (const e of s.events.items) if (e.included) out.push({ where: "Upcoming events", text: e.name });
  }
  if (s.articles.enabled) {
    out.push({ where: "New articles", text: s.articles.intro });
    for (const a of s.articles.items) if (a.included) out.push({ where: "New articles", text: `${a.title} ${a.author} ${a.excerpt}` });
  }
  if (s.calls.enabled) {
    out.push({ where: "Call updates", text: s.calls.intro });
    for (const c of s.calls.crews) {
      if (!c.included) continue;
      out.push({ where: `Call updates (${c.label})`, text: [c.label, c.summary, ...c.bullets, ...c.shipped].join(" \n ") });
    }
  }
  return out;
}

/** Pure check. `calls` are the CallRecording rows named in the issue's sources (missing rows = deleted). */
export function recheckContent(
  issue: { subject: string; preheader: string; sections: NewsletterSections; callIds: string[] },
  filter: PostFilter,
  calls: RecheckCall[],
  importedOk: boolean,
): string[] {
  const problems: string[] = [];
  const s = issue.sections;
  const includedCrews = s.calls.enabled ? s.calls.crews.filter((c) => c.included) : [];
  const includedKeys = new Set(includedCrews.map((c) => c.id));

  for (const c of includedCrews) {
    if (isCrewExcluded({ id: c.id, label: c.label }, filter)) problems.push(`Call updates: the crew "${c.label}" is now excluded from public posts. Untick it.`);
  }
  const byId = new Map(calls.map((c) => [c.id, c]));
  for (const id of issue.callIds) {
    const row = byId.get(id);
    // Only calls of crews that are still in the issue matter.
    const key = row ? row.crewId || row.crewLabel || "other" : null;
    if (row && !includedKeys.has(key!)) continue;
    if (!row) {
      if (includedKeys.size) problems.push("Call updates: a call used for this issue no longer exists. Check the crew sections.");
      continue;
    }
    const label = row.crewLabel || row.eventName || "a crew";
    if (row.status !== "PUBLISHED") problems.push(`Call updates: a call of "${label}" is no longer published. Untick or edit that crew.`);
    else if (redactionsNewerThanSummary(row)) problems.push(`Call updates: a call of "${label}" has newer redactions than its summary. Untick or edit that crew.`);
    else if (isCrewExcluded({ id: row.crewId, label: row.crewLabel || row.eventName }, filter)) problems.push(`Call updates: the crew "${label}" is now excluded from public posts. Untick it.`);
    else if (isImportedSource(row.source) && !importedOk) problems.push(`Call updates: a call of "${label}" is imported and imported calls are not allowed now. Untick it.`);
  }
  const seen = new Set<string>();
  for (const t of visibleTexts(issue.subject, issue.preheader, s)) {
    if (t.text && mentionsBlockedTerm(t.text, filter) && !seen.has(t.where)) {
      seen.add(t.where);
      problems.push(`${t.where}: contains text that is now blocked by the post filter. Edit or remove it.`);
    }
  }
  return problems;
}

/** Load what the check needs and run it. Throws when the filter cannot be read (callers must then refuse). */
export async function recheckIssueContent(issue: { subject: string; preheader: string; sections: unknown; sources: unknown }): Promise<string[]> {
  const parsed = sectionsSchema.safeParse(issue.sections);
  if (!parsed.success) return ["The content is not valid."];
  const filter = await loadPostFilter();
  const ids = (issue.sources as { callIds?: unknown } | null)?.callIds;
  const callIds = Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
  const calls = callIds.length
    ? await prisma.callRecording.findMany({
        where: { id: { in: callIds } },
        select: { id: true, status: true, source: true, crewId: true, crewLabel: true, eventName: true, redactionsUpdatedAt: true, summaryGeneratedAt: true, summaryEditedAt: true },
      })
    : [];
  const importedOk = await importedAllowed("calls.importedRecapPostEnabled");
  return recheckContent({ subject: issue.subject, preheader: issue.preheader, sections: parsed.data, callIds }, filter, calls, importedOk);
}
