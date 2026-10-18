import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const writeToSheet = vi.fn();
const getSheetData = vi.fn();
vi.mock("@/app/api/profile/route", () => ({ writeToSheet: (a: unknown) => writeToSheet(a) }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ getSheetData: (a: unknown) => getSheetData(a) }));
vi.mock("@/app/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) },
    roleGrantEvent: { upsert: vi.fn().mockResolvedValue({}) },
  },
}));

import { syncDiscordRolesToSheet } from "./discord-sheet-sync";

function sheetWith(name: string) {
  getSheetData.mockResolvedValue({
    discordToMember: new Map([["d1", "m1"]]),
    memberToIdx: new Map([["m1", 0]]),
    rows: [{ Name: name, Turtles: "" }],
  });
}

describe("syncDiscordRolesToSheet name fallback", () => {
  beforeEach(() => {
    writeToSheet.mockReset().mockResolvedValue({});
    process.env.DISCORD_GUILD_ID = "g";
    process.env.DISCORD_BOT_TOKEN = "b";
    process.env.GOOGLE_SHEETS_SHARED_SECRET = "s";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => (String(url).endsWith("/roles") ? [] : { roles: [], user: { username: "🍕__" } }),
      })),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("cleans the fallback name when the sheet Name is empty", async () => {
    sheetWith("");
    await syncDiscordRolesToSheet("d1", "🍕Tony™");
    expect(writeToSheet.mock.calls[0][0].mafiaName).toBe("Tony");
  });

  it("falls back to Unknown when nothing usable remains", async () => {
    sheetWith("");
    await syncDiscordRolesToSheet("d1", "🍕");
    expect(writeToSheet.mock.calls[0][0].mafiaName).toBe("Unknown");
  });

  it("leaves an existing sheet Name untouched (no backfill)", async () => {
    sheetWith("Old★Name");
    await syncDiscordRolesToSheet("d1", "Tony");
    expect(writeToSheet.mock.calls[0][0].mafiaName).toBe("Old★Name");
  });
});
