# woodfired-65373: Check Box Mafia role and suggest buying a box

Stage: doing · Priority: P3 · Branch: `task/woodfired-65373`

## Open questions for Snax

1. **Box Mafia role ID.** It is not in the code. The only mention is
   `app/lib/pep-earn/income.ts` (`{ name: 'Box Mafia', amount: 42 }`), which has no `roleId`
   and is looked up by name from the guild role list at runtime. The plan does the same name
   lookup. If you'd rather have the ID pinned, send it (Discord: Server Settings → Roles → Box
   Mafia → Copy Role ID) and I'll hardcode it as `BOX_MAFIA_ROLE_ID`.
2. **Where to buy.** No purchase URL is in the code. The Rare Pizzas Box contract is on Ethereum at
   `0x4ae57798aef4af99ed03818f83d2d8aca89952c7` (confirmed on harvest.art). The plan's default is
   the OpenSea collection page `https://opensea.io/collection/rare-pizzas-box`. Please confirm the
   slug, or give a different link (rarepizzas.com mint page, a PEP shop item, etc.). Note that the
   PEP shop also has a "Rare Pizza Box" item (UnbelievaBoat import, 42,069 PEP). Should the
   suggestion point there, to OpenSea, or to both?
3. **Who grants the role today?** Is Box Mafia token-gated by Collab.Land or Guild.xyz, or given by
   hand? If a bot already handles it, this task only adds the suggestion. If nothing does, we could
   add "you own a box but don't have the role" detection plus a bot role grant. That is
   **Phase 2 below and not in scope unless you say so.**
4. **Placement.** The default is a small dismissible card on the dashboard, below the Next Action
   panel. It does **not** go into the Next Action priority chain, so it never pushes aside crews,
   missions, or vouches. Is that right, or should it also show on `/nfts` or `/pep`?
5. **Copy.** Proposed headline: "Join the Box Mafia". Body: "Holders of a Rare Pizzas Box get the
   Box Mafia role in Discord (+42 PEP a day with /collect-income)." CTA: "Get a box". Is it OK to
   mention the PEP income?

## Goal

On `/dashboard/[id]`, if the signed-in member **definitely does not** have the Box Mafia Discord
role, show a short suggestion card with a link to buy a Rare Pizzas Box. Hide the card when they
have the role, when the role status is unknown (Discord API down, no bot token in previews, role
not found by name), or after they dismiss it.

## What exists today (research)

- `app/lib/discord.ts`: `fetchGuildMember(userId)` (60s Next fetch cache), plus `hasRole`,
  `hasAnyRole`, and `getUserRoles`. When the bot token or guild ID is missing it returns `null`
  without throwing.
- `app/lib/discord-interactions/guild-roles.ts`: `getGuildRoles(guildId)`. In-memory cache of
  `{id,name}` with a 1h TTL and a 1.5s timeout. Keeps the stale list if a refresh fails.
- `app/lib/pep-earn/income.ts`: `normalizeRoleName()` and `resolveRoleIncome()`. This is the name
  to ID resolution pattern used for "Box Mafia" today. It refuses to guess when zero or several
  roles match the name.
- Role constants: `app/ui/constants.ts` (`DREAD_PIZZA_ROBERTS_ROLE_ID`, `PIZZA_CAPO_ROLE_ID`,
  `MISSION_REVIEWER_ROLE_IDS`). `app/lib/mission-verify/mission-config.ts`
  (`PEPPERONI_MAFIA_ROLE_ID`). There is no Box Mafia constant.
- NFTs: `app/lib/nft-config.ts` loads contracts from a Google Sheet; the "Rare Pizza Box" name is
  matched in `app/lib/mafia-points/config.ts`. `app/lib/nft.ts` `fetchPizzaDAONFTs(wallet)` reads
  every contract through Alchemy (2h cache). It is heavy, and only Phase 2 would need it.
- Dashboard: the `app/api/dashboard-summary/route.ts` backend-for-frontend endpoint is owner-only
  with a 60s in-memory cache. It already calls `hasAnyRole(discordId, MISSION_REVIEWER_ROLE_IDS)`,
  which fetches the guild member. `app/dashboard/[id]/page.tsx` renders `NextActionPanel` from
  `summary.nextAction`. `NextActionPanel.tsx` has a localStorage snooze pattern we can copy.
- i18n: `messages/{en,es,fr}.json` under the `dashboard` namespace.
  `app/lib/i18n/__tests__/catalog-parity.test.ts` checks that all locales have the same keys.

## Approach

### Server

1. **New `app/lib/box-mafia.ts`** (pure plus thin I/O):
   - `export const BOX_MAFIA_ROLE_NAME = "Box Mafia"`.
   - `export const BOX_PURCHASE_URL = process.env.NEXT_PUBLIC_BOX_PURCHASE_URL || "https://opensea.io/collection/rare-pizzas-box"`
     (the value depends on Q2).
   - `resolveBoxMafiaRoleId(guildRoles)` is pure. It returns `process.env.BOX_MAFIA_ROLE_ID` if
     that is set and valid (`/^\d{5,25}$/`). Otherwise it returns the single guild role whose
     `normalizeRoleName` equals `"boxmafia"`. If there are zero or several matches it returns
     `null`. Reuse `normalizeRoleName` from `pep-earn/income.ts`.
   - `boxMafiaStatus(memberRoles: string[] | null, roleId: string | null): "has_role" | "missing" | "unknown"`
     is pure. It returns `unknown` if either input is null.
   - `getBoxMafiaStatus(discordId)` does the I/O. It calls `getGuildRoles(process.env.DISCORD_GUILD_ID)`
     and `fetchGuildMember(discordId)`, then calls the two functions above. It never throws.
2. **`app/api/dashboard-summary/route.ts`**:
   - Fetch `fetchGuildMember(discordId)` **once**. Derive `isReviewer` from it (same behavior as
     `hasAnyRole`) and pass `member.roles` to the box check, so there is no second guild call.
     Run `getGuildRoles` in the existing `Promise.all`, wrapped in `safe(..., null)`.
   - Add `boxMafia: { status: "has_role" | "missing" | "unknown"; purchaseUrl: string }` to
     `DashboardSummary`. Do **not** change `resolveNextAction`.

### Client

3. **New `app/dashboard/[id]/components/BoxMafiaSuggestion.tsx`**:
   - Renders only when `status === "missing"` and the card is not dismissed.
   - It is a small editorial card (`rounded-2xl border border-[hsl(var(--rule-warm)/0.55)] p-5`,
     the same style as the `optionalSetup` section) with an overline, headline, body, an external
     CTA (`<a href target="_blank" rel="noopener noreferrer">`, `btn-pill min-h-11`), and a
     "Not now" button.
   - "Not now" writes the localStorage key `pizzadao:box-mafia-suggestion:dismissedUntil` with a
     30-day snooze. Copy the read/write/try-catch helpers from `NextActionPanel`. Read storage in
     `useEffect` to avoid a hydration mismatch.
4. **`app/dashboard/[id]/page.tsx`**: render `<BoxMafiaSuggestion boxMafia={summary?.boxMafia} />`
   directly after the `NextActionPanel` block.

### i18n (`messages/en.json`, `es.json`, `fr.json`, under `dashboard.boxMafia`)

```json
"boxMafia": {
  "overline": "§ · box mafia",
  "headline": "Join the Box Mafia",
  "body": "Hold a Rare Pizzas Box to get the Box Mafia role in Discord — plus {amount} PEP a day with /collect-income.",
  "cta": "Get a box",
  "notNow": "Not now",
  "ariaLabel": "Box Mafia suggestion"
}
```

Write Spanish and French translations (keep "Box Mafia" and "Rare Pizzas Box" untranslated).
Pass `amount` from `DEFAULT_ROLE_INCOME` (42) on the server as `boxMafia.dailyPep`. If Snax
rejects the PEP mention (Q5), drop it.

### Phase 2 (only if Snax says no bot grants the role, per Q3)

- Add `ownsBox(memberId)`. It takes the member's EVM wallets (`getEvmWalletsForMember`) and makes
  one Alchemy `getNFTsForOwner?contractAddresses[]=<box contract>` call per wallet, not the
  all-contract `fetchPizzaDAONFTs`. Cache it for 2h.
- If the member owns a box but lacks the role, show "You hold a box — claim your Box Mafia role"
  instead of "buy". Optionally grant the role with the bot (`PUT /guilds/{g}/members/{u}/roles/{r}`;
  the bot needs Manage Roles and must sit above Box Mafia in the role list). This would be a
  separate PR with its own plan.

## Alternatives considered

- **Add `box_mafia` to the Next Action chain.** Rejected. That chain is one slot for the single
  most important step. A shopping nudge would push out missions and vouches, or never show for
  active members.
- **Check NFT ownership instead of the role.** Rejected for Phase 1. It needs a linked wallet
  (many members have none), the Alchemy calls are slow, and the role is what the task names.
- **Hardcode the role ID now.** It isn't in the repo, and guessing is unsafe. The name lookup
  plus an env override covers both cases.
- **Client-side fetch of roles.** Rejected. It needs the bot token and belongs in the existing
  owner-only BFF.

## Risks

- **Name lookup fails** (role renamed, emoji-only differences, or two roles named alike). The
  status becomes `unknown` and the card hides. That is the safe failure, and setting
  `BOX_MAFIA_ROLE_ID` fixes it.
- **Previews have no bot token.** The status is `unknown`, so the card never shows on preview
  unless the env vars are set there (see Verify).
- **Extra latency.** `getGuildRoles` is cached for 1h with a 1.5s timeout, and the guild member
  is fetched once (it was already being fetched). The net change is about zero.
- **Stale role after purchase.** The summary cache is 60s and the role grant depends on a bot.
  The 30-day dismiss lets members hide the card meanwhile.
- **Wrong purchase link.** It is behind `NEXT_PUBLIC_BOX_PURCHASE_URL`, so it can be fixed
  without a code change.

## Files

| File | Change |
|---|---|
| `app/lib/box-mafia.ts` | new: constants, `resolveBoxMafiaRoleId`, `boxMafiaStatus`, `getBoxMafiaStatus` |
| `app/lib/box-mafia.test.ts` | new: unit tests |
| `app/api/dashboard-summary/route.ts` | single guild-member fetch; add `boxMafia` to payload |
| `app/dashboard/[id]/components/BoxMafiaSuggestion.tsx` | new card |
| `app/dashboard/[id]/components/BoxMafiaSuggestion.test.tsx` | new component tests |
| `app/dashboard/[id]/components/dashboard-i18n.test.tsx` | add es/fr render check |
| `app/dashboard/[id]/page.tsx` | render the card after NextActionPanel |
| `messages/en.json`, `messages/es.json`, `messages/fr.json` | `dashboard.boxMafia.*` |
| `.env.example` (if present) | document `BOX_MAFIA_ROLE_ID`, `NEXT_PUBLIC_BOX_PURCHASE_URL` |

## Tests

- `box-mafia.test.ts`:
  - The env ID wins.
  - The name lookup is case-, space- and emoji-insensitive ("📦 Box-Mafia" matches).
  - Zero or two matches give `null`.
  - `boxMafiaStatus` covers `has_role`, `missing`, and `unknown` (null roles or null roleId).
  - `getBoxMafiaStatus` returns `unknown` when `fetchGuildMember` returns null (mock `@/app/lib/discord`).
- `BoxMafiaSuggestion.test.tsx`:
  - The card renders for `missing` and not for `has_role` or `unknown`.
  - The CTA href equals `purchaseUrl` with `target=_blank` and `rel=noopener noreferrer`.
  - "Not now" hides the card and writes localStorage. A future snooze timestamp suppresses the
    card on mount.
- `dashboard-i18n.test.tsx`: the es and fr headlines render, with no raw keys.
- The existing `catalog-parity.test.ts` enforces key parity.
- `next-action.test.ts` should not change, which confirms the Next Action chain is untouched.
- Run: `npx vitest run app/lib/box-mafia.test.ts app/dashboard app/lib/i18n`, then `npm run lint`,
  `npx tsc --noEmit`, and `npm run build`.

## Verify on the Vercel preview

1. Make sure the preview env has `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID`. Otherwise the status
   is `unknown` and the card is hidden by design. Check this with
   `VERCEL_TOKEN="$(vercel-token)" vercel env ls`.
2. Log in as a member **without** Box Mafia. The card appears below Next Action and the CTA
   opens the purchase URL in a new tab. "Not now" hides it, and it stays hidden after reload.
3. Log in as a member **with** Box Mafia. No card.
4. Switch the language to es and fr. The copy is translated.
5. Check mobile (`/mobile-check`) at 375px. The CTA wraps cleanly and both buttons are at least 44px.
6. In the network tab, `/api/dashboard-summary` has `boxMafia.status`. Compare response time with
   prod: there should be no noticeable regression.

## Rollout

- One PR through `/ship`. There are no migrations.
- Optional env vars, which can be set in Vercel before or after the merge:
  - `BOX_MAFIA_ROLE_ID`: recommended once Snax gives the ID.
  - `NEXT_PUBLIC_BOX_PURCHASE_URL`: only if the link differs from the default.
- The feature fails closed: if anything is unknown, the card is not shown, so there is no
  kill-switch to manage. To turn it off, set `NEXT_PUBLIC_BOX_PURCHASE_URL` to empty and make the
  component treat a falsy URL as "hide".
- Phase 2 (ownership check and role grant) is a separate task if Snax wants it.

## Decisions (Snax, 2026-10-18)

Go with the plan's defaults:
1. Look the role up by name, with the optional BOX_MAFIA_ROLE_ID override.
2. Buy link: the OpenSea default (https://opensea.io/collection/rare-pizzas-box), overridable with NEXT_PUBLIC_BOX_PURCHASE_URL.
3. Phase 2 (granting the role to box holders) is out of scope.
4. A dashboard card only.
5. The copy may mention +42 PEP a day with /collect-income.
