# Proof of Pizza redemption codes (pizzadao.org <-> proofof.pizza)

## Goal

Each unit of the shop item configured as "Proof of Pizza" carries a one-time, 4-character
redemption code. The member sees it (with steps) in their inventory on pizzadao.org, and can
optionally get it by bot DM. On proofof.pizza the member enters the code on the submission form;
admins see the code's status there and approving the submission redeems it on pizzadao.org
(server to server, shared secret, idempotent).

Two repos:
- **pizzadao-org** (this repo, public): Next.js App Router + Prisma, shared Postgres (previews
  share the prod DB), Vercel project `onboarding`. Migrations are applied by hand
  (`prisma migrate deploy`, Neon branch first, then prod; see plans/app-settings.md).
- **proof-of-pizza** (`~/Code/pizzadao/proof-of-pizza`, `PizzaDAO/proof-of-pizza`): Next.js 16
  + Prisma 7 on Neon (`@prisma/adapter-neon`); build runs `prisma migrate deploy` automatically.
  Hosted on Vercel (proofof.pizza resolves to 76.76.21.21) but not under the `pizzadao` or `snax`
  Vercel tokens, so the env vars there must be set by whoever owns that project (see decisions).
  Admin auth: name + password (bcrypt `Admin` table / `ADMIN_CREDENTIALS`), HMAC session cookie,
  `requireAdmin` (`src/lib/admin-auth.ts`). Rate limits: Postgres `RateLimit` table
  (`src/lib/rate-limit.ts`, `limitByIp`).

## Key decisions (proposed)

1. **One code per held unit; redeeming consumes the unit.** Approval in one transaction marks the
   code `REDEEMED` and decrements `Inventory` by 1 (row deleted at 0). Invariant:
   `count(ACTIVE codes for user+item) == Inventory.quantity`. Quantity 3 = 3 codes. This is the
   only model where "can't redeem twice" holds without special cases: if the unit were kept, the
   item would still be in the inventory after redemption and transfers would need extra rules.
   The redeemed code stays as history ("Redeemed on <date>") on the member's card.
   *Snax to confirm* (alternative: keep the item as a badge, mark code used only).
2. **Reconcile, don't sprinkle.** One helper `reconcileRedemptionCodes(tx, userId)` mints missing
   codes or voids extra ones so the invariant holds. It is called inside the transaction at every
   inventory write site (list below), plus as a self-heal when the member opens their codes.
   This also does the backfill for free.
3. **Transfers void and re-mint.** If a member sends the item (or an admin removes it), the
   sender's newest ACTIVE code(s) become `VOID` and the recipient gets fresh codes. A code the
   sender already shared can't be used by anyone after the unit leaves them. VOID codes are never
   reissued (unique column keeps them).
4. **No public validity oracle.** The proofof.pizza form accepts any well-formed code without
   checking it. Only the admin page (server side) looks codes up. 31^4 = 923,521 codes is fine
   for uniqueness, not for secrecy against an open oracle, so this matters.
5. **Item is a setting** (`proofOfPizza.itemId`, int, `0` = feature off). Id, not name: names are
   editable in /admin/shop.

## Data model (pizzadao-org, additive migration)

`prisma/migrations/2026112X000000_redemption_codes/migration.sql`, `prisma/schema.prisma`:

```prisma
enum RedemptionCodeStatus { ACTIVE REDEEMED VOID }

model RedemptionCode {
  id          Int                  @id @default(autoincrement())
  code        String               @unique            // 4 chars, uppercase
  itemId      Int
  discordId   String                                  // current holder at issue time
  status      RedemptionCodeStatus @default(ACTIVE)
  acquiredAt  DateTime             @default(now())    // purchase/grant time (backfill: ledger time)
  createdAt   DateTime             @default(now())
  redeemedAt  DateTime?
  redeemedRef String?              @unique            // e.g. "proofofpizza:<submissionId>"
  voidedAt    DateTime?
  voidReason  String?                                 // "sent" | "removed" | "reconcile"
  dmSentAt    DateTime?

  @@index([discordId, itemId, status])
}
```

No FK to `ShopItem` (keeps `deleteShopItem` behaviour unchanged; it already refuses held items).

## pizzadao-org changes

### Library: `app/lib/redemption-codes.ts` (new)
- `CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'`, `generateCode()` via `crypto.randomInt`.
- `normalizeCode(raw)`: trim, uppercase, strip spaces/dashes; valid iff `/^[2-9A-HJKMNP-Z]{4}$/`.
- `reconcileRedemptionCodes(tx, userId, opts?)`: reads `proofOfPizza.itemId` (0 -> no-op);
  takes `pg_advisory_xact_lock(hashtext('redeem:' || userId))`; compares ACTIVE count with
  `Inventory.quantity`; mints the difference or voids newest-first. Mint uses
  `createMany({ skipDuplicates: true })` in a retry loop (a failed INSERT aborts a Postgres
  transaction, so no try/catch on P2002). Returns `{ minted: string[], voided: number }`.
- `getMyCodes(userId)`: reconcile in its own tx, then list ACTIVE + last 10 REDEEMED.
- `lookupCode(code)`: `{ status: 'valid'|'redeemed'|'void'|'unknown', holderName, acquiredAt,
  redeemedAt, redeemedRef }`; holder name via `labelPeople` (`app/lib/shop-admin-people.ts`).
  ACTIVE whose holder no longer holds the item is treated as void (reconcile first).
- `redeemCode(code, ref)`: in one tx with the same advisory lock: if REDEEMED with the same ref
  -> `{ ok: true, already: true }`; REDEEMED with another ref -> conflict; VOID/unknown ->
  not found; else `updateMany where status ACTIVE` -> REDEEMED, then conditional inventory
  decrement (`quantity >= 1`), delete row at 0, write a `ShopAdminEvent`-style audit or a
  ledger-free note (no PEP moves). Any count mismatch throws and rolls back.

### Hook reconcile into every inventory write (inside the existing transaction)
- `app/lib/shop.ts` `buyItem` (web `/api/shop/buy` and Discord `/buy` both use it); return
  `redemptionCodes: string[]` in the result. Also `removeFromInventory`.
- `app/lib/shop-admin.ts` `adminGrantItem` (credited branch) and `adminRemoveItem`.
- `app/lib/shop-grants.ts` `applyGrant` and `creditPendingItemGrants` (pending grants credited on
  login, and `scripts/unbelievaboat/grant-items.mjs`).
- `app/api/inventory/send/route.ts`: reconcile sender and recipient.
- Add a test that greps for `inventory.(upsert|update|updateMany|delete|deleteMany)` outside the
  known list, so a future write site can't skip reconcile silently.

### Settings (`app/lib/settings/registry.ts`, area `features`; `toggles.ts`)
- `proofOfPizza.itemId` (`intSetting`, 0..2^31, default 0): "Shop item that carries Proof of
  Pizza codes. 0 = off." Confirm on change: "Codes will be issued for the new item."
- `proofOfPizza.dmOnPurchase` (`boolSetting`, default off, `confirmOn`) + toggles entry with env
  `PROOF_OF_PIZZA_DM_ENABLED` (env off wins; previews ignore saved rows, per toggles.ts).
- `proofOfPizza.siteUrl` (`urlSetting`, default `https://proofof.pizza`) for the steps and DM.
- Update `registry.test.ts` defaults lock.

### DM on purchase (feasible, cheap)
`sendDiscordDm` (`app/lib/followups/discord-dm.ts`, `DISCORD_BOT_TOKEN`) is two REST calls, no
cost. In `/api/shop/buy/route.ts` and the Discord interactions `buy` closure
(`app/api/discord/interactions/route.ts`), when `result.redemptionCodes.length` and the toggle is
on: `after(() => notifyRedemptionCodes(userId, codes))`. Message: codes + 3 steps + link, in the
member's locale if known (else English). DM closed (403) -> log, no retry; set `dmSentAt` on
success so a retry/backfill never double-DMs. The Discord `/buy` reply also gets a one-liner
"Your code is in your inventory on pizzadao.org" (no code in a channel reply).

### Server-to-server API (new; `runtime = 'nodejs'`, no-store)
Auth: `app/lib/proof-of-pizza-auth.ts`, same shape as `app/lib/calls/recorder-auth.ts`:
`Authorization: Bearer $PROOF_OF_PIZZA_API_KEY`, `timingSafeEqual`, fail closed (503 when unset).
- `POST /api/proof-of-pizza/codes/lookup` `{ code }` -> lookup result.
- `POST /api/proof-of-pizza/codes/redeem` `{ code, ref }` (`ref` = proofof.pizza submission id,
  stored as `proofofpizza:<id>`) -> `200 { ok, already }` | `404 unknown/void` | `409 used`.
- Rate limits (`app/lib/rate-limit.ts`): add `"pop-lookup": { limit: 60, windowSec: 60 }` and
  `"pop-auth-fail": { limit: 10, windowSec: 600 }` (per IP, checked before auth so a wrong key
  can't be brute-forced); lookup also keyed per caller via `checkKeyedRateLimit`.
- Malformed code -> 400 without a DB hit.

### Member UI + i18n
- `GET /api/proof-of-pizza/my-codes` (session, `requireOnboarded`) -> `getMyCodes`.
- `app/ui/shop/RedemptionCodes.tsx` (new): renders only when the member holds codes; large
  monospace code(s) with copy button, steps: 1) go to proofof.pizza 2) upload receipt + wallet
  3) enter the code. Redeemed codes listed muted. Shown on `/pep` (`InventoryWithSend` in
  `app/pep/page.tsx`) and in `app/ui/shop/InventoryList.tsx`. Never on the public
  `app/profile/[id]` page (codes are secrets).
- `messages/en.json`, `es.json`, `fr.json`: new `proofOfPizza` namespace (`title`, `steps.1-3`,
  `copy`, `copied`, `redeemedOn`, `dm.*`). Key-parity test already covers new namespaces.

### Backfill: `scripts/proof-of-pizza/backfill-codes.mjs` (new)
Dry run by default: lists every Inventory row of the configured item (counts only, no ids
printed beyond what the operator needs) and the codes it would mint, with `acquiredAt` from the
holder's earliest `SHOP_PURCHASE` `Transaction` whose metadata `itemId` matches (else now).
`--apply` runs `reconcileRedemptionCodes` per holder; `--dm` also sends the DM (respects
`dmSentAt`). **Prod `--apply` needs Snax's OK.** Today: 2 holders. The self-heal in `my-codes`
covers anyone missed.

## proof-of-pizza changes

- **Schema** (`prisma/schema.prisma`, new migration `20261123000000_pizzadao_code`):
  `Submission.pizzadaoCode String?`, `pizzadaoCodeRedeemedAt DateTime?`,
  `pizzadaoCodeError String?`, `@@index([pizzadaoCode])`. Additive; applied on build.
- **Form** `src/components/SubmissionForm.tsx`: optional "PizzaDAO code (optional)" input under
  notes, auto-uppercase, 4 chars, hint "From your inventory on pizzadao.org". No live check.
- **API** `src/app/api/submissions/route.ts`: zod `pizzadaoCode` optional, normalized, same regex;
  stored on create. Existing `limitByIp` stays.
- **Client lib** `src/lib/pizzadao.ts` (new, server only): `lookupPizzadaoCode`,
  `redeemPizzadaoCode(code, submissionId)`; `PIZZADAO_API_URL` + `PIZZADAO_API_KEY`, 5 s timeout,
  never imported by a client component.
- **Admin lookup** `src/app/api/admin/pizzadao-code/route.ts` (new, `requireAdmin`): `GET
  ?submissionId=` -> lookup result. Rate limit via `limitByIp(..., "pizzadao-lookup", 60, 60)`.
- **Admin UI** `src/components/SubmissionQueue.tsx`: rows with a code show a badge loaded lazily
  (Valid / Used / Void / Unknown + holder name + acquired date). "Redeemed" once
  `pizzadaoCodeRedeemedAt` is set; "Retry redeem" when `pizzadaoCodeError` is set.
- **Approve** `src/app/api/submissions/[id]/route.ts` PATCH: on `status: APPROVED` with a code
  and no `pizzadaoCodeRedeemedAt`, call redeem with the submission id. Success (incl.
  `already`) -> set `pizzadaoCodeRedeemedAt`. Failure (unknown/used/network) -> approval still
  saves, `pizzadaoCodeError` set, response carries a warning the queue shows. Approval is the
  admin's call; the code status is information. Add `POST /api/admin/pizzadao-code/redeem` for
  retry (same idempotent call).

## Env vars

| Project | Var | Envs | Notes |
|---|---|---|---|
| pizzadao-org (`onboarding`) | `PROOF_OF_PIZZA_API_KEY` | Production only, Sensitive | 32+ random bytes; unset on previews = API off |
| pizzadao-org | `PROOF_OF_PIZZA_DM_ENABLED` | optional | kill switch only (set `0` to force off) |
| proof-of-pizza | `PIZZADAO_API_KEY` | Production (+ Preview only if testing against prod) | same value |
| proof-of-pizza | `PIZZADAO_API_URL` | all | `https://pizzadao.org`; previews can point at a pizzadao-org preview URL |

## Tests (vitest in pizzadao-org; proof-of-pizza has none, add minimal ones or manual checks)
- `app/lib/redemption-codes.test.ts`: alphabet/normalize; reconcile mints N, voids on decrease,
  no-op when itemId 0 or other item; mint retry on collision (stub generator); redeem happy path
  consumes one unit; second redeem same ref -> already; other ref -> 409; VOID -> 404; redeem of
  a unit sent away -> 404.
- Concurrency test modeled on `shop-admin.concurrency.test.ts`: parallel buy + redeem + send
  keep the invariant.
- Route tests: lookup/redeem reject missing/wrong key (constant-time), 503 when unset, 400 on bad
  code, rate limit returns 429.
- `shop.test.ts`, `shop-admin.test.ts`, `shop-grants.test.ts`: reconcile called; codes in buy result.
- Inventory write-site guard test (above); `registry.test.ts`; i18n parity.
- proof-of-pizza: `npm run lint && npx tsc --noEmit && npm run build` locally.

## Deploy order and rollout
1. pizzadao-org migration: Neon branch, `prisma migrate status`, then prod (additive table/enum).
2. Merge + deploy pizzadao-org. Nothing changes yet (`itemId` = 0, DM off, key unset).
3. Generate the key; set `PROOF_OF_PIZZA_API_KEY` (pizzadao-org Production) and
   `PIZZADAO_API_KEY`/`PIZZADAO_API_URL` (proof-of-pizza); redeploy pizzadao-org prod.
4. Snax sets `proofOfPizza.itemId` in /admin/settings (find the id in /admin/shop).
5. Backfill dry run -> Snax OK -> `--apply` for the existing holders (DM by hand or `--dm` once
   the DM toggle is on).
6. Merge + deploy proof-of-pizza (its build applies its migration). Preview check first.
7. Snax switches `proofOfPizza.dmOnPurchase` on when ready.
Rollback: `itemId` = 0 stops minting; unsetting the key stops the API; proofof.pizza works
without it (code field optional, errors only flag the row).

## Verify
- Vercel preview (pizzadao-org): /pep and /shop render the codes card only for a holder; es/fr
  text; mobile (`/mobile-check`). Preview has no API key, so lookup returns 503 there (expected).
- `curl` lookup/redeem against prod with the key from a shell (never echo it): bad key 401,
  malformed 400, unknown code `unknown`.
- proof-of-pizza preview: submit with a code, admin queue badge, approve -> redeemed; approve
  again / retry -> `already`; member inventory loses one unit and shows "Redeemed".

## Risks
- Previews share the prod DB: any purchase on a preview mints real codes (acceptable; same as
  purchases today). Preview DMs are blocked by toggles.ts.
- Advisory-lock or reconcile bug could void a valid code; mitigated by tests and VOID being
  reversible by an admin SQL fix (audit row records why).
- A missed inventory write site breaks the invariant until self-heal; guard test catches it.
- Code guessing: 4 chars is small; mitigated by no public oracle, admin review, auth-fail rate
  limit. If proofof.pizza ever wants live validation, it must go through a server rate limit.
- proofof.pizza Vercel project access is unknown; env setup may block step 3.

## Needs Snax's decision
1. Redeem consumes the inventory unit (proposed) vs. keeps the item and only marks the code used.
2. Who owns the proofof.pizza Vercel project (not under the pizzadao/snax tokens) to set its env.
3. Approving with an unknown/used code: allowed with a warning (proposed) vs. blocked.
4. Whether the item should be non-sendable while it holds an ACTIVE code (proposed: sendable,
   codes void and re-mint).
5. OK for the prod migration and the backfill `--apply` for the 2 current holders.
