// app/lib/name-origin.ts
//
// Where a generated mafia name came from ("From Michael Corleone · The
// Godfather"). Derived deterministically by app/api/namegen/route.ts from the
// cast and crew it already reads; no AI. Pure, so client, server and the
// certificate pages share it.

export const NAME_ORIGIN_KINDS = ["character", "actor", "director", "iconic"] as const;
export type NameOriginKind = (typeof NAME_ORIGIN_KINDS)[number];
export type NameOrigin = { kind: NameOriginKind; person: string };

/** An origin plus the film it is "from", as stored on a claim. */
export type NameOriginWithFilm = NameOrigin & { film: string };

type Translate = (key: string, values: { person: string; film: string }) => string;

/** i18n key (under `onboarding.name`) for each kind's "From {person} · {film}" line. */
export const ORIGIN_COPY_KEY: Record<NameOriginKind, string> = {
  character: "originCharacter",
  actor: "originActor",
  director: "originDirector",
  iconic: "originIconic",
};

export function originLine(t: Translate, origin: NameOrigin | undefined, film: string | undefined): string {
  const person = origin?.person.trim();
  const title = film?.trim();
  if (!origin || !person || !title) return "";
  return t(ORIGIN_COPY_KEY[origin.kind], { person, film: title });
}
