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
    for (const n of ["Red", "Hot Wheels", "Pie", "Ham", "Oven", "Spicy", "Roasted"]) expect(isThemedName(n)).toBe(false);
  });
  it("accepts widened topping words, misspellings and emoji names", () => {
    for (const n of ["Steak Hill", "Indi Tandoori Paneer White", "Slevin Di Bufala", "Cherry Zemeckis",
      "Spinach Corleone", "Caprese Strait", "Don Jalepenos", "Banana 🍌✨", "Turkey Sausage 🦃",
      "Salame DeVito", "4 Quesos Soprano", "Tetsuo Tomato", "Big Tomatoes", "Jalepeno Joe"]) expect(isThemedName(n)).toBe(true);
  });
  it("accepts widened toppings in other languages", () => {
    for (const n of ["Piña Pete", "Pina Colada Pete", "Champiñon Carl", "Champinon Carl", "Cebolla Joe", "Pollo Paulie",
      "Jamón Johnny", "Jamon Johnny", "Albahaca Al", "Palmitos Pal", "Palmito Pal", "Provoleta Vic", "Calabresa Cal",
      "Rucula Ray", "Funghi Frank", "Napolitana Nick", "Napoletana Nick", "Stracciatella Sal", "Guanciale Gus",
      "Serrano Sid", "Capsicum Cat", "Chili Charlie", "Chilli Charlie", "Suya Sam", "Peri Peri Pete", "Peri-Peri Pete",
      "Pili Pili Pat", "Sardines Sal", "Sardine Sal", "Walnuts Wally", "Walnut Wally", "Aubergine Al", "Sourdough Sue",
      "Hotdog Harry", "Hot Dog Harry", "French Fries Fred", "Supreme Sue", "Suprema Sue", "Quattro Quinn",
      "Mexicana Max", "Menta Mel", "Jengibre Jo", "Ginger Gus", "Capparis Cap", "Capers Cap", "Marinara Mary",
      "Vegetables Vic", "Veggie Vic", "Meat Mike", "Pepperone Pat", "Chilorio Cho", "Chikanda Chi"]) expect(isThemedName(n)).toBe(true);
  });
  it("accepts misspelling aliases", () => {
    for (const n of ["Marguerita Mo", "Margarita Mo", "Pinnaple Pat", "Pinapple Pat", "Cheeze Chuck", "Guancciale Gus"]) expect(isThemedName(n)).toBe(true);
  });
  it("treats Don X as mafia-themed", () => {
    expect(isThemedName("Don Malbec")).toBe(true);
    expect(isThemedName("don malbec")).toBe(true);
    expect(isThemedName("Donald")).toBe(false);
    expect(isThemedName("Don")).toBe(false);
  });
  it("rejects more ordinary names", () => {
    for (const n of ["Irish Host", "Shem Hill", "TAIOSInc.com", "Chosen Maximilian", "Trainee"]) expect(isThemedName(n)).toBe(false);
  });
  it("rejects ordinary handles and names", () => {
    for (const n of ["kooluser", "yyykki", "Sampa", "wiredinsamurai", "dead_d00d", "Bronze", "karm", "Vishal", "Pharaoh ❥", "Ericnblockchain"]) expect(isThemedName(n)).toBe(false);
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
