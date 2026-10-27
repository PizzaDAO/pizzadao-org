// app/lib/mafia-claim.ts
// Public view of a claimed mafia name (plans/mafia-name-port.md, Phase 2).
// Only what /made/[id] may show: never discordId, never the real name.
import { randomBytes } from "crypto";
import { cache } from "react";
import { prisma } from "@/app/lib/db";
import { NAME_ORIGIN_KINDS, type NameOriginWithFilm } from "@/app/lib/name-origin";

export const CLAIM_ID_LENGTH = 10;
const CLAIM_ID_RE = new RegExp(`^[A-Za-z0-9_-]{${CLAIM_ID_LENGTH}}$`);

/** 10 chars of base64url = 60 bits of randomness: unguessable, URL-safe. */
export function newClaimId(): string {
  return randomBytes(8).toString("base64url").slice(0, CLAIM_ID_LENGTH);
}

export const isClaimId = (id: unknown): id is string => typeof id === "string" && CLAIM_ID_RE.test(id);

export type PublicClaim = {
  id: string;
  name: string;
  topping: string;
  filmTitle: string;
  origin: NameOriginWithFilm | null;
  portraitUrl: string | null;
  createdAt: Date;
};

/** Defensive: the column is Json, so re-validate before rendering. */
function readOrigin(raw: unknown): NameOriginWithFilm | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.person !== "string" || typeof o.film !== "string" || !o.person || !o.film) return null;
  if (!(NAME_ORIGIN_KINDS as readonly unknown[]).includes(o.kind)) return null;
  return { kind: o.kind as NameOriginWithFilm["kind"], person: o.person, film: o.film };
}

/** Deduped per request: the page and generateMetadata both call it. */
export const getPublicClaim = cache(async (id: string): Promise<PublicClaim | null> => {
  if (!isClaimId(id)) return null;
  const row = await prisma.mafiaNameClaim.findUnique({
    where: { id },
    select: {
      id: true,
      public: true,
      name: true,
      topping: true,
      filmTitle: true,
      origin: true,
      createdAt: true,
      portrait: { select: { url: true } },
    },
  });
  // Names that were typed, kept or taken from Discord are never published.
  if (!row || !row.public) return null;
  return {
    id: row.id,
    name: row.name,
    topping: row.topping,
    filmTitle: row.filmTitle,
    origin: readOrigin(row.origin),
    portraitUrl: row.portrait?.url ?? null,
    createdAt: row.createdAt,
  };
});
