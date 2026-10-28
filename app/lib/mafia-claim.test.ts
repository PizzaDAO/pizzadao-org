import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/app/lib/db", () => ({ prisma: { mafiaNameClaim: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));

import { getPublicClaim } from "./mafia-claim";

const row = {
  id: "abcdefghij",
  public: true,
  name: "Pepperoni Corleone",
  topping: "Pepperoni",
  filmTitle: "The Godfather",
  origin: { kind: "character", person: "Vito Corleone", film: "The Godfather" },
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  portrait: { url: "https://blob/p.webp" },
};

describe("getPublicClaim", () => {
  beforeEach(() => {
    findUnique.mockReset();
  });

  it("returns only public fields", async () => {
    findUnique.mockResolvedValue({ ...row, discordId: "999" });
    const claim = await getPublicClaim("abcdefghij");
    expect(claim).toMatchObject({ name: "Pepperoni Corleone", portraitUrl: "https://blob/p.webp" });
    expect(JSON.stringify(claim)).not.toContain("999");
  });

  it("is null for a claim that is not public (typed/kept name)", async () => {
    findUnique.mockResolvedValue({ ...row, public: false });
    expect(await getPublicClaim("abcdefghij")).toBeNull();
  });

  it("is null for unknown or malformed ids without querying", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getPublicClaim("abcdefghij")).toBeNull();
    findUnique.mockClear();
    expect(await getPublicClaim("../etc")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
