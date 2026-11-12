import { describe, expect, it } from 'vitest';
import { sanitizeDisplayName, sliceUnits, truncateForDiscordNick } from './display-name';

const PIZZA = '\u{1F355}';
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}';
const FLAG = '\u{1F1FA}\u{1F1F8}';
const THUMB = '\u{1F44D}\u{1F3FD}';
const KEYCAP = '1️⃣';
const ENGLAND = '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}';

describe('sliceUnits (emoji-safe cut)', () => {
  it('never leaves half of a surrogate pair', () => {
    const s = `ab${PIZZA}cd`;
    expect(sliceUnits(s, 3)).toBe('ab');
    expect(sliceUnits(s, 4)).toBe(`ab${PIZZA}`);
    expect(sliceUnits('xxxxx', 9)).toBe('xxxxx');
  });

  it('survives flags, skin tones, ZWJ sequences and keycaps at every cut point', () => {
    for (const e of [FLAG, THUMB, FAMILY, KEYCAP, ENGLAND]) {
      const text = `Sam ${e}`;
      for (let max = 1; max <= text.length; max++) {
        const out = sliceUnits(text, max);
        expect(/[\uD800-\uDBFF]$/.test(out)).toBe(false);
        expect(() => encodeURIComponent(out)).not.toThrow();
      }
    }
  });
});

describe('emoji in display names', () => {
  it('keeps the letters of names decorated with ZWJ sequences, flags and skin tones', () => {
    expect(sanitizeDisplayName(`Tony ${FAMILY} Soprano`)).toBe('Tony Soprano');
    expect(sanitizeDisplayName(`${FLAG} Sam ${THUMB}`)).toBe('Sam');
    expect(sanitizeDisplayName(`Ana${ENGLAND}`)).toBe('Ana');
  });

  it('rejects emoji-only names', () => {
    expect(sanitizeDisplayName(`${PIZZA}${PIZZA}`)).toBe('');
    expect(sanitizeDisplayName(`${FLAG}${FAMILY}`)).toBe('');
  });

  it('truncateForDiscordNick keeps a ZWJ family whole or drops it entirely', () => {
    expect(truncateForDiscordNick(`${'a'.repeat(28)}${FAMILY}`)).toBe('a'.repeat(28));
    expect(truncateForDiscordNick(`${'a'.repeat(20)}${FAMILY}`)).toBe(`${'a'.repeat(20)}${FAMILY}`);
  });
});
