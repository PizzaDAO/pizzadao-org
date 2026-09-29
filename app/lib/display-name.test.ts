import { describe, it, expect } from "vitest";
import {
  sanitizeDisplayName,
  validateDisplayName,
  DISPLAY_NAME_MAX_LENGTH,
} from "./display-name";
import { validateProfilePayload } from "./profile/validation";

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

describe("sanitizeDisplayName", () => {
  it("keeps ordinary names unchanged", () => {
    expect(sanitizeDisplayName("Tony Pepperoni")).toBe("Tony Pepperoni");
    expect(sanitizeDisplayName("Don Corleone Jr.")).toBe("Don Corleone Jr.");
  });

  it("keeps the allowed punctuation set: ' - . &", () => {
    expect(sanitizeDisplayName("O'Brien-Smith & Co.")).toBe("O'Brien-Smith & Co.");
  });

  it("keeps non-Latin letters and accents", () => {
    expect(sanitizeDisplayName("José Müller")).toBe("José Müller");
    expect(sanitizeDisplayName("山田 太郎")).toBe("山田 太郎");
    expect(sanitizeDisplayName("Ωμέγα")).toBe("Ωμέγα");
    expect(sanitizeDisplayName("नमस्ते")).toBe("नमस्ते");
  });

  it("keeps numbers", () => {
    expect(sanitizeDisplayName("Agent 47")).toBe("Agent 47");
  });

  it("applies NFKC (full-width and stylised letters fold to plain)", () => {
    expect(sanitizeDisplayName("ＰＩＺＺＡ")).toBe("PIZZA");
    // Mathematical bold "Tony"
    expect(sanitizeDisplayName(cp(0x1d413, 0x1d428, 0x1d427, 0x1d432))).toBe("Tony");
    // Decomposed e + combining acute composes to é
    expect(sanitizeDisplayName("Jose" + cp(0x0301))).toBe("José");
  });

  it("normalises typographic apostrophes and dashes", () => {
    expect(sanitizeDisplayName("O’Malley")).toBe("O'Malley");
    expect(sanitizeDisplayName("Mary—Jane")).toBe("Mary-Jane");
  });

  it("strips zero-width and bidi control characters", () => {
    const zw = [0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad];
    for (const c of zw) {
      expect(sanitizeDisplayName(`Big${cp(c)}Tony`)).toBe("BigTony");
    }
    // Right-to-left override used to spoof names
    expect(sanitizeDisplayName(`${cp(0x202e)}ynoT`)).toBe("ynoT");
  });

  it("turns control whitespace into single spaces", () => {
    expect(sanitizeDisplayName("Big\tTony\n\nSoprano")).toBe("Big Tony Soprano");
    expect(sanitizeDisplayName("  lots   of    space  ")).toBe("lots of space");
    expect(sanitizeDisplayName(`a${cp(0x00a0)}b`)).toBe("a b");
  });

  it("strips other control characters", () => {
    expect(sanitizeDisplayName(`Big${cp(0x0007)}Tony${cp(0x007f)}`)).toBe("BigTony");
  });

  it("strips emoji, symbols and disallowed punctuation", () => {
    expect(sanitizeDisplayName("🍕 Pizza Tony 🍕")).toBe("Pizza Tony");
    expect(sanitizeDisplayName("<script>alert(1)</script>")).toBe("scriptalert1script");
    expect(sanitizeDisplayName("Tony!!! @ #1 $$$")).toBe("Tony 1");
    expect(sanitizeDisplayName('"Fat" Tony_')).toBe("Fat Tony");
  });

  it("strips invisible filler 'letters' used for blank names", () => {
    expect(sanitizeDisplayName(cp(0x3164, 0x3164))).toBe("");
    expect(sanitizeDisplayName(`Tony${cp(0x2800)}`)).toBe("Tony");
  });

  it("limits stacked combining marks (zalgo)", () => {
    const zalgo = "T" + cp(0x0301, 0x0302, 0x0303, 0x0304, 0x0305) + "ony";
    const out = sanitizeDisplayName(zalgo);
    expect(Array.from(out).length).toBe(6); // T + 2 marks + o n y
    expect(out.startsWith("T")).toBe(true);
    expect(out.endsWith("ony")).toBe(true);
  });

  it(`caps length at ${DISPLAY_NAME_MAX_LENGTH} code points`, () => {
    const long = "a".repeat(200);
    expect(sanitizeDisplayName(long)).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
    // No trailing space after truncation
    const spaced = "a".repeat(63) + " bcdef";
    expect(sanitizeDisplayName(spaced)).toBe("a".repeat(63));
    // Astral characters count as one and are never split
    const astral = "山".repeat(10) + cp(0x20000).repeat(100);
    const out = sanitizeDisplayName(astral);
    expect(Array.from(out)).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("returns empty for nothing usable", () => {
    expect(sanitizeDisplayName("")).toBe("");
    expect(sanitizeDisplayName("   ")).toBe("");
    expect(sanitizeDisplayName(null)).toBe("");
    expect(sanitizeDisplayName(undefined)).toBe("");
    expect(sanitizeDisplayName("🍕🍕🍕")).toBe("");
    expect(sanitizeDisplayName("- . & '")).toBe("");
    expect(sanitizeDisplayName(cp(0x200b, 0x200b))).toBe("");
  });

  it("coerces non-strings", () => {
    expect(sanitizeDisplayName(42)).toBe("42");
  });

  it("is idempotent", () => {
    const inputs = ["🍕 O’Brien   & Sons!!", "ＴＯＮＹ", "José" + cp(0x200b) + " Müller"];
    for (const i of inputs) {
      const once = sanitizeDisplayName(i);
      expect(sanitizeDisplayName(once)).toBe(once);
    }
  });
});

describe("validateDisplayName", () => {
  it("accepts a valid name and returns the normalised form", () => {
    expect(validateDisplayName("  Tony  🍕 ")).toEqual({ ok: true, name: "Tony" });
  });

  it("rejects empty results", () => {
    const r = validateDisplayName("🍕");
    expect(r.ok).toBe(false);
  });
});

describe("validateProfilePayload", () => {
  it("normalises mafiaName with the shared sanitizer", () => {
    const p = validateProfilePayload({ mafiaName: "  🍕 Big​Tony  " });
    expect(p.mafiaName).toBe("BigTony");
  });
});
