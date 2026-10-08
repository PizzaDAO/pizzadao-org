import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ get: vi.fn(), transaction: vi.fn(), lock: vi.fn() }));
vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: { values: { get: mocks.get } } }) } }));
vi.mock("./google-auth", () => ({ getGoogleAuth: vi.fn(), GOOGLE_SCOPES: { sheetsReadonly: "readonly" } }));
vi.mock("./db", () => ({ prisma: { $transaction: mocks.transaction } }));
import { nextMemberId, registerWithMemberId } from "./member-registration";

const roster = [["Crew"], ["ID", "Status", "Name", "City", "DiscordId"], [1, "", "One", "", "111"], [3, "", "Three", "", "333"]];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ data: { values: roster } });
  mocks.transaction.mockImplementation(callback => callback({ $executeRaw: mocks.lock }));
});
describe("automatic member registration", () => {
  it("selects the first available number and supports blank ID column headers", () => {
    expect(nextMemberId(roster, "222")).toBe("2");
    expect(nextMemberId([["", "Name", "City", "Discord ID"], [1, "One", "", "111"]], "222")).toBe("2");
  });
  it("refuses to register the same Discord account twice", () => {
    expect(() => nextMemberId(roster, "111")).toThrow("already have a member profile");
  });
  it("fails closed if headers or identity columns cannot be found", () => {
    expect(() => nextMemberId([], "222")).toThrow("headers");
    expect(() => nextMemberId([["ID", "Name", "City"]], "222")).toThrow("Discord ID");
  });
  it("holds the transaction lock across the live read and write", async () => {
    const write = vi.fn().mockResolvedValue({ ok: true });
    const result = await registerWithMemberId("222", write);
    expect(result).toEqual({ memberId: "2", result: { ok: true } });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[0]);
    expect(mocks.get.mock.invocationCallOrder[0]).toBeLessThan(write.mock.invocationCallOrder[0]);
    expect(write).toHaveBeenCalledWith("2");
  });
  it("does not write if the live read fails, and propagates a failed sheet write", async () => {
    const write = vi.fn();
    mocks.get.mockRejectedValueOnce(new Error("Sheets unavailable"));
    await expect(registerWithMemberId("222", write)).rejects.toThrow("Sheets unavailable");
    expect(write).not.toHaveBeenCalled();
    write.mockRejectedValueOnce(new Error("Write failed"));
    await expect(registerWithMemberId("222", write)).rejects.toThrow("Write failed");
  });
});
