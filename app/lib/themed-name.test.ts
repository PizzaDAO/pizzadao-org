import { describe, it, expect, vi, beforeEach } from "vitest";

const getSetting = vi.fn();
const findFirst = vi.fn();
vi.mock("@/app/lib/settings/toggles", () => ({ toggleEnabled: (k: string) => getSetting(k) }));
vi.mock("@/app/lib/db", () => ({ prisma: { mafiaNameClaim: { findFirst: (a: unknown) => findFirst(a) } } }));

import { isThemedName, themedNameAllowed } from "./themed-name";

beforeEach(() => {
  getSetting.mockReset();
  findFirst.mockReset();
});

describe("isThemedName", () => {
  it("accepts toppings and pizza words", () => {
    expect(isThemedName("Tony Pepperoni")).toBe(true);
    expect(isThemedName("Big Mushrooms")).toBe(true);
    expect(isThemedName("Hot Honey Harry")).toBe(true);
    expect(isThemedName("Calzone Carl")).toBe(true);
  });
  it("accepts real multi-word toppings as phrases", () => {
    expect(isThemedName("Spicy Salami Sam")).toBe(true);
    expect(isThemedName("Roasted Red Pepper Rick")).toBe(true);
    expect(isThemedName("Banana Peppers Bob")).toBe(true);
    expect(isThemedName("Chili Crisp Charlie")).toBe(true);
  });
  it("rejects generic single words", () => {
    for (const n of ["Red", "Hot Wheels", "Pie", "Ham", "Oven", "Spicy", "Roasted", "Banana"]) expect(isThemedName(n)).toBe(false);
  });
  it("rejects names with no pizza word", () => {
    expect(isThemedName("Summer Meetup 2026")).toBe(false);
    expect(isThemedName("Test")).toBe(false);
  });
});

describe("themedNameAllowed", () => {
  it("allows anything while the setting is off", async () => {
    getSetting.mockResolvedValue(false);
    expect(await themedNameAllowed({ name: "Whatever" })).toBe(true);
  });
  it("grandfathers the current name", async () => {
    getSetting.mockResolvedValue(true);
    expect(await themedNameAllowed({ name: "whatever", currentName: async () => "Whatever" })).toBe(true);
  });
  it("allows a generator-offered name", async () => {
    getSetting.mockResolvedValue(true);
    findFirst.mockResolvedValue({ id: "x" });
    expect(await themedNameAllowed({ name: "Vito Corleone", discordId: "1" })).toBe(true);
  });
  it("rejects free text otherwise", async () => {
    getSetting.mockResolvedValue(true);
    findFirst.mockResolvedValue(null);
    expect(await themedNameAllowed({ name: "Summer Meetup", discordId: "1" })).toBe(false);
  });
});
