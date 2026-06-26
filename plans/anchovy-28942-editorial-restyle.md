# anchovy-28942 — Editorial restyle: foundation + NameStep

Port the **Lovable mockup's editorial visual language** into our onboarding
flow. Foundation tokens + utility classes land in `globals.css`, and the first
step to receive the new treatment is `NameStep`. Subsequent PRs will
extrapolate the language to the remaining steps.

## Goal

Reach visual parity with `MafiaNamePage` ("Claim your mafia name.") from
the Lovable mockup at `C:\Users\samgo\AppData\Local\Temp\pizzadao-mock`:

- Editorial overline labels (`§ 01 · PizzaDAO`)
- Display headlines with `clamp()` sizing and tomato emphasis ("mafia name.")
- "the pizza has spoken" ceremony copy
- Cycling animation while names are being generated (`CyclingStage`)
- `FamilyFileCard` grid (3 cards) with personality rotation, file numbers,
  margin annotations (`trusted` / `dangerous` / `real earner`), monogram seal
  (initials), tags, scribble underline on selection
- Sticky bottom selection dock with radial gradient over ink-dark surface,
  butter overline, large display name, edit/copy/claim controls
- Paper grain + radial spotlight gradients
- Rock Salt handwritten accent font

…**without changing behavior**. Props/state/callbacks/API are preserved.

## Constraints (carry forward — applies to follow-up PRs too)

1. **No behavioral changes.** `NameStep` keeps the exact same `Props` shape,
   the same callbacks, the same render contract. The wizard supplies its
   chrome (step header + reset button + error block) — we only restyle the
   step body.
2. **No Supabase functions.** The mockup hits
   `supabase.functions.invoke("generate-mafia-names")` and
   `generate-mafia-avatar`. We hit `/api/namegen` and **do not generate
   avatars at all**. The mockup's avatar feature is out of scope for this
   PR (and for the entire restyle effort) — we render a typographic placeholder
   (file number + monogram) instead.
3. **No `react-router-dom`.** Mockup uses `<Link to="/home">`; we already use
   the App Router. The Lovable header/footer + reset button are wizard
   concerns, not NameStep — so we don't need to port them.
4. **No PostHog / no `track(EVT.*)`.** No analytics calls in this PR.
5. **No `@/data/mafia-films` / `@/data/topping-images`.** Our flow takes free
   text from the user (`topping` + `mafiaMovieTitle`) and resolves a movie
   via TMDB inside `/api/namegen`. We keep that flow. The mockup's curated
   picker + topping-image grid is **NOT ported** — it's a much larger data
   layer change and would alter behavior. We will use the mockup's
   `TOPPING_DESCRIPTOR` map (just the text labels) as visual flavor under the
   topping input.
6. **Additive only in `globals.css`.** Other steps still consume the existing
   semantic tokens / back-compat aliases. Don't remove any. Update
   `--border` from `var(--ink)` to the warm `30 12% 78%` per the mockup —
   this is a *value* change, no key changes.
7. **lucide-react is already in deps.** Use it freely. No new deps required.
8. **Tailwind v4 in this project.** The mockup uses Tailwind v3
   (`@layer components`, `@apply`). We rewrite the ported utilities as
   plain CSS using `theme(...)` or hard-coded values where `@apply` would
   require config additions we don't want.

## Visual delta — current vs. target

### Current NameStep
Plain neutral cards. Two side-by-side text inputs (topping + movie),
"Generate 3 names" button, then a column of `choiceBtn()` suggestions.
No display typography moment. No overline. No tomato accent. No grain.

### Target NameStep
Cinematic, editorial:

1. **Hero block** (only when no suggestions yet):
   - `§ 01 · PizzaDAO` overline in tomato
   - `Claim your` (ink) + `mafia name.` (tomato) — `clamp(2.5rem, 7vw, 5.5rem)`,
     `font-display`, leading 0.9
   - "Choose a topping. Choose a movie. The family handles the rest." body
2. **Input phase** — replaces the existing two-input row:
   - `§ 02 · Your topping` (overline tomato) → big cinematic-style input
     for `topping`
   - `§ 03 · Your mafia movie` (overline tomato) → smaller cinematic input
     for `mafiaMovieTitle`
   - "Generate 3 names" button → `btn-pill-lg bg-tomato text-cream` with
     `ArrowUpRight` lucide icon
3. **Cycling stage** — when `submitting && !suggestions`:
   - Spotlight radial gradient backdrop
   - Cycling typography (large display name fragments rotating every ~80ms)
   - `CyclingStage` helper component lives **inside** `NameStep.tsx`
   - "The family is deliberating" overline
   - Crossed-out candidate scribbles in the margins (handwritten)
4. **Reveal stage** — when `suggestions` exist:
   - `§ 04 · The naming` overline + "The pizza has spoken." display headline
   - "One of these belongs to you." subhead
   - 3-card grid → `FamilyFileCard` (helper component inside NameStep)
     - Header overline: `§ Family file no. 01/02/03`
     - Monogram seal: circle dashed border with initials of the suggestion
     - The suggestion name (display, clamp-sized)
     - File number + persona rotation: `-1.2deg / +0.9deg / -0.6deg`
     - Handwritten margin annotation: `trusted` / `dangerous` / `real earner`
     - On hover: rotate to 0, lift, scribble underline on the name
     - On select: tomato scribble underline + stronger lift + the sticky dock
       slides up
5. **Sticky selection dock** — overlay at bottom of viewport when a card is
   tapped:
   - Ink (`hsl(var(--ink))`) background with butter+tomato radial spotlights
   - `Your name, your call` butter-toned overline
   - The picked name in display + an Edit button + Copy + the giant
     `Claim this name` btn-pill-lg in tomato
   - Edit becomes the inline contentEditable input; Copy hits clipboard;
     Claim calls `onPickName(name)` so the wizard advances.
6. **Top-of-frame nav**:
   - Lightweight back link with `ArrowLeft` lucide icon ("Back" / "Cancel")
   - "Regenerate" link with `RefreshCw` lucide icon (matches mockup's
     "Re-cast / Look deeper / Pull another file" escalation copy)
7. **Keep-existing-name affordances** (our feature, not in mockup):
   - Keep current existing-name + Keep-Discord-nickname cards now styled with
     the new vocabulary — tomato overline + display headline + `btn-pill`
     CTA. Sits **above** the input block when relevant.

## Token additions to `app/globals.css`

### Inside `:root`
Add:
- `--rule-warm: 30 14% 70%;` (used by `surface-editorial`, mockup parity)
- `--ease-editorial: cubic-bezier(0.22, 0.61, 0.24, 1);`
- `--ease-filmic:   cubic-bezier(0.16, 0.84, 0.32, 1);`
- `--dur-fast: 280ms; --dur-base: 520ms; --dur-slow: 900ms;`
- `--shadow-soft:   0 1px 2px hsl(30 20% 12% / 0.04), 0 8px 28px -18px hsl(30 20% 12% / 0.18);`
- `--shadow-lifted: 0 2px 4px hsl(30 20% 12% / 0.05), 0 18px 48px -24px hsl(30 20% 12% / 0.22);`

Change:
- `--border: 30 12% 78%;` (was `var(--ink)` → causing harsh near-black rules.
  Mockup uses a warm institutional gray.)
- `--input:  30 12% 78%;` (matches)
- `--ring:   var(--tomato);` *(already correct, no change)*

Keep all existing back-compat aliases untouched.

### Inside `@theme inline`
Add `--font-handwritten: var(--font-handwritten-rock-salt);` so
`font-[family-name:var(--font-handwritten)]` works as a Tailwind utility.

## Utility classes to add (in a fresh CSS block at the end of globals.css)

Listed with mockup origin. Tailwind v4 syntax — plain CSS, no `@apply`,
no `@layer components`. Body grain attaches via `body::before`.

- `.grain` — newspaper grain overlay (used by FamilyFileCard, drawers, etc.)
- `.overline` — small uppercase letterspaced label (`§ 01 · PizzaDAO`)
- `.btn-pill` / `.btn-pill-lg` — pill CTAs with cinematic ease
- `.fade-up` — entry animation
- `.handwritten` — Rock Salt typography wrapper
- `.paper-soft` (+ `.paper-soft-dark`) — paper texture for cards
- `.print-noise` — toner-fleck noise
- `.halftone-soft` — soft dot field
- `.ink-spread` — soft gradient on dark blocks
- `.underline-scribble` — tomato hand-drawn underline on selection
- `.circle-scribble` — hand-drawn circle (not used in NameStep but cheap to ship)
- `.scroll-y-track` + `@keyframes scrollY` — vertical infinite scroll (deferred
  use; ship now for follow-up steps)
- `.mask-fade-y` — fade-y mask
- `.marquee-track` + `@keyframes marquee` — marquee animation
- `.rule` / `.rule-thick` — hairline rules
- Body-grain `body::before` block + `@keyframes bodyGrainDrift`
- `::selection` — tomato selection
- Editorial transition default on `a, button, [role="button"]`

These are **additive**. Nothing is removed.

## Font addition

`Rock_Salt` via `next/font/google` in `app/layout.tsx`:

```ts
import { Rock_Salt } from "next/font/google";
const rockSalt = Rock_Salt({
  variable: "--font-handwritten-rock-salt",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});
```

Add `${rockSalt.variable}` to the body className. The `.handwritten` utility
falls back to `Asap, cursive` if Rock Salt fails to load.

## NameStep visual structure (post-rewrite)

```
<div className="grid gap-10 fade-up">
  {/* radial spotlight backdrop layer */}
  <div aria-hidden ... radial gradient .../>

  {/* Hero — shown when suggestions absent */}
  {!suggestions && !submitting && (
    <header>
      <p className="overline text-tomato">§ 01 · PizzaDAO</p>
      <h1 className="font-display ... clamp(...)">
        Claim your <span className="text-tomato">mafia name.</span>
      </h1>
      <p>Choose a topping. Choose a movie. The family handles the rest.</p>
    </header>
  )}

  {/* Keep-existing affordances (existing logic) */}
  {showKeepExisting && <KeepExistingCard .../>}
  {showKeepDiscord  && <KeepDiscordCard .../>}

  {/* Input phase — shown when suggestions absent */}
  {!suggestions && (
    <section>
      <CinematicInput label="§ 02 · Your topping" value={topping} ... />
      <CinematicInput label="§ 03 · Your mafia movie" value={mafiaMovieTitle} ... size="small" />
      <button className="btn-pill-lg ...">Generate 3 names <ArrowUpRight/></button>
    </section>
  )}

  {/* Cycling stage */}
  {submitting && <CyclingStage .../>}

  {/* Reveal */}
  {suggestions && !submitting && (
    <section>
      <p className="overline text-tomato">§ 04 · The naming</p>
      <h2 className="font-display ...">The pizza has spoken.</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {suggestions.slice(0,3).map((name, i) =>
          <FamilyFileCard
            key={name}
            name={name}
            persona={CARD_PERSONALITIES[i]}
            isSelected={selectedIdx === i}
            anySelected={selectedIdx !== null}
            onSelect={() => setSelectedIdx(i)}
          />
        )}
      </div>
      <Regenerate /> (link with RefreshCw)
    </section>
  )}

  {/* Sticky bottom dock */}
  {selectedIdx !== null && (
    <StickyDock
      name={editing ? editedName : suggestions[selectedIdx]}
      editing
      onEdit
      onCopy
      onClaim={() => onPickName(finalName)}
    />
  )}

  {/* Back link */}
  <button onClick={onBack}>{isUpdate ? "Cancel" : "Back"}</button>
</div>
```

All helper components (`CinematicInput`, `CyclingStage`, `FamilyFileCard`,
`StickyDock`) live **inside** `NameStep.tsx`. No new files this PR — keeps
the diff scoped.

### Persona rotation seed
`CARD_PERSONALITIES` matches the mockup's three voices (classic / wildcard /
operator) with margin annotations `trusted` / `dangerous` / `real earner`.
File numbers `01 / 02 / 03`.

### Topping descriptors
The `TOPPING_DESCRIPTOR` map from the mockup ships as a const inside
NameStep. If the user types a topping not in the map, fall back to
`"off-canon · your call · respected"`. Shown beneath the topping input as
small overline text once a topping has been entered.

### Cycling pool
Static array of 30+ atmospheric fragments — `"the Quiet"`, `"the Sicilian"`,
`"the Last Call"`, `"Hot Sauce"`, etc. — cycled in `CyclingStage`. No data
dependency. ~80ms tick.

## What's intentionally NOT ported (this PR)

| Mockup feature                                  | Reason                                        | Substitute                       |
|--                                               |--                                             |--                                |
| `MAFIA_FILMS` curated picker grid               | Behavioral change; needs data layer           | Keep free-text movie input       |
| `TOPPING_IMAGE` ingredient photos               | No asset pipeline for this PR                 | Free-text topping + descriptor   |
| `FilmDrawer` / `ToppingDrawer`                  | Same — paired with picker                     | Single cinematic input each      |
| `supabase.functions.invoke("generate-mafia-names")` | Lovable backend                           | `/api/namegen` (unchanged)       |
| `generate-mafia-avatar` + avatar download/copy  | No backend, no asset pipeline                 | Skipped — monogram only          |
| `FinaleScene` dossier (claim ceremony page)     | Belongs to step 2+, not NameStep              | Wizard advances on `onPickName`  |
| Header logo + footer + nav                      | Wizard chrome owns these                      | Lightweight Back link only       |
| `track(EVT.*)` PostHog analytics                | Not wired in this project                     | No-op                            |
| `Link to="/home"`                               | react-router only                             | `<button onClick={onBack}>`      |

## What other steps would need (follow-up PRs)

These are *not* in this PR — listed for context so future agents know what
the foundation supports.

- **WelcomeStep** — adopt the hero pattern: overline + display headline +
  tomato emphasis + supporting copy + `btn-pill-lg` CTA. Add a paper-soft
  card containing the intro copy.
- **CityStep** — `§ 04 · Your city` overline, large search input modeled
  on `CinematicInput`, Google Places drawer styled like `ToppingDrawer`.
- **RolesStep** — turtle cards become editorial chips with handwritten
  annotations, similar to the topping featured grid.
- **MemberIdStep** — overline + display headline + cinematic input + the
  paper grain on the verification feedback.
- **CrewsStep** — crew rows become `surface-editorial` cards with hover
  lift; selection adds tomato scribble underline.
- **ReviewStep** — full dossier mockup — `FamilyFileCard`-style summary
  with paper-soft texture, metadata grid (`DossierField`), stamped seal
  ("OFFICIALLY MADE / PizzaDAO"). This is where the mockup's `FinaleScene`
  graphics finally land.
- **OnboardingWizard chrome** — replace the existing `<h2>` + reset button
  with a tighter overline + display stepTitle row; switch the error box to
  use `surface-editorial` with the editorial palette.
- **MagicLoginFlow** — overline + display + supporting copy + cinematic
  email input.

Each follow-up PR is one-step-per-PR so we can verify Vercel previews and
land the language incrementally.

## Files touched this PR

- `app/globals.css` — additive utilities + motion tokens + body grain
  + `--border` warm-gray fix
- `app/layout.tsx` — load Rock Salt via `next/font/google`, add variable to
  body className
- `app/ui/onboarding/steps/NameStep.tsx` — full visual rewrite (helpers
  inlined: `CinematicInput`, `CyclingStage`, `FamilyFileCard`, `StickyDock`)
- `plans/anchovy-28942-editorial-restyle.md` — this plan

`app/ui/onboarding/styles.ts` is left **untouched** — the existing inline-style
helpers still work for other steps. NameStep moves to className-driven styling
inside its own file.

## Verification

- `npm run build` (Turbopack + TypeScript)
- Manual visual check on Vercel preview: hero hero block, input phase,
  cycling stage with mocked slow network, reveal stage, sticky dock,
  selection, claim → step 2.
- Mobile breakpoint check: clamp() sizing must remain readable; sticky dock
  must not eat too much viewport.
- Reduced motion: cycling animation respects `prefers-reduced-motion`.

## Rollout

Foundation tokens + utility classes ship in this PR. They're additive — no
existing step regresses. NameStep is the canary. If the editorial language
holds up on Vercel preview, each follow-up PR ports one more step using the
exact same vocabulary.

## Risks

- Rock Salt font loading: handled via `display: "swap"` on `next/font/google`
  so we never block render. The `.handwritten` utility falls back to Asap.
- Sticky dock z-index: bottom-fixed dock could clash with the
  `Google Sheets / GitHub` floating links at `fixed bottom-4 right-4` in
  `app/layout.tsx`. Mitigation: dock takes `z-30`, floating links sit at
  `z-1000` already — they remain on top. If overlap is visually awkward,
  follow-up PR can hide the floating links inside the wizard route.
- The hero headline + dock + cycling stage all animate. Respect the global
  `prefers-reduced-motion` override that ships with the foundation block.
- Build size: Rock Salt is a single weight (400). Negligible.

## Open questions (defer to Snax)

- Should the wizard's existing step header (`<h2>` + "Reset") be replaced
  with the editorial overline pattern in the **same PR** or a later one?
  Plan: ship the step body restyle now, do wizard chrome in a follow-up so
  this PR stays scoped.
- The mockup has an avatar generation feature behind a Supabase edge
  function. We've decided: not portable, skipped.

## Verification checklist

- [ ] Plan file at `plans/anchovy-28942-editorial-restyle.md`
- [ ] Worktree at `onboarding-anchovy-28942`, branch
      `anchovy-28942-editorial-foundation`
- [ ] `globals.css` foundation additive — no existing token deleted
- [ ] Rock Salt loads via `next/font/google` in `layout.tsx`
- [ ] `NameStep` props unchanged
- [ ] `npm run build` passes
- [ ] Vercel preview ✓
- [ ] Draft PR opened, linked back to this plan
