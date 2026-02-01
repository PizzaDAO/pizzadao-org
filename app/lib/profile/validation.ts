export interface ProfilePayload {
  memberId: string;
  mafiaName: string;
  city: string;
  topping: string;
  crews: string[];
  turtles: string[];
  telegram?: string;
  skills?: string;
  mafiaMovieTitle?: string;
  resolvedMovieTitle?: string;
  tmdbMovieId?: string;
  releaseDate?: string;
  mediaType?: "movie" | "tv";
  discordJoined: boolean;
}

function clampStr(s: unknown, max: number): string {
  const t = String(s ?? "").trim().replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max) : t;
}

function clampBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

export function validateProfilePayload(body: any): ProfilePayload {
  const submittedTurtles = Array.isArray(body.turtles)
    ? body.turtles.map((x: unknown) => clampStr(x, 40)).filter(Boolean)
    : [];

  const crewsArr = Array.isArray(body.crews)
    ? body.crews.map((x: unknown) => clampStr(x, 40)).filter(Boolean)
    : [];

  // Validate mediaType
  const mediaType = body.mediaType === "movie" || body.mediaType === "tv" ? body.mediaType : undefined;

  return {
    memberId: clampStr(body.memberId ?? "", 20),
    mafiaName: clampStr(body.mafiaName, 64),
    city: clampStr(body.city, 120),
    topping: clampStr(body.topping, 50),
    crews: crewsArr,
    turtles: submittedTurtles,
    telegram: body.telegram ? clampStr(body.telegram, 80) : undefined,
    skills: body.skills ? clampStr(body.skills, 500) : undefined,
    mafiaMovieTitle: clampStr(body.mafiaMovieTitle, 120),
    resolvedMovieTitle: clampStr(body.resolvedMovieTitle, 120),
    tmdbMovieId: clampStr(body.tmdbMovieId, 30),
    releaseDate: clampStr(body.releaseDate, 20),
    mediaType,
    discordJoined: clampBool(body.discordJoined),
  };
}
