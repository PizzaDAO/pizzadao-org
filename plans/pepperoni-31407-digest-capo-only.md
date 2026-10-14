# pepperoni-31407 — Mission review digest: tag only Pizza Capo

**Priority:** P1 · **Status:** Approved by Snax 2026-10-14

## Problem
The daily mission-review SLA digest (Pepperoni Bot, #work) pings every role that can
review missions: Leonardo, Dread Pizza Roberts, Pizza Capo, Pepperoni Mafia. It should
tag **only the Pizza Capo role**.

## Root cause
`rolesToPing()` in `app/lib/mission-verify/sla.ts` unions `missionReviewerRoleIds(level)`
(admin + all reviewer roles, DPR for L8) for every overdue item.

## Changes
1. `app/ui/constants.ts` — add `export const PIZZA_CAPO_ROLE_ID = "839206162837798945"` and
   reference it from `MISSION_REVIEWER_ROLE_IDS` (no change to who may *review*).
2. `app/lib/mission-verify/sla.ts`
   - `rolesToPing()` returns `[PIZZA_CAPO_ROLE_ID]` whenever there are items (empty for none),
     regardless of level. Drop the `missionReviewerRoleIds` import if unused.
   - Update the header doc comment ("pings the Pizza Capo role only").
   - `allowed_mentions` stays `{ parse: [], roles }`, so nothing else can be pinged.
3. `app/lib/mission-verify/sla.test.ts` — update the ping tests: content contains only
   `<@&CAPO>`, `allowed_mentions.roles` equals `[CAPO]`, L8 items also ping only Capo,
   and the other role ids are absent.

## Not changed
Review permissions (`mission-review-access.ts`) are untouched; L8 approval stays DPR-only.

## Verification
- `npx vitest run app/lib/mission-verify` passes
- `npm run build` passes
