# ricotta-58420 — Switch hardcoded pizzadao.org refs to app.pizzadao.org

## Context

The onboarding app moved to `app.pizzadao.org` and `pizzadao.org` was cut over (DNS-level, 2026-05-17) to a new Lovable marketing site. Two code references still bake in the bare apex; both should point at the app subdomain.

Vercel env vars are already set (`NEXT_PUBLIC_BASE_URL=https://app.pizzadao.org`, `DISCORD_REDIRECT_URI=https://app.pizzadao.org/api/discord/callback`), so the `discord-webhook.ts` fallback technically never fires — but a stale fallback string is still a foot-gun.

The Farcaster share text is the user-visible one — after cutover, "pizzadao.org" in the share text leads invitees to the brochure instead of the social/vouch flow.

## Files to change

### 1. `app/lib/discord-webhook.ts:119`
```ts
// before
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://pizzadao.org";
// after
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://app.pizzadao.org";
```

### 2. `app/ui/vouches/FarcasterDiscovery.tsx:76`
```ts
// before
const baseText = "Join the party on PizzaDAO! 🍕 pizzadao.org";
// after
const baseText = "Join the party on PizzaDAO! 🍕 app.pizzadao.org";
```

## Do NOT change
- `data/projects-config.json:11` (`liveUrl: https://pizzadao.org`) — correctly points at the new marketing site
- `app/ui/constants.ts:82` — comment only
- `app/lib/sync-roles-on-login.ts:11` — JSDoc example only
- `app/lib/sync-roles-on-login.test.ts`, `components/projects/*.test.tsx`, `app/lib/projects/github.test.ts` — test fixtures, leave

## Verification
- TypeScript builds (`npm run build` may fail on the pre-existing vitest deps issue per project memory — Vercel build is the source of truth)
- Vercel preview deployment succeeds
- `/vouches` page renders Farcaster discovery UI with updated share text
