import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAFIA_FILMS } from "./mafia-films";
import { PIZZA_TOPPINGS } from "./topping-images";
import { filmCode, isValidFunnelCode, rerollCode, toppingCode } from "./mafia-funnel";
import { originLine } from "./name-origin";

const ACTIVATION_CODE = /^[a-z0-9_]{1,48}$/; // what recordActivation accepts

describe("funnel codes", () => {
  it("every catalog topping and film maps to a code recordActivation keeps", () => {
    for (const t of PIZZA_TOPPINGS) {
      expect(toppingCode(t)).toMatch(ACTIVATION_CODE);
      expect(toppingCode(t)).not.toBe("custom");
      expect(isValidFunnelCode("topping_picked", toppingCode(t))).toBe(true);
    }
    for (const f of MAFIA_FILMS) {
      expect(filmCode(f.title)).toMatch(ACTIVATION_CODE);
      expect(filmCode(f.title)).not.toBe("custom");
      expect(isValidFunnelCode("film_picked", filmCode(f.title))).toBe(true);
    }
  });

  it("free text collapses to custom so the vocabulary stays closed", () => {
    expect(toppingCode("Dragon fruit")).toBe("custom");
    expect(filmCode("My cousin's wedding video")).toBe("custom");
    expect(isValidFunnelCode("topping_picked", "dragon_fruit")).toBe(false);
    expect(isValidFunnelCode("film_picked", "anything")).toBe(false);
  });

  it("caps reroll codes", () => {
    expect(rerollCode(1)).toBe("r1");
    expect(rerollCode(99)).toBe("r10");
    expect(isValidFunnelCode("name_rerolled", "r10")).toBe(true);
    expect(isValidFunnelCode("name_rerolled", "r11")).toBe(false);
    expect(isValidFunnelCode("names_generated", "ok")).toBe(true);
    expect(isValidFunnelCode("names_generated", "x")).toBe(false);
  });
});

describe("originLine", () => {
  const t = vi.fn((key: string, v: { person: string; film: string }) => `${key}:${v.person}:${v.film}`);
  beforeEach(() => {
    t.mockClear();
  });

  it("picks the copy for each kind", () => {
    expect(originLine(t, { kind: "character", person: "Michael Corleone" }, "The Godfather")).toBe("originCharacter:Michael Corleone:The Godfather");
    expect(originLine(t, { kind: "director", person: "Martin Scorsese" }, "Goodfellas")).toBe("originDirector:Martin Scorsese:Goodfellas");
    expect(originLine(t, { kind: "iconic", person: "Soprano" }, "The Sopranos")).toBe("originIconic:Soprano:The Sopranos");
  });

  it("is empty when the origin or film is missing", () => {
    expect(originLine(t, undefined, "The Godfather")).toBe("");
    expect(originLine(t, { kind: "actor", person: "Al Pacino" }, " ")).toBe("");
    expect(t).not.toHaveBeenCalled();
  });
});
