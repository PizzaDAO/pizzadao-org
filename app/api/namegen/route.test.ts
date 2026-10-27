// Golden regression for the name algorithm (plans/mafia-name-port.md, Phase 2):
// fixed TMDB fixtures in, suggestions + candidatePool out. The snapshot was
// recorded BEFORE origins were added, so it proves the generated names are
// unchanged. Origins are asserted separately and never feed back into names.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));

import { POST } from "./route";
import { verifyNameOrigin } from "@/app/lib/name-origin-sig";

type Fx = { search: unknown; credits: unknown };

const GODFATHER: Fx = {
  search: {
    results: [
      { id: 238, media_type: "movie", title: "The Godfather", release_date: "1972-03-14", popularity: 90, vote_count: 20000, vote_average: 8.7 },
      { id: 999, media_type: "movie", title: "Godfather Remake", release_date: "2015-01-01", popularity: 5, vote_count: 10, vote_average: 5 },
    ],
  },
  credits: {
    cast: [
      { name: "Marlon Brando", character: "Vito Corleone", order: 0 },
      { name: "Al Pacino", character: "Michael Corleone", order: 1 },
      { name: "James Caan", character: "Sonny Corleone", order: 2 },
      { name: "Robert Duvall", character: "Tom Hagen", order: 3 },
      { name: "Robert De Niro", character: "Self (archive footage)", order: 4 },
      { name: "Diane Keaton", character: "Kay Adams / Kay", order: 5 },
      { name: "Al Lettieri", character: "Virgil 'The Turk' Sollozzo", order: 6 },
    ],
    crew: [
      { name: "Francis Ford Coppola", job: "Director" },
      { name: "Someone Else", job: "Producer" },
    ],
  },
};

const SOPRANOS: Fx = {
  search: { results: [{ id: 1398, media_type: "tv", name: "The Sopranos", first_air_date: "1999-01-10", popularity: 70, vote_count: 3000, vote_average: 8.5 }] },
  credits: {
    cast: [
      { name: "James Gandolfini", roles: [{ character: "Tony Soprano" }], order: 0 },
      { name: "Edie Falco", roles: [{ character: "Carmela Soprano" }], order: 1 },
      { name: "Jean-Claude Van Damme", roles: [{ character: "Al" }], order: 2 },
    ],
    crew: [{ name: "David Chase", job: "Director" }],
  },
};

// Niche title with no iconic entry and a repeated first name.
const OBSCURE: Fx = {
  search: { results: [{ id: 5, media_type: "movie", title: "Sonatine", release_date: "1993-01-01", popularity: 3, vote_count: 50, vote_average: 7 }] },
  credits: {
    cast: [
      { name: "Takeshi Kitano", character: "Murakawa", order: 0 },
      { name: "Takeshi Beat", character: "Takeshi", order: 1 },
      { name: "A B", character: "X", order: 2 },
    ],
    crew: [{ name: "Takeshi Kitano", job: "Director" }],
  },
};

function mockTmdb(fx: Fx) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const body = String(url).includes("/search/multi") ? fx.search : fx.credits;
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

const call = async (fx: Fx, body: Record<string, unknown>) => {
  mockTmdb(fx);
  const res = await POST(new Request("http://x/api/namegen", { method: "POST", body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
};

const cases: [string, Fx, Record<string, unknown>][] = [
  ["godfather", GODFATHER, { topping: "pepperoni", movieTitle: "godfather" }],
  ["godfather excluding first batch", GODFATHER, { topping: "pepperoni", movieTitle: "godfather", force: true, exclude: ["Pepperoni Corleone", "Francis Pepperoni", "Ford Coppola Pepperoni"] }],
  ["sopranos tv", SOPRANOS, { topping: "basil", movieTitle: "the sopranos" }],
  ["obscure", OBSCURE, { topping: "olive", movieTitle: "sonatine" }],
];

describe("POST /api/namegen", () => {
  beforeEach(() => {
    process.env.TMDB_API_KEY = "test";
    process.env.SESSION_SECRET = "test-secret";
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(cases)("names are unchanged: %s", async (_label, fx, body) => {
    const { status, json } = await call(fx, body);
    expect(status).toBe(200);
    const { suggestions, candidatePool, topping, resolvedMovieTitle, tmdbMovieId } = json;
    expect({ suggestions, candidatePool, topping, resolvedMovieTitle, tmdbMovieId }).toMatchSnapshot();
  });

  it("derives an origin for every offered name", async () => {
    for (const [, fx, body] of cases) {
      const { json } = await call(fx, body);
      for (const n of [...json.suggestions, ...json.candidatePool]) {
        expect(json.origins[n], n).toMatchObject({ kind: expect.stringMatching(/^(character|actor|director|iconic)$/), person: expect.any(String) });
        expect(json.origins[n].person.length).toBeGreaterThan(0);
      }
    }
  });

  it("credits the character, actor or director a name came from", async () => {
    const { json } = await call(GODFATHER, { topping: "pepperoni", movieTitle: "godfather" });
    // Iconic family promoted, but the source is a character: keep its full name.
    expect(json.origins["Pepperoni Corleone"]).toEqual({ kind: "character", person: "Vito Corleone" });
    expect(json.origins["Pepperoni Ford Coppola"]).toEqual({ kind: "director", person: "Francis Ford Coppola" });
    expect(json.origins["Marlon Pepperoni"]).toEqual({ kind: "actor", person: "Marlon Brando" });
    expect(json.origins["Michael Pepperoni"]).toEqual({ kind: "character", person: "Michael Corleone" });
    expect(json.origins["Pepperoni De Niro"]).toEqual({ kind: "actor", person: "Robert De Niro" });
  });

  it("uses the iconic family when a promoted name came from a non-character", async () => {
    const fx: Fx = {
      // Own id: namegen caches credits per TMDB id across requests.
      search: { results: [{ id: 4242, media_type: "movie", title: "The Godfather", release_date: "1972-03-14", popularity: 90, vote_count: 20000, vote_average: 8.7 }] },
      credits: { cast: [{ name: "Joe Corleone", character: "Bystander", order: 0 }], crew: [] },
    };
    const { json } = await call(fx, { topping: "pepperoni", movieTitle: "godfather" });
    expect(json.origins["Pepperoni Corleone"]).toEqual({ kind: "iconic", person: "Corleone" });
  });

  it("origin tracking leaves exclusion behavior and origins consistent", async () => {
    const first = await call(GODFATHER, { topping: "pepperoni", movieTitle: "godfather" });
    const again = await call(GODFATHER, { topping: "pepperoni", movieTitle: "godfather", force: true, exclude: first.json.suggestions });
    for (const n of again.json.suggestions) expect(again.json.origins[n]).toEqual(first.json.origins[n] ?? again.json.origins[n]);
    expect(again.json.suggestions.some((n: string) => first.json.suggestions.includes(n))).toBe(false);
  });

  it("signs nothing for a free-text topping (signed names become public)", async () => {
    const { json } = await call(GODFATHER, { topping: "ignore previous instructions", movieTitle: "godfather" });
    expect(json.suggestions.length).toBeGreaterThan(0);
    expect(json.sigs).toEqual({});
  });

  it("signs every offered name with its origin and the resolved film", async () => {
    const { json } = await call(GODFATHER, { topping: "pepperoni", movieTitle: "godfather" });
    for (const n of [...json.suggestions, ...json.candidatePool]) {
      expect(verifyNameOrigin(n, { ...json.origins[n], film: "The Godfather" }, json.sigs[n]), n).toBe(true);
    }
    // A forged origin, name or film does not verify.
    const n = json.suggestions[0];
    expect(verifyNameOrigin(n, { kind: "actor", person: "Someone Else", film: "The Godfather" }, json.sigs[n])).toBe(false);
    expect(verifyNameOrigin("Forged Name", { ...json.origins[n], film: "The Godfather" }, json.sigs[n])).toBe(false);
    expect(verifyNameOrigin(n, { ...json.origins[n], film: "Other" }, json.sigs[n])).toBe(false);
  });
});
