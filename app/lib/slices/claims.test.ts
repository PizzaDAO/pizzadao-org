// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  callAttendance: { findMany: vi.fn(), findFirst: vi.fn() },
  attendanceNftCall: { findUnique: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
  attendanceNftClaim: { findMany: vi.fn(), create: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
}));
vi.mock("@/app/lib/db", () => ({ prisma: db }));
const sheet = vi.hoisted(() => ({ fetchMemberIdByDiscordId: vi.fn(), getEvmWalletsReadOnly: vi.fn() }));
vi.mock("@/app/lib/sheets/member-repository", () => ({ fetchMemberIdByDiscordId: sheet.fetchMemberIdByDiscordId }));
vi.mock("@/app/lib/wallet-lookup", () => ({ getEvmWalletsReadOnly: sheet.getEvmWalletsReadOnly }));

import { claimActivationCode, claimSlices, dayKey, isValidDayKey, listSlices, promoteAwaitingWallet, retryClaim } from "./claims";

const WALLET = "0x" + "cd".repeat(20);
const day = new Date("2026-10-27T00:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  sheet.fetchMemberIdByDiscordId.mockResolvedValue("m1");
  sheet.getEvmWalletsReadOnly.mockResolvedValue([WALLET]);
  db.callAttendance.findFirst.mockResolvedValue({ crewLabel: "Ops" });
  db.attendanceNftCall.findUnique.mockResolvedValue({ id: 7, imageUrl: "https://img" });
  db.attendanceNftClaim.create.mockResolvedValue({});
});

describe("helpers", () => {
  it("dayKey / isValidDayKey / activation code", () => {
    expect(dayKey(new Date("2026-10-27T23:59:00Z"))).toBe("2026-10-27");
    expect(isValidDayKey("2026-10-27")).toBe(true);
    expect(isValidDayKey("2026-13-40")).toBe(false);
    expect(isValidDayKey("nope")).toBe(false);
    expect(claimActivationCode("Community Call", "2026-10-27")).toMatch(/^[a-z0-9_]{1,48}$/);
  });
});

describe("claimSlices", () => {
  it("rejects bad input", async () => {
    expect(await claimSlices("d1", [{ crewId: "ops", callDay: "bad" }])).toEqual({ ok: false, reason: "invalid" });
    expect(await claimSlices("d1", [])).toEqual({ ok: false, reason: "invalid" });
  });

  it("requires attendance", async () => {
    db.callAttendance.findFirst.mockResolvedValue(null);
    expect(await claimSlices("d1", [{ crewId: "ops", callDay: "2026-10-27" }])).toEqual({ ok: false, reason: "not_attended" });
    expect(db.attendanceNftClaim.create).not.toHaveBeenCalled();
  });

  it("queues the claim for a member with a wallet", async () => {
    const res = await claimSlices("d1", [{ crewId: "ops", callDay: "2026-10-27" }]);
    expect(res).toMatchObject({ ok: true, claimed: 1, already: 0, hasWallet: true });
    expect(db.attendanceNftClaim.create).toHaveBeenCalledWith({ data: { discordId: "d1", memberId: "m1", callId: 7, status: "QUEUED", recipient: WALLET, chainId: 8453 } });
  });

  it("claims without a wallet as AWAITING_WALLET", async () => {
    sheet.getEvmWalletsReadOnly.mockResolvedValue([]);
    const res = await claimSlices("d1", [{ crewId: "ops", callDay: "2026-10-27" }]);
    expect(res).toMatchObject({ ok: true, claimed: 1, hasWallet: false });
    expect(db.attendanceNftClaim.create.mock.calls[0][0].data).toMatchObject({ status: "AWAITING_WALLET", recipient: null });
  });

  it("is idempotent: a unique violation counts as already claimed", async () => {
    db.attendanceNftClaim.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed 23505"), {}));
    const res = await claimSlices("d1", [{ crewId: "ops", callDay: "2026-10-27" }]);
    expect(res).toMatchObject({ ok: true, claimed: 0, already: 1 });
  });

  it("creates the call row on first claim and reports it for image rendering", async () => {
    db.attendanceNftCall.findUnique.mockResolvedValue(null);
    db.attendanceNftCall.create.mockResolvedValue({ id: 9, imageUrl: null });
    const res = await claimSlices("d1", [{ crewId: "ops", callDay: "2026-10-27" }]);
    expect(res).toMatchObject({ ok: true, newCallIds: [9] });
    expect(db.attendanceNftCall.create).toHaveBeenCalledWith({ data: { crewId: "ops", crewLabel: "Ops", callDay: day } });
  });

  it("claim all only takes claimable calls", async () => {
    db.callAttendance.findMany.mockResolvedValue([
      { crewId: "ops", crewLabel: "Ops", callDate: day },
      { crewId: "comms", crewLabel: "Comms", callDate: day },
    ]);
    db.attendanceNftClaim.findMany.mockResolvedValue([
      { status: "MINTED", txHash: "0xh", call: { id: 1, crewId: "comms", callDay: day, imageUrl: null } },
    ]);
    const res = await claimSlices("d1", null);
    expect(res).toMatchObject({ ok: true, claimed: 1, claimedKeys: [{ crewId: "ops", callDay: "2026-10-27" }] });
  });
});

describe("listSlices", () => {
  it("merges attendance with claims and dedupes crew+day", async () => {
    db.callAttendance.findMany.mockResolvedValue([
      { crewId: "ops", crewLabel: "Ops", callDate: day },
      { crewId: "ops", crewLabel: "Ops", callDate: new Date("2026-10-27T10:00:00Z") },
      { crewId: "comms", crewLabel: "Comms", callDate: day },
    ]);
    db.attendanceNftClaim.findMany.mockResolvedValue([
      { status: "SUBMITTED", txHash: "0xh", call: { id: 4, crewId: "ops", callDay: day, imageUrl: "https://i" } },
    ]);
    const items = await listSlices("d1");
    expect(items.map((i) => [i.crewId, i.status])).toEqual([["ops", "minting"], ["comms", "claimable"]]);
    expect(items[0]).toMatchObject({ tokenId: 4, imageUrl: "https://i" });
    expect(items[0].txUrl).toBeUndefined(); // only once minted
  });
});

describe("promoteAwaitingWallet / retry", () => {
  it("queues waiting claims once a wallet exists", async () => {
    db.attendanceNftClaim.count.mockResolvedValue(2);
    db.attendanceNftClaim.updateMany.mockResolvedValue({ count: 2 });
    expect(await promoteAwaitingWallet("d1")).toBe(2);
    expect(db.attendanceNftClaim.updateMany).toHaveBeenCalledWith({
      where: { discordId: "d1", status: "AWAITING_WALLET" },
      data: { status: "QUEUED", recipient: WALLET, memberId: "m1" },
    });
  });

  it("does nothing without a wallet or without waiting claims", async () => {
    db.attendanceNftClaim.count.mockResolvedValue(0);
    expect(await promoteAwaitingWallet("d1")).toBe(0);
    db.attendanceNftClaim.count.mockResolvedValue(1);
    sheet.getEvmWalletsReadOnly.mockResolvedValue([]);
    expect(await promoteAwaitingWallet("d1")).toBe(0);
    expect(db.attendanceNftClaim.updateMany).not.toHaveBeenCalled();
  });

  it("retryClaim only touches FAILED rows", async () => {
    db.attendanceNftClaim.updateMany.mockResolvedValue({ count: 1 });
    expect(await retryClaim("c1")).toBe(true);
    expect(db.attendanceNftClaim.updateMany.mock.calls[0][0].where).toEqual({ id: "c1", status: "FAILED" });
  });
});
