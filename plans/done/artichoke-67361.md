# artichoke-67361: Clean up special characters in names at signup

Task (TASKS.md): "it should truncate non alphanumeric characters from names on signup"
Approved scope (Snax): "clean up special characters in names at signup"
Branch: `task/artichoke-67361`

## Open questions for Snax

1. **Length limit: keep 64, or drop to 32 so it matches Discord?** Names are stored with up to
   64 characters, but Discord nicknames max out at 32. A 40-character name gets cut at 32 in
   Discord today. **Recommendation:** keep 64 so no existing member's longer name gets cut the
   next time they save their profile. Cut the Discord nickname cleanly at a word boundary instead.
2. **Underscores: turn them into spaces, or remove them?** Right now `Big_Tony` becomes `BigTony`
   and `xX_Sl1ceL0rd_Xx` becomes `xXSl1ceL0rdXx`. **Recommendation:** turn them into spaces
   (`Big Tony`).
3. **Inline "will be saved as" preview:** OK to show a one-line hint under the name box when the
   cleaned name is different from what was typed? (Needs en/es/fr strings.) **Recommendation:** yes.
4. **Existing members:** no backfill. Names already in the sheet stay as they are. They only get
   cleaned if the member edits their profile, because the server already cleans names on every
   save. OK?

## Key finding: most of this already exists

Commit `0bfeda3` ("Normalise member display names", on `main` since 2026-09-29) added
`app/lib/display-name.ts` → `sanitizeDisplayName()`. It already:

- applies NFKC, so full-width and "𝓯𝓪𝓷𝓬𝔂" letters become plain letters
- turns curly apostrophes and dashes into ASCII `'` and `-`
- removes control characters (`\p{Cc}`) and invisible format characters (`\p{Cf}`: ZWSP,
  ZWJ/ZWNJ, bidi overrides, BOM, soft hyphen), plus Hangul and Braille filler "blank" letters
- keeps only `[\p{L}\p{M}\p{N} '\-.&]`, which means emoji, symbols and other punctuation are
  removed, while accented, CJK, Cyrillic, Arabic and Devanagari letters are kept
- allows at most 2 combining marks per character (blocks "Zalgo" text)
- collapses repeated spaces, trims, and caps the length at 64 code points (surrogate pairs are
  never split)
- returns `""` (rejected) if no letter or number is left

It runs on the server in `validateProfilePayload` and in `POST /api/profile` (the payload and
`raw`; an empty result throws "Mafia name is required"). It runs in `sanitizeSignupDraft` (draft
cookie and magic-login request), and on the client in NameStep and OnboardingWizard before
submit. `app/lib/display-name.test.ts` covers it.

**So we don't need a new sanitizer.** This task closes the gaps that are left and makes the
cleaning visible to the user.

Current behaviour I checked (same logic run under node):

| Input | Output | Verdict |
|---|---|---|
| `"  Tony 🍕 Pepperoni!! "` | `Tony Pepperoni` | good |
| `José Núñez`, `Владимир`, `李小龍`, `محمد علي`, `Đặng Thị` | unchanged | good |
| `Tony​​P` | `TonyP` | good |
| `@everyone` | `everyone` | good (no mention injection) |
| `Tony  ‘The Slice’  O’Neil` | `Tony 'The Slice' O'Neil` | good |
| `a.b-c_d` / `xX_Sl1ceL0rd_Xx` | `a.b-cd` / `xXSl1ceL0rdXx` | **gap: underscores glue words** |
| `Tony™` | `TonyTM` | **gap: NFKC expands ™ to "TM" before symbols are removed** |
| `★彡 xX_Sl1ceL0rd_Xx 彡★` | `彡 xXSl1ceL0rdXx 彡` | 彡 is a real CJK letter (Lo). Accept it; removing it would hurt CJK names |
| draft path: `"🍕"×40 + "Tony"` | `""` | **bug: `signup-draft.ts` slices the raw text to 64 UTF-16 units *before* cleaning** |

## Gaps to fix

1. **Draft truncation order** (`app/lib/signup-draft.ts`): `str("mafiaName", 64)` slices the raw
   string before cleaning. Emoji-heavy input can therefore lose all its real letters (shown
   above), and the slice can split a surrogate pair. Fix: slice the raw text to a generous 256
   characters (to bound the work), then clean it. The 64-code-point cap inside the sanitizer is
   the real limit.
2. **Discord nickname** (`app/lib/services/discord-api.ts:81`): `nickname.slice(0, 32)` counts
   UTF-16 units. It can split a surrogate pair (a broken character, or Discord rejecting the
   request) and can leave a trailing space. Fix: add `truncateForDiscordNick(name, 32)` in
   `display-name.ts`. It cuts by code point, then backs up to the last space if that space is in
   the last ~10 characters, then trims. The caller is `app/api/profile/route.ts:316`
   (`nickname: payload.mafiaName`), which is already cleaned.
3. **Fallback name written to the Sheet** (`app/api/discord/sync-to-sheet/route.ts:21` and
   `app/lib/discord-sheet-sync.ts:108-109`): `body.mafiaName.slice(0, 100)` is raw. When the
   member's sheet row has an empty Name, this raw value, or else the raw Discord `username`, is
   written to the sheet. Fix: in `discord-sheet-sync.ts`, use
   `sanitizeDisplayName(fallbackName) || sanitizeDisplayName(discordMember.user?.username) || "Unknown"`.
   Leave `found.row.Name` alone (it's an existing member's name, so no backfill).
4. **Underscores** (if Snax agrees, Q2): add `_` to the whitespace-like replacement, so it becomes
   a space before the disallowed-character pass runs.
5. **™/℠-style symbols:** remove `\p{S}` (symbols: emoji, ™, ★, ♥, currency, math) **before**
   NFKC, so `Tony™` → `Tony`. This is safe for letters. Full-width and math-alphanumeric
   letters are `\p{L}`, not `\p{S}`, so they still fold. Digits are `\p{N}`. Emoji are removed
   either way.
6. **UI clarity** (`app/ui/onboarding/steps/NameStep.tsx:293-297`):
   - Clean **on save**, not as the user types. Cleaning on every keystroke breaks CJK/Japanese
     IME composition, removes the space you just typed (because of trim) before you type the
     next word, and makes the cursor jump. The "Use this name" button already sends
     `sanitizeDisplayName(mafiaName)`.
   - **Show a preview:** when `sanitizeDisplayName(mafiaName)` is non-empty and different from
     `mafiaName.trim().replace(/\s+/g, " ")`, show a small `aria-live="polite"` line under the
     input: "Will be saved as: **{name}**". When the input isn't empty but cleans down to `""`,
     show "Use at least one letter or number" (the button is already disabled in that case).
     The Review step already shows the final name as a second check.
   - Raise the input's `maxLength={64}` to `128`. `maxLength` counts UTF-16 units, so emoji and
     decorations currently use up the budget before the sanitizer gets a chance. The
     64-code-point cap is still enforced by the sanitizer and the server.
7. **Generated names** (`/api/namegen`): `route.ts:141` already limits output to
   `[A-Za-z' -]`, and `handleClaim` cleans it again. No change.

Out of scope: `auto-claim` compares sheet names to Discord nicknames as-is (existing members, not
signup). `update-skills` and `update-orgs` write back the existing sheet name unchanged. City,
topping and other fields are not part of this task.

## Files to change

| File | Change |
|---|---|
| `app/lib/display-name.ts` | Remove `\p{S}` before NFKC. Map `_` to a space (Q2). Add and export `truncateForDiscordNick(name, max = 32)`. Export `DISCORD_NICK_MAX_LENGTH = 32`. Update the rules comment in the header. |
| `app/lib/display-name.test.ts` | New cases (below). Existing cases must still pass (`"Tony_"` → `"Tony"` still holds; `'"Fat" Tony_'` → `"Fat Tony"` still holds). |
| `app/lib/signup-draft.ts` | `sanitizeDisplayName(str("mafiaName", 256))` |
| `app/lib/signup-draft.test.ts` | Case: emoji prefix + "Tony" survives. |
| `app/lib/services/discord-api.ts` | `body.nick = truncateForDiscordNick(nickname)` instead of `.slice(0, 32)`; skip when the result is `""`. |
| `app/lib/discord-sheet-sync.ts` | Clean the fallback name and username before writing them to the sheet. |
| `app/api/discord/sync-to-sheet/route.ts` | Optional: keep `.slice(0, 256)` as a work bound; the cleaning happens in the lib. |
| `app/ui/onboarding/steps/NameStep.tsx` | Preview and empty-state hint, `maxLength={128}`. |
| `messages/en.json`, `es.json`, `fr.json` | `onboarding.name.displayNamePreview` ("Will be saved as: {name}" / "Se guardará como: {name}" / "Sera enregistré sous : {name}") and `onboarding.name.displayNameEmpty` ("Use at least one letter or number" / "Usa al menos una letra o un número" / "Utilise au moins une lettre ou un chiffre"). The catalog-parity test enforces all three. |
| `app/ui/onboarding/steps/NameStep.test.tsx` (new, modelled on `CityStep.test.tsx`) | UI tests (below). |

No database or Prisma change, and no Apps Script change.

## Approach and alternatives

- **Chosen:** extend the single shared sanitizer, which the client and server both import, so
  the preview always matches what gets stored. The server stays authoritative.
- *Strict ASCII `[A-Za-z0-9]`* (the literal task wording): rejected. It would delete é, ñ, ü,
  CJK, Cyrillic and Arabic, and PizzaDAO is international.
- *Clean as the user types:* rejected (IME, caret and trailing-space problems; see above).
- *Silently clean on save with no preview:* that's how it works today. Members are surprised
  when "Tony™🍕" turns into "TonyTM". The preview is cheap.
- *Backfill existing sheet names:* rejected. The sheet is the source of truth and is edited by
  hand. Rewriting it could break `auto-claim` name matching and surprise members. Cleaning
  happens naturally when someone edits their profile.
- *Lower the cap to 32:* see Q1. It would cut existing longer names when they're re-saved.

## Tests (vitest: `npm run test:run`)

`sanitizeDisplayName`:

| Input | Expected |
|---|---|
| `Tony™` | `Tony` |
| `★ Big Tony ★` | `Big Tony` |
| `Big_Tony` | `Big Tony` (Q2) |
| `xX_Sl1ceL0rd_Xx` | `xX Sl1ceL0rd Xx` (Q2) |
| `$$Money$$ Mike` | `Money Mike` |
| `Tony ♥ 🍕 Pepperoni` | `Tony Pepperoni` |
| `ＰＩＺＺＡ` | `PIZZA` (still folds) |
| math-bold `𝐓𝐨𝐧𝐲` | `Tony` (still folds) |
| `José Núñez`, `Владимир`, `李小龍`, `محمد علي` | unchanged |
| `①②③` | `123` (`\p{N}`, not removed) |
| `🍕🍕🍕` | `""` |
| idempotence over all of the above | `s(s(x)) === s(x)` |

`truncateForDiscordNick`:

| Input | Expected |
|---|---|
| `Tony Pepperoni` | unchanged |
| `"Don Vito Corleone the Magnificent Pizzaiolo"` (44) | `Don Vito Corleone the` (cut at a space, ≤32) |
| `"a".repeat(40)` | `"a".repeat(32)` (no space, hard cut) |
| `"山".repeat(31) + "𠀀𠀀"` | 32 code points, no lone surrogate |
| `""` | `""` |

`sanitizeSignupDraft`: `{ mafiaName: "🍕".repeat(40) + "Tony", city: "Paris", sessionId: "abcdefgh12" }`
→ `mafiaName === "Tony"`.

`discord-sheet-sync` (mock fetch): row with an empty Name plus fallback `"🍕Tony™"` → sheet write
`mafiaName: "Tony"`. Row with an existing Name `"Old★Name"` → written back unchanged (no backfill).

`NameStep.test.tsx` (RTL + next-intl test provider, as in `CityStep.test.tsx`):

- type `Tony 🍕` → preview shows `Tony`, and clicking the button calls `onPickName("Tony")`
- type `José` → no preview shown (nothing changed)
- type `🍕🍕` → button disabled, empty hint shown
- type `Big ` (trailing space) → no preview (cleaning whitespace alone doesn't show one)

Also run `npm run lint`, `npx tsc --noEmit`, and the existing `display-name`, `signup-draft`,
`magic-login`, `onboarding/draft` and catalog-parity tests.

## Verification on the Vercel preview

1. `/ship` → preview URL. Log in with a test Discord account that has no member row.
2. Name step: type `Tony™ 🍕 Pepperoni!!`. The preview should say "Will be saved as: Tony
   Pepperoni". Continue; the Review step should show `Tony Pepperoni`.
3. Type `José Núñez` → no preview, saved unchanged. Type `李小龍` with a Japanese/Chinese IME →
   composition is not interrupted.
4. Type `🍕🍕🍕` → button disabled, hint shown. Switch the locale to es and fr and check the
   strings.
5. After submitting, check that the new sheet row Name is cleaned, and that the Discord nickname
   is ≤32 characters with no trailing space or broken character. (Use a test account; the
   preview shares the production sheet and Discord guild, so delete or clean up the test row
   afterwards.)
6. Magic-login signup path: start a signup with an emoji-heavy name and finish via the emailed
   link. The draft should keep the letters.

## Risks

- **Removing `\p{S}` before NFKC:** a few characters are `\p{S}` but fold to letters under NFKC
  (for example `℡` → "TEL", `℃` → "°C"). Removing them is what we want. I checked that the
  full-width and math-alphanumeric letters are `\p{L}`, so they still fold. The idempotence
  test guards against regressions.
- **Underscore → space** changes the result for re-saved existing names containing `_` (from
  "a_b" → "ab" to "a b"). Low impact.
- **Shared sheet and Discord in preview testing:** use a throwaway account and clean up.
- **Server enforcement is unchanged**, so an old client cached in a stale tab still gets cleaned
  names on the server.

## Rollout

1. One PR on `task/artichoke-67361`. No migration, no env change, no feature flag needed.
2. Reviewer agent → Snax checks the preview (steps above) → merge.
3. It only affects new signups and profile saves from then on. There's no backfill, and
   existing names are untouched until the member edits their profile.
4. `/task done artichoke-67361 <pr#>`.

## Decisions (Snax, 2026-10-18)

All open questions resolved with the plan's defaults:
1. Keep the 64-character name limit; Discord nicknames use the safe 32-character cut.
2. Underscores become spaces.
3. Show the "Will be saved as: X" preview line (in en, es and fr).
4. No backfill.
