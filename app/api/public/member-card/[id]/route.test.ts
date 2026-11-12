// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberById: vi.fn() }));
vi.mock("@/app/lib/missions", () => ({ getUserProgressSummary: vi.fn() }));
vi.mock("@/app/lib/mafia-points", () => ({ getMafiaRank: vi.fn() }));
vi.mock("@/app/lib/crew-mappings", () => ({ getCrewMappings: vi.fn() }));
vi.mock("@/app/lib/pfp", () => ({ resolvePfpUrlAsync: vi.fn() }));

import { GET, composeMemberCard, MEMBER_CARD_KEYS } from "./route";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { getUserProgressSummary } from "@/app/lib/missions";
import { getMafiaRank } from "@/app/lib/mafia-points";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { resolvePfpUrlAsync } from "@/app/lib/pfp";

const m = (f: unknown) => f as ReturnType<typeof vi.fn>;

const PRIVATE_ROW = {
  Name: "Test Maker",
  Crews: "ops, none",
  discordId: "111222333",
  Discord: "handle-private",
  Telegram: "@tg-private",
  Email: "x@example.com",
  Wallet: "0xabc0000000000000000000000000000000000001",
  Address: "1 Main St",
  City: "Nowhere",
};

const req = () => new Request("http://x") as never;

beforeEach(() => {
  vi.clearAllMocks();
  m(fetchMemberById).mockResolvedValue(PRIVATE_ROW);
  m(resolvePfpUrlAsync).mockResolvedValue("/pfp/1.png");
  m(getUserProgressSummary).mockResolvedValue({ currentLevel: 3, maxLevel: 8, approvedCount: 4, levelTitle: "Sous Chef" });
  m(getMafiaRank).mockResolvedValue({ rank: { name: "Made Man", minPoints: 100 } });
  m(getCrewMappings).mockResolvedValue({ crews: [{ id: "ops", label: "Ops", emoji: "🛠", turtles: [] }], cached: false });
});

describe("member card", () => {
  it("returns only the allow-listed public fields", async () => {
    const card = await composeMemberCard("1");
    expect(Object.keys(card!).sort()).toEqual([...MEMBER_CARD_KEYS].sort());
    expect(card).toMatchObject({
      memberId: "1",
      name: "Test Maker",
      level: 3,
      levelTitle: "Sous Chef",
      mafiaRank: "Made Man",
      crews: [{ id: "ops", label: "Ops", emoji: "🛠" }],
    });
  });

  it("never leaks private row fields in the HTTP body", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "77" }) });
    expect(res.status).toBe(200);
    const body = await res.text();
    for (const secret of ["111222333", "handle-private", "tg-private", "example.com", "0xabc", "Main St", "Nowhere"]) {
      expect(body).not.toContain(secret);
    }
    expect(res.headers.get("Cache-Control")).toContain("public");
  });

  it("omits level without approved progress and tolerates a failing rank", async () => {
    m(getUserProgressSummary).mockResolvedValue({ currentLevel: 1, approvedCount: 0 });
    m(getMafiaRank).mockRejectedValue(new Error("down"));
    const card = await composeMemberCard("2");
    expect(card).toMatchObject({ level: null, levelTitle: "", mafiaRank: null });
  });

  it("404s for an unknown member", async () => {
    m(fetchMemberById).mockResolvedValue(null);
    const res = await GET(req(), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });
});
