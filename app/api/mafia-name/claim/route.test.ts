import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
const findUnique = vi.fn();
const findFirst = vi.fn();
const count = vi.fn();
const create = vi.fn();
const update = vi.fn();
const recordLater = vi.fn();

vi.mock("@/app/lib/session", () => ({ getSession: () => getSession() }));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    mafiaNameClaim: {
      findUnique: (...a: unknown[]) => findUnique(...a),
      count: (...a: unknown[]) => count(...a),
      create: (...a: unknown[]) => create(...a),
      update: (...a: unknown[]) => update(...a),
    },
    mafiaPortrait: { findFirst: (...a: unknown[]) => findFirst(...a) },
  },
}));
vi.mock("@/app/lib/rate-limit", () => ({ enforceRateLimit: async () => null }));
vi.mock("@/app/lib/activation", () => ({ recordActivationLater: (...a: unknown[]) => recordLater(...a) }));

import { Prisma } from "@prisma/client";
import { POST } from "./route";
import { signNameOrigin } from "@/app/lib/name-origin-sig";

process.env.SESSION_SECRET = "test-secret";
const ORIGIN = { kind: "character" as const, person: "Vito Corleone", film: "The Godfather" };
const sig = (name = "Pepperoni Corleone") => signNameOrigin(name, ORIGIN)!;

const body = (o: Record<string, unknown> = {}) =>
  new Request("http://x/api/mafia-name/claim", {
    method: "POST",
    body: JSON.stringify({
      name: "Pepperoni Corleone",
      topping: "Pepperoni",
      filmId: "godfather",
      tmdbMovieId: "238",
      origin: ORIGIN,
      originSig: sig(),
      candidates: ["Pepperoni Corleone", "Francis Pepperoni"],
      ...o,
    }),
  });

describe("POST /api/mafia-name/claim", () => {
  beforeEach(() => {
    for (const m of [getSession, findUnique, findFirst, count, create, update, recordLater]) m.mockReset();
    getSession.mockResolvedValue({ discordId: "123" });
    findUnique.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);
    count.mockResolvedValue(0);
    create.mockImplementation(async ({ data }: { data: { id: string } }) => ({ id: data.id }));
  });

  it("401 without a session", async () => {
    getSession.mockResolvedValue(null);
    expect((await POST(body())).status).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });

  it("400 for an invalid body or a name that sanitizes to nothing", async () => {
    expect((await POST(body({ origin: { kind: "wizard", person: "x", film: "y" } }))).status).toBe(400);
    expect((await POST(body({ name: "🍕🍕" }))).status).toBe(400);
    expect((await POST(new Request("http://x", { method: "POST", body: "nope" }))).status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a claim with an unguessable id and records the funnel event", async () => {
    findFirst.mockResolvedValue({ id: "portrait-1" });
    const res = await POST(body({ portraitUrl: "https://blob/p.webp" }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    expect(id).toMatch(/^[A-Za-z0-9_-]{10}$/);
    expect(create).toHaveBeenCalledTimes(1);
    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      id,
      discordId: "123",
      name: "Pepperoni Corleone",
      topping: "Pepperoni",
      filmId: "godfather",
      filmTitle: "The Godfather",
      tmdbMovieId: "238",
      portraitId: "portrait-1",
      origin: { kind: "character", person: "Vito Corleone", film: "The Godfather" },
      candidates: ["Pepperoni Corleone", "Francis Pepperoni"],
    });
    expect(recordLater).toHaveBeenCalledWith("name_claimed", { discordId: "123", code: "ok" });
  });

  it("does not link a portrait url the portrait route never issued", async () => {
    await POST(body({ portraitUrl: "https://evil/x.png" }));
    expect(create.mock.calls[0][0].data).not.toHaveProperty("portraitId");
  });

  it("is idempotent per member + name: a repeat updates the same row", async () => {
    findUnique.mockResolvedValue({ id: "abcdefghij" });
    findFirst.mockResolvedValue({ id: "portrait-2" });
    const res = await POST(body({ portraitUrl: "https://blob/p2.webp" }));
    expect(await res.json()).toEqual({ id: "abcdefghij", public: true });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ portraitId: "portrait-2" }) }));
  });

  it("keeps the existing portrait when a repeat carries none", async () => {
    findUnique.mockResolvedValue({ id: "abcdefghij" });
    await POST(body());
    expect(update.mock.calls[0][0].data).not.toHaveProperty("portraitId");
  });

  it("recovers from a create race on (discordId, name)", async () => {
    findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: "winnerid01" });
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" }));
    const res = await POST(body());
    expect(await res.json()).toEqual({ id: "winnerid01", public: true });
  });

  it("429 once a member has too many claims", async () => {
    count.mockResolvedValue(20);
    expect((await POST(body())).status).toBe(429);
    expect(create).not.toHaveBeenCalled();
  });

  it("marks a signed suggestion public and keeps its origin", async () => {
    const res = await POST(body());
    expect(await res.json()).toMatchObject({ public: true });
    expect(create.mock.calls[0][0].data).toMatchObject({ public: true, origin: ORIGIN });
  });

  it("stores typed/kept names privately with no origin (no signature)", async () => {
    const res = await POST(body({ originSig: undefined }));
    expect(await res.json()).toMatchObject({ public: false });
    const data = create.mock.calls[0][0].data;
    expect(data.public).toBe(false);
    expect(data.origin).toBe(Prisma.DbNull);
  });

  it("rejects a forged origin or a signature for a different name", async () => {
    await POST(body({ origin: { ...ORIGIN, person: "Forged Person" } }));
    await POST(body({ name: "Some Other Name" }));
    expect(create).toHaveBeenCalledTimes(2);
    for (const [call] of create.mock.calls) expect(call.data).toMatchObject({ public: false, origin: Prisma.DbNull });
  });

  it("derives origin.film from the catalog when the film id is known", async () => {
    const o = { ...ORIGIN, film: "Godfather" };
    await POST(body({ origin: o, originSig: signNameOrigin("Pepperoni Corleone", o)! }));
    expect(create.mock.calls[0][0].data.origin.film).toBe("The Godfather");
  });

  it("only links a portrait owned by the member or by nobody", async () => {
    await POST(body({ portraitUrl: "https://blob/p.webp" }));
    expect(findFirst.mock.calls[0][0].where).toEqual({ url: "https://blob/p.webp", OR: [{ discordId: "123" }, { discordId: null }] });
  });

  it("413 for an oversized body", async () => {
    expect((await POST(body({ candidates: ["x".repeat(20000)] }))).status).toBe(413);
  });
});
