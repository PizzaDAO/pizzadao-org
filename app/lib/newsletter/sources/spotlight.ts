// app/lib/newsletter/sources/spotlight.ts
//
// Member spotlight (consented, shortlisted or featured submissions an admin picks from) and the
// city spotlight (an admin-picked city from the public cities list, plus notes).
import { prisma } from "@/app/lib/db";
import citiesData from "@/app/(marketing)/_site/data/pizzadao-cities.json";
import type { NewsletterSections } from "../sections";

export interface SpotlightRow {
  id: number;
  nomineeName: string;
  city: string | null;
  pitch: string;
  links: string[];
  photoUrl: string | null;
  consent: boolean;
  status: string;
}

export interface MemberCandidate {
  id: number;
  name: string;
  city: string;
  status: string;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);
const oneLine = (s: string) => s.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ").replace(/\s+/g, " ").trim();
const httpsOnly = (u: string | null | undefined) => (u && /^https:\/\//i.test(u.trim()) ? u.trim().slice(0, 500) : "");

/** Consented, shortlisted or featured, and not already used by a sent issue. */
export function eligibleSpotlights<T extends SpotlightRow>(rows: T[], usedIds: ReadonlySet<number>): T[] {
  return rows.filter((r) => r.consent === true && (r.status === "SHORTLISTED" || r.status === "FEATURED") && !usedIds.has(r.id));
}

export function memberCandidates(rows: SpotlightRow[], usedIds: ReadonlySet<number>): MemberCandidate[] {
  return eligibleSpotlights(rows, usedIds).map((r) => ({ id: r.id, name: oneLine(r.nomineeName), city: oneLine(r.city ?? ""), status: r.status }));
}

export function memberSection(row: SpotlightRow): NewsletterSections["member"] {
  return {
    enabled: true,
    submissionId: row.id,
    name: clip(oneLine(row.nomineeName), 120),
    city: clip(oneLine(row.city ?? ""), 120),
    blurb: clip(oneLine(row.pitch), 1500),
    links: row.links.map(httpsOnly).filter(Boolean).slice(0, 6),
    photoUrl: httpsOnly(row.photoUrl),
  };
}

const SPOTLIGHT_SELECT = { id: true, nomineeName: true, city: true, pitch: true, links: true, photoUrl: true, consent: true, status: true } as const;

/** Ids of spotlight submissions used by sent issues (sources.spotlightIds). */
export async function usedSpotlightIds(): Promise<Set<number>> {
  const sent = await prisma.newsletterIssue.findMany({ where: { status: "sent" }, select: { sources: true } });
  const ids = new Set<number>();
  for (const i of sent) {
    const list = (i.sources as { spotlightIds?: unknown } | null)?.spotlightIds;
    if (Array.isArray(list)) for (const v of list) if (typeof v === "number") ids.add(v);
  }
  return ids;
}

export async function loadMemberCandidates(): Promise<{ rows: SpotlightRow[]; candidates: MemberCandidate[] }> {
  const [used, rows] = await Promise.all([
    usedSpotlightIds(),
    prisma.spotlightSubmission.findMany({ where: { consent: true, status: { in: ["SHORTLISTED", "FEATURED"] } }, orderBy: { updatedAt: "desc" }, take: 100, select: SPOTLIGHT_SELECT }),
  ]);
  return { rows, candidates: memberCandidates(rows, used) };
}

/** One eligible submission by id (null when it is not eligible any more). */
export async function loadMemberSpotlight(id: number): Promise<SpotlightRow | null> {
  const [used, row] = await Promise.all([usedSpotlightIds(), prisma.spotlightSubmission.findUnique({ where: { id }, select: SPOTLIGHT_SELECT })]);
  return row && eligibleSpotlights([row], used).length ? row : null;
}

export interface CityOption {
  key: string;
  name: string;
}

interface CityRow {
  key?: string;
  name?: string;
}

/** The public cities, name-sorted, for the admin dropdown. */
export function cityOptions(data: CityRow[] = citiesData as CityRow[]): CityOption[] {
  const out: CityOption[] = [];
  const seen = new Set<string>();
  for (const c of data) {
    if (!c.key || !c.name || seen.has(c.key)) continue;
    seen.add(c.key);
    out.push({ key: c.key, name: oneLine(c.name) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function citySection(key: string, notes: string, options: CityOption[] = cityOptions()): NewsletterSections["city"] | null {
  const found = options.find((c) => c.key === key);
  if (!found) return null;
  return { enabled: true, cityKey: found.key, name: found.name, notes: clip(notes, 2000), blurb: "" };
}
