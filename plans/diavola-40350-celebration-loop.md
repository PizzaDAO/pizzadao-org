# diavola-40350: First-Time User Celebration Loop

## Context

The missions feature (`artichoke-49514`, PR #31) is live. Members submit mission completions, admins approve them (or auto-verify for low-stakes missions), and the system silently flips a status badge from "Pending" to "Approved" in the level accordion. There is no positive feedback — no animation, no celebration, no nudge toward the next social step. This makes the first-time mission-complete moment feel anticlimactic and misses an opportunity to deepen new-member engagement (the friends/vouches network).

This plan adds a **celebration loop** that fires the first time a member reaches a celebratory milestone, then guides them to ask for vouches so other members can see their contributions.

## Triggers

We will celebrate at **three discrete moments**, gated by `lastCelebratedLevel` so each only fires once per member:

1. **First-ever mission approved (no prior celebrations)** — fires the `MissionCompleteCelebration` overlay plus the `VouchPromptCard` (this is the only time the vouch prompt appears).
2. **Level-up (crossing a level boundary)** — fires `LevelUpModal` showing new level number, level title, and the PEP reward summary. Triggered whenever `currentLevel > lastCelebratedLevel`. Covers levels 1, 2, 3, 4, 5, 6, 7, 8 — every level boundary, not just milestones, because the levels are far apart in real-world effort. The first-mission overlay (#1) takes precedence over the level-up modal on the same poll; if the user has just gone from Level 0 to Level 1, they see the celebration overlay (with vouch prompt) and the level-up modal is skipped — we set `lastCelebratedLevel = 1` so it does not re-fire.
3. **Final level reached (Level 8 Don of Dons)** — same `LevelUpModal` with extra "you reached the top" copy.

Trigger detection runs **client-side** on the missions page after `fetchMissions()` returns, comparing the fresh `currentLevel` against the persisted `lastCelebratedLevel`. After firing, the client calls a new endpoint to bump `lastCelebratedLevel` to the current value so the same animation never replays.

We do NOT trigger on individual mission approvals (other than the very first ever) — that would create noise for every auto-verified Level 1 task. Level boundaries are the meaningful milestones.

## Components

### `app/ui/missions/MissionCompleteCelebration.tsx`
Full-screen translucent overlay (`position: fixed`, `zIndex: 2000`). CSS-only animation:
- Large centered "Mission Complete!" headline in `--color-accent`.
- 12-16 emoji pizza slices (🍕) absolutely-positioned with `@keyframes confetti-fall` — each slice gets a randomized `left`, `animation-delay`, `animation-duration` (2.5-4s), and `transform: rotate(...)` to simulate falling confetti.
- After 4 seconds, the overlay fades out via state (`useEffect` setTimeout).
- Click-anywhere-to-dismiss for users who don't want to wait.
- Single "Got it" button at bottom that calls `onDismiss`.

### `app/ui/missions/LevelUpModal.tsx`
Centered modal (uses existing `overlay()` style + `card()`):
- "Level Up!" header with a large level number badge.
- Level title (e.g., "Pizza Noob") in subdued text.
- Reward summary: "+420 $PEP earned" with the actual reward pulled from the levels data.
- "Continue" button that calls `onDismiss`.
- Optional "Special: Don of Dons" copy when `level === 8`.

### `app/ui/missions/VouchPromptCard.tsx`
Inline card (NOT a modal). Renders **only once**, the first time a member completes any mission. Lives in the same overlay as `MissionCompleteCelebration` (after the confetti dismisses) OR as a standalone card on the missions page:
- Headline: "Ask 3 members to vouch for you"
- Body: short copy explaining vouches let others see your contributions and unlock community trust.
- Two buttons: "Find members" (links to `/crew`) and "Maybe later" (dismisses).
- Dismissal is persisted on the `vouchPromptShownAt` field so it never re-renders, even if the user logs out and back in.

To keep components composable, the **trigger logic lives in a wrapper component** `MissionCelebrationController` rendered inside `app/missions/page.tsx`. It receives the `MissionsResponse` snapshot before/after a submit and decides what to show.

## Animation Choice

**CSS only** — no `canvas-confetti` library (not installed, per constraints). The pizza-emoji confetti is purely a CSS `@keyframes` animation with randomized inline styles, which costs nothing and stays on-brand. Emoji we use: 🍕 (primary), 🍅 (cherry), ✨ (sparkle). 12-16 elements is the sweet spot — enough to feel festive, not so many it lags low-end devices.

A `prefers-reduced-motion: reduce` media query disables falling pieces and shortens the overlay to a quick fade.

## Data Model

### Extend `MemberProfileExtras`

`MemberProfileExtras` already exists on `origin/main` (from `burrata-13316`, migration `20260520_member_profile_extras`). It is keyed by **`memberId`** (Google Sheets member ID, NOT Discord ID) and currently stores only `tagline`. We extend it with three additive nullable columns:

```prisma
model MemberProfileExtras {
  memberId                 String   @id
  tagline                  String?  @db.VarChar(140)
  lastCelebratedLevel      Int      @default(0) // highest level whose celebration has fired
  firstMissionCelebratedAt DateTime?            // first-ever mission completion
  vouchPromptShownAt       DateTime?            // dismissed (or "shown enough")
  updatedAt                DateTime @updatedAt
  createdAt                DateTime @default(now())
}
```

- All new fields nullable/defaulted → **additive migration**, no backfill needed.
- Migration directory: `prisma/migrations/20260521000000_member_profile_extras_celebration/migration.sql` with `ADD COLUMN IF NOT EXISTS` for each field.
- Because the table is keyed by `memberId`, the celebration API must resolve the user's `memberId` from `session.discordId` via the existing `fetchMemberIdByDiscordId()` helper (5-min cache; pattern already used by articles + missions).

### API surface

Two tiny endpoints under `/api/missions/celebration/`:

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/missions/celebration` | GET | Required | Returns `{ lastCelebratedLevel, firstMissionCelebratedAt, vouchPromptShownAt }` for the logged-in user; creates the row lazily if missing. |
| `/api/missions/celebration` | POST | Required | Body: `{ lastCelebratedLevel?: number, firstMissionCelebrated?: boolean, vouchPromptDismissed?: boolean }`. Upserts the row and updates only the supplied fields. |

The missions page fetches `GET /api/missions/celebration` alongside `GET /api/missions`. After each successful submit, if a celebration condition fires, the client renders the relevant component and POSTs to mark it celebrated.

No new admin tooling needed.

## Wiring Into the Mission Completion Flow

The "completion flow" entry point is `app/missions/page.tsx → handleSubmit`. The natural sequence after `fetchMissions()` returns the refreshed snapshot:

1. Compute `prevLevel` (from state before refresh) and `nextLevel` (`data.currentLevel`).
2. Compute `prevFirstMission` from celebration state (`firstMissionCelebratedAt == null`).
3. If `prevFirstMission` and any completion just turned to APPROVED → show `MissionCompleteCelebration` + `VouchPromptCard`, then POST `firstMissionCelebrated: true`, `lastCelebratedLevel: nextLevel`, `vouchPromptDismissed: false` (dismissed later when user clicks Maybe later / Find members).
4. Else if `nextLevel > prevLevel && nextLevel > lastCelebratedLevel` → show `LevelUpModal`, then POST `lastCelebratedLevel: nextLevel`.

For admin-approved missions (where the user wasn't the one who submitted), the celebration fires the next time the user loads the missions page. This is acceptable — we do not need real-time push.

## Styling

- Reuse `card()`, `btn()`, `overlay()` helpers from `app/ui/shared-styles.ts`.
- Colors via existing CSS vars: `--color-accent` (the tomato red), `--color-success`, `--color-surface`, `--color-text`. No new tokens introduced; design language unchanged.
- Font inherits from page (Inter); no Asap import (it isn't in the repo).

## Implementation Steps

1. Add `MemberCelebrationState` model to `prisma/schema.prisma`.
2. Write migration SQL (`20260521000000_add_member_celebration_state/migration.sql`).
3. Run `prisma migrate deploy` against the Neon DB using `.env.migration`.
4. Add service helpers in a new `app/lib/celebration.ts`:
   - `getCelebrationState(discordId)` (lazy upsert)
   - `updateCelebrationState(discordId, patch)`
5. Build `/api/missions/celebration/route.ts` (GET + POST handler).
6. Build the three React components in `app/ui/missions/`:
   - `MissionCompleteCelebration.tsx`
   - `LevelUpModal.tsx`
   - `VouchPromptCard.tsx`
7. Export from `app/ui/missions/index.ts`.
8. Add `MissionCelebrationController` wrapper inline in `app/missions/page.tsx` (or as its own component if it grows past ~80 lines).
9. Wire trigger logic into `handleSubmit` and the initial `useEffect` load.
10. Add Vitest tests:
    - `MissionCompleteCelebration.test.tsx` — renders headline, fires `onDismiss` on button click and after timeout.
    - `LevelUpModal.test.tsx` — shows new level, reward, and dismisses.
    - `VouchPromptCard.test.tsx` — "Find members" link points to `/crew`, "Maybe later" calls dismiss.
11. `npm run build` to confirm Turbopack/TS.
12. `npm run dev` and manually click through a mission submit to confirm overlay/modal/card behaviour.
13. Commit, push, open draft PR, verify Vercel preview.

## Verification Checklist

- [ ] Migration applies cleanly (`prisma migrate deploy`).
- [ ] First mission auto-approve → overlay appears, confetti animates, vouch prompt visible after dismissal.
- [ ] Subsequent mission approvals in the same level → no overlay (state already advanced).
- [ ] Crossing into Level 2 → `LevelUpModal` shows, with "Pizza Noob" + 420 $PEP.
- [ ] Reloading the missions page after a celebration → no re-fire (DB state respected).
- [ ] `prefers-reduced-motion` honored: no falling emoji, only the fade.
- [ ] `npm run build` succeeds.
- [ ] Vitest tests pass.
- [ ] Vercel preview renders the celebration on a fresh test account.

## Constraints Recap

- Branch base: `origin/main`. Branch name: `diavola-40350-celebration-loop`.
- Worktree path: `C:\Users\samgo\OneDrive\Documents\PizzaDAO\Code\onboarding-diavola-40350`.
- No new dependencies (no `canvas-confetti`).
- Migration is additive; no destructive ops.
- New commits only; no `--amend`, no `--no-verify`.
- Use existing CSS vars + `Inter`; no new design language.
