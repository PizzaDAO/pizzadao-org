// app/lib/newsletter/sections.ts
//
// The structured, editable content of a newsletter issue (stored as NewsletterIssue.sections), its
// validation, and the content hash that approval is bound to. Pure. Text fields are plain text; the
// renderer escapes everything and only lets https links through.
import { createHash } from "crypto";
import { z } from "zod";

const text = (max: number) => z.string().max(max);
const link = z.union([z.literal(""), z.string().max(500).regex(/^https:\/\//i, "Links must start with https://")]);

const xSpace = z.object({ enabled: z.boolean(), headline: text(200), detail: text(300), url: link.nullable() });

const callCrew = z.object({
  id: text(80),
  label: text(120),
  summary: text(1200),
  bullets: z.array(text(400)).max(20),
  shipped: z.array(text(300)).max(30),
  url: link,
  included: z.boolean(),
});
const calls = z.object({ enabled: z.boolean(), intro: text(600), crews: z.array(callCrew).max(20) });

const member = z.object({
  enabled: z.boolean(),
  submissionId: z.number().int().nullable(),
  name: text(120),
  city: text(120),
  blurb: text(1500),
  links: z.array(link).max(6),
  photoUrl: link,
});
const city = z.object({ enabled: z.boolean(), cityKey: text(120), name: text(120), notes: text(2000), blurb: text(1500) });
const partner = z.object({
  enabled: z.boolean(),
  name: text(160),
  website: link,
  logoUrl: link,
  blurb: text(1500),
  notifiedNote: text(500), // internal: who told the sponsor and when; never rendered
});
const eventItem = z.object({ id: text(120), name: text(200), startsAt: text(40), url: link, included: z.boolean() });
const events = z.object({ enabled: z.boolean(), intro: text(600), items: z.array(eventItem).max(40) });
const articleItem = z.object({
  id: text(40),
  title: text(300),
  author: text(120),
  excerpt: text(600),
  coverImage: link,
  url: link,
  included: z.boolean(),
});
const articles = z.object({ enabled: z.boolean(), intro: text(600), items: z.array(articleItem).max(12) });

export const sectionsSchema = z.object({
  intro: text(2000),
  xSpace,
  member,
  city,
  partner,
  events,
  calls,
  articles,
});

export type NewsletterSections = z.infer<typeof sectionsSchema>;
export type XSpaceBlock = z.infer<typeof xSpace>;
export type CallCrew = z.infer<typeof callCrew>;
export type EventItem = z.infer<typeof eventItem>;
export type ArticleItem = z.infer<typeof articleItem>;

export function emptySections(): NewsletterSections {
  return {
    intro: "",
    xSpace: { enabled: false, headline: "", detail: "", url: null },
    member: { enabled: false, submissionId: null, name: "", city: "", blurb: "", links: [], photoUrl: "" },
    city: { enabled: false, cityKey: "", name: "", notes: "", blurb: "" },
    partner: { enabled: false, name: "", website: "", logoUrl: "", blurb: "", notifiedNote: "" },
    events: { enabled: false, intro: "", items: [] },
    calls: { enabled: false, intro: "", crews: [] },
    articles: { enabled: false, intro: "", items: [] },
  };
}

/** Whether the partner section needs the sponsor to have been told before the issue can be approved. */
export function partnerNeedsNotice(sections: NewsletterSections): boolean {
  return sections.partner.enabled && sections.partner.name.trim().length > 0;
}

export interface HashInput {
  subject: string;
  preheader: string;
  issueDate: Date;
  xSpaceUrl: string | null;
  sections: unknown;
}

/** Stable JSON: object keys sorted, so key order never changes the hash. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** sha256 of everything a reader sees. Approval stores it; a sender recomputes it and refuses a mismatch. */
export function contentHash(i: HashInput): string {
  return createHash("sha256")
    .update(canonical({ subject: i.subject, preheader: i.preheader, issueDate: i.issueDate.toISOString(), xSpaceUrl: i.xSpaceUrl ?? null, sections: i.sections }))
    .digest("hex");
}
