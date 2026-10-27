import { describe, it, expect } from "vitest";
import { buildJoinHref, cleanFreeText, parseMafiaJoinParams } from "./mafia-join-params";

const q = (s: string) => new URLSearchParams(s);
const ORIGIN = { kind: "character" as const, person: "Vito Corleone", film: "The Godfather" };

describe("parseMafiaJoinParams", () => {
  it("is null without from=mafia-name, so plain /join is untouched", () => {
    expect(parseMafiaJoinParams(q(""))).toBeNull();
    expect(parseMafiaJoinParams(q("name=Tony&topping=Basil&film=godfather"))).toBeNull();
    expect(parseMafiaJoinParams(q("from=other&name=Tony"))).toBeNull();
  });

  it("is null when the name is missing or sanitizes to nothing", () => {
    expect(parseMafiaJoinParams(q("from=mafia-name"))).toBeNull();
    expect(parseMafiaJoinParams(q("from=mafia-name&name=" + encodeURIComponent("🍕🍕")))).toBeNull();
  });

  it("accepts a catalog film id and a known topping (case-insensitive)", () => {
    expect(parseMafiaJoinParams(q("from=mafia-name&name=Pepperoni%20Corleone&topping=pepperoni&film=godfather"))).toEqual({
      name: "Pepperoni Corleone",
      topping: "Pepperoni",
      filmTitle: "The Godfather",
      filmId: "godfather",
    });
  });

  it("sanitizes the name and caps free-text topping and film", () => {
    const topping = "x".repeat(200);
    const film = "My <b>Film</b>\u0000​" + "y".repeat(300);
    const r = parseMafiaJoinParams(
      q(`from=mafia-name&name=${encodeURIComponent("Tony™ <script>")}&topping=${topping}&film=${encodeURIComponent(film)}`),
    )!;
    expect(r.name).not.toMatch(/[<>™]/);
    expect(r.topping).toHaveLength(50);
    expect(r.filmTitle.length).toBeLessThanOrEqual(120);
    expect(r.filmTitle).not.toMatch(/[<>\u0000​]/);
    expect(r.filmId).toBeUndefined();
  });

  it("keeps a well-formed origin + signature and drops malformed ones", () => {
    const o = JSON.stringify({ ...ORIGIN, sig: "abc_DEF-123" });
    const ok = parseMafiaJoinParams(q(`from=mafia-name&name=Tony&o=${encodeURIComponent(o)}`))!;
    expect(ok.origin).toEqual(ORIGIN);
    expect(ok.sig).toBe("abc_DEF-123");
    for (const bad of [
      "not json",
      JSON.stringify({ ...ORIGIN, kind: "wizard", sig: "abc" }),
      JSON.stringify({ ...ORIGIN, sig: "has space!" }),
      JSON.stringify({ ...ORIGIN }),
      JSON.stringify({ ...ORIGIN, sig: "a".repeat(700) }),
    ]) {
      const r = parseMafiaJoinParams(q(`from=mafia-name&name=Tony&o=${encodeURIComponent(bad)}`))!;
      expect(r.origin).toBeUndefined();
      expect(r.sig).toBeUndefined();
      expect(r.name).toBe("Tony");
    }
  });
});

describe("buildJoinHref", () => {
  it("round-trips through parseMafiaJoinParams", () => {
    const href = buildJoinHref({ name: "Pepperoni Corleone", topping: "Pepperoni", filmId: "godfather", origin: ORIGIN, sig: "sig_1" });
    expect(href.startsWith("/join?")).toBe(true);
    const parsed = parseMafiaJoinParams(new URL(href, "http://x").searchParams)!;
    expect(parsed).toMatchObject({ name: "Pepperoni Corleone", topping: "Pepperoni", filmId: "godfather", origin: ORIGIN, sig: "sig_1" });
  });

  it("carries a free-text film title when there is no catalog id", () => {
    const href = buildJoinHref({ name: "Tony", filmTitle: "Some Film" });
    expect(new URL(href, "http://x").searchParams.get("film")).toBe("Some Film");
  });
});

describe("cleanFreeText", () => {
  it("handles non-strings", () => {
    expect(cleanFreeText(undefined, 10)).toBe("");
    expect(cleanFreeText(42, 10)).toBe("");
  });
});
