# Port "Get your mafia name" (pizzadao.org/get-your-mafia-name) into the onboarding app

Owner: Snax. Planned 2026-10-27. Status: Phase 1 merged (#189); Phase 2 implemented on `task/mafia-name-phase2`.

Phase 2 as built: `claims` use `MafiaNameClaim(discordId, name)` unique with a nullable FK to `MafiaPortrait`; the claim is written by `POST /api/mafia-name/claim` from the finale (on mount, and again when a portrait lands). `/made/[id]` uses the portrait file itself as the share image (WebP cannot be embedded in `next/og`), and `/made/[id]/og` is the topping-card fallback. Client funnel events (`topping_picked`, `film_picked`, `names_generated`, `name_rerolled`) go through `/api/activation` with closed code vocabularies; `name_claimed` is written server-side. `share_x`, `share_native` and `portrait_download` are not recorded yet.

## Summary

The Lovable site (repo `infi1trate/pizzadao-org`, `src/pages/MafiaNamePage.tsx`) has the same topping, film and name flow we already ported (FinaleScene, `app/lib/mafia-films.ts`, `app/lib/topping-images.ts` all came from it). What it has that we lack:
1. an AI portrait (rubber-hose cartoon animal),
2. a one-line explanation of each name,
3. a Share on X intent,
4. a claims table,
5. a public, no-login page.

We keep our name generation exactly as it is: `app/api/namegen/route.ts` (TMDB cast and character algorithm) and the picking in `NameStep.tsx`. We bring over the rest in three phases:
- **Phase 1:** portrait on the finale, plus Share on X.
- **Phase 2:** name origin line (deterministic, no AI) and a shareable `/made/[id]` page with an OG image.
- **Phase 3:** public `/get-your-mafia-name` with a "join the family" CTA that carries the picks into `/join`, then the pizzadao.org redirect.

## Decisions needed from Snax

**Decisions (Snax, 2026-10-27):** D1 OK to reuse infi1trate's prompts/code. D2 our existing OpenAI key. D3 portrait only on the finale. D4 caps as proposed (5/member, 3/IP, 300/day global). D5 yes: opt-in "use as profile picture", as its own task. D6-D9 the recommended defaults (origin line yes, no AI; claims table yes; no inline edit; ask infi1trate to redirect).


| # | Decision | Recommendation |
|---|---|---|
| D1 | Licensing: the portrait prompt (STYLE, TOPPING_MOTIF, FILM_MOOD, animal list) and the UI are infi1trate's work. The repo has no LICENSE file, and the last commit is by `gpt-engineer-app[bot]`. `mafia-films.ts` and the finale were already ported from it. | Get a written OK from infi1trate (a Discord message is enough) before Phase 1 merges. If they say no, I write a new prompt in the same spirit. |
| D2 | Image provider | **Decided (Snax, 2026-10-27): our OpenAI key.** `OPENAI_API_KEY` is already set on Vercel (Production, Preview, Development) and unused today. Call OpenAI's image API via `@ai-sdk/openai` + `generateImage` from `ai@7` (or a plain `fetch` to `/v1/images/generations`). Model `gpt-image-1` (check for a newer gpt-image model at implementation time), overridable with `MAFIA_PORTRAIT_MODEL`; 1024x1024, quality `medium`, `output_format: "webp"` to keep files small. |
| D3 | When to generate | Generate once, on the finale only, with Redraw. Do not generate per card: the Lovable site draws 3 portraits per name roll, which triples the cost. |
| D4 | Caps | Per member: 5 per day (first draw plus 4 redraws). Per IP when anonymous (Phase 3): 3 per day. Global: 300 per day (kill-switch env). That is at most about $12 a day. |
| D5 | Portrait as profile picture | Not automatic. Phase 2 adds an opt-in "Use as my profile picture" button. Today, PFPs are static files in `public/pfp/<id>.jpg` (22 files) resolved synchronously by `app/lib/pfp.ts`. Pointing them at a DB URL means `resolvePfpUrl(s)` becomes async with a DB lookup, which touches about 10 callers. That deserves its own task. |
| D6 | Name origin line | Yes. Derive it from our algorithm's inputs ("From Michael Corleone · The Godfather"). No AI. |
| D7 | Claims table | Yes, but small and only from Phase 2. It backs the share page. Funnel analytics reuse `ActivationEvent` rather than adding PostHog. |
| D8 | Inline name edit on the certificate | No. It was removed on purpose (calzone-65503 in `NameStep.tsx`). |
| D9 | pizzadao.org redirect | Ask infi1trate to add a redirect in the Lovable app. See Phase 3. |

## Facts found

- **AI:** `ai@^7` is installed (text via the Gateway in `summarize.ts`). `OPENAI_API_KEY` is set on Vercel for all environments and in `.env.local`, unused so far; portraits use it (D2). No AI image code yet. Add `@ai-sdk/openai` if using the SDK.
- **Rate limits:** `app/lib/rate-limit.ts` (Upstash or memory) has `checkKeyedRateLimit`. It fails open when Redis errors, so the global cost cap needs its own fail-closed check.
- **Blob:** `app/lib/blob-image-upload.ts` `uploadImageToBlob(File, prefix)` sniffs magic bytes and caps files at 5 MB. A 1024px WebP from OpenAI is a few hundred KB, so it fits.
- **Analytics:** `app/lib/activation.ts` `recordActivationLater(event, {actor, discordId, code})` writes to the `ActivationEvent` table and dedupes on actor+event+code. It already has non-stage events (`login_failed`), so new events fit there.
- **Finale:** `FinaleScene.tsx` already has the seal stamp, the archive number, the "approved — the family" note, the `navigator.share` + clipboard share, and the 6-phase timing. It only receives `mafiaName, memberId, dashboardHref`, so topping and film have to be passed in from `OnboardingWizard.tsx` (around line 659).
- **Inputs:** our 28 `PIZZA_TOPPINGS` are the same as their `TOPPING_MOTIF` keys. Our `MAFIA_FILMS` already carry `tone[]`. ToppingPicker and the film picker also accept free text.
- **Draft cookie:** `app/lib/signup-draft.ts` already persists `mafiaName` and `topping` in the signup draft cookie.
- **Middleware:** `proxy.ts` only matches `/disavow`.
- **Domains:** the app is `app.pizzadao.org` (Vercel). `pizzadao.org` uses Namecheap BasicDNS, and its apex A record is `185.158.133.1`. That is Lovable's host behind Lovable's own Cloudflare (`server: cloudflare`). We do not control a Cloudflare zone for it.

## Phase 1: Portrait on the finale, plus Share on X (smallest valuable slice)

### Steps
1. **`app/lib/mafia-portrait/prompt.ts`** (new, pure)
   - **Revised 2026-10-27 (Snax):** the rubber-hose STYLE / TOPPING_MOTIF / FILM_MOOD / animal prompt is replaced by Snax's character-generator guide, used essentially verbatim, with `{character_name}` = the member's mafia name. This intentionally reverses the "no name in the prompt" rule. The name is sanitized first (quotes, backticks, control chars and newlines stripped, whitespace collapsed, 60 chars max, empty rejected). Topping, film mood and the animal pick are dropped from the prompt.
   - Accent colors from the Ninja Turtle roles: Leonardo blue, Raphael red, Donatello purple, Michelangelo orange, April yellow, Splinter brown. Turtles are put in that canonical order; 1 turtle colors hatband, tie and pocket square; 2 spread as a/b/a; 3+ use the first three.
   - One prop from the first (alphabetical) known crew via a fixed crew-to-prop map (comms: microphone, tech: circuit-board briefcase, ops: clipboard, etc.); unknown or regional crews get no prop.
   - `buildPortraitPrompt({ name, turtles, crews })`. The route validates turtles and crews against the known lists (unknowns dropped, no free text), and the cache key is `sha256(v2|lower(name)|turtles|crews|variant)` with turtles and crews canonical and sorted.
2. **`app/lib/mafia-portrait/generate.ts`** (new)
   - Calls `generateImage({ model: openai.image(MODEL), prompt, size: "1024x1024", providerOptions: { openai: { quality: "medium", output_format: "webp" } }, abortSignal: AbortSignal.timeout(45_000) })` and takes `result.image` (bytes + mediaType).
   - Wraps the bytes in a `File` and calls `uploadImageToBlob(file, "mafia-portraits")`.
   - Returns `{ url, model }`.
   - Throws a typed `PortraitUnavailable` when no image comes back, on timeout, or on a provider 4xx/5xx.
3. **Prisma model `MafiaPortrait` plus migration** `prisma/migrations/2026102800000_mafia_portraits` (see Data model). The cache key is `sha256(lower(name)|topping|filmId-or-title|variant)`.
4. **`app/api/mafia-portrait/route.ts`** (new, `runtime = "nodejs"`, `maxDuration = 60`)
   - Request: `POST { name, topping, filmId?, filmTitle?, variant }`.
   - Validation (zod):
     - name: matches `sanitizeDisplayName`, at most 60 characters;
     - variant: 0-4;
     - topping: at most 50 characters;
     - filmId: must be in `MAFIA_FILMS`.
   - Flow:
     1. Kill switch: `MAFIA_PORTRAIT_ENABLED !== "1"`, or no `OPENAI_API_KEY` → 503 `{ fallback: true }`.
     2. Cache lookup by key; on a hit, return `{ url, animal, cached: true }` without touching the limits.
     3. Identity: session (`getSession()`) gives a Discord id; otherwise use the IP. In Phase 1, require a session, because the finale only runs after signup.
     4. Limits: `checkKeyedRateLimit("mafia-portrait-member", discordId)` (5 per 24h) and `"mafia-portrait-global"` with key `"all"` (300 per 24h). Add both to `RATE_LIMITS`. The global cap must **fail closed**: add a `failClosed` option to `checkKeyedRateLimit` for this one call. If Upstash is not configured, the memory fallback only works per instance, so on Vercel also require `isUpstashConfigured()` or return 503.
     5. Generate, insert a `MafiaPortrait` row (unique key; on a race, re-read the winner), and return `{ url, animal }`.
     6. `recordActivationLater("portrait_generated" | "portrait_failed", { discordId, code: reason })`. Add both names to the `ActivationEventName` union.
5. **`FinaleScene.tsx`**
   - New props: `topping`, `filmId?`, `filmTitle?`. `OnboardingWizard.tsx` passes `data.topping`, the film id found by matching `data.resolvedMovieTitle || data.mafiaMovieTitle` against `MAFIA_FILMS`, and the title.
   - Start the fetch on mount, in parallel with the 3.1s ceremony. Generation takes about 5-15s.
   - Seal: show the topping image (current look) with a subtle "developing..." shimmer, then cross-fade to the portrait inside the existing seal ring when it is ready. On failure or 503, keep the topping seal silently, with no error UI beyond a small "portrait unavailable" line.
   - New controls under the CTAs:
     - **Redraw** (`variant+1`, disabled at 4 or on 429, with the remaining count shown);
     - **Download PNG** (fetch the Blob URL, then `a.download = "<name>_pizzadao.png"`);
     - **Copy image** (`navigator.clipboard.write([new ClipboardItem({"image/png": blob})])`, falling back to "try Download").
   - `prefers-reduced-motion`: no cross-fade.
6. **Share on X**
   - Add a button next to "Share my name": `https://x.com/intent/tweet?text=…&url=…`. The text is a new i18n key, `shareXText`: "Just got made. {name} 🍕". The url is `https://app.pizzadao.org/join` in Phase 1 and `/made/[id]` in Phase 2.
   - X intents cannot attach images. Phase 2's OG card is how the portrait shows up on X.
7. **i18n:** new `onboarding.finale` keys in `messages/en.json`, `es.json` and `fr.json`:
   - `portraitDeveloping`, `portraitUnavailable`, `portraitAlt`;
   - `redraw`, `redrawsLeft`, `download`, `copyImage`, `imageCopied`, `copyImageFailed`;
   - `shareX`, `shareXText`.
8. **Env:** set `MAFIA_PORTRAIT_ENABLED=1` and optionally `MAFIA_PORTRAIT_MODEL` in Preview and Production. Locally, `OPENAI_API_KEY` is already in `.env.local`.

### Files (Phase 1)
- **New:**
  - `app/lib/mafia-portrait/{prompt,generate}.ts`, plus `prompt.test.ts` and `generate.test.ts`;
  - `app/api/mafia-portrait/route.ts`, plus `route.test.ts`;
  - the migration.
- **Edit:**
  - `prisma/schema.prisma`;
  - `app/lib/rate-limit.ts` (two limits, plus the `failClosed` option);
  - `app/lib/activation.ts` (event names);
  - `app/ui/onboarding/FinaleScene.tsx`;
  - `app/ui/onboarding/OnboardingWizard.tsx`;
  - `messages/{en,es,fr}.json`.

## Phase 2: Name origin line and shareable /made page

1. **Origins from namegen (additive only)**
   - In `generateNames`, record the source of each candidate in a parallel map. Return a new field, `origins: Record<string, { kind: "character"|"actor"|"director"|"iconic"; person: string }>`.
   - `castNames` entries get a separate `origin` field. Directors get `kind: "director"` in that field only. Their `source` stays `"actor"`, so ordering and output are byte-identical.
   - `suggestions` and `candidatePool` must not change. A golden test locks this before the edit: fixed TMDB fixtures in, snapshot of suggestions and pool out.
   - Copy (in each language): "From {person} · {film}", "From the {person} family · {film}" (iconic), "From director {person} · {film}". Show it under each name card in `NameStep.tsx` (no layout change to reroll or calzone-65503 behavior) and as the descriptor on the finale certificate. Store it in wizard state via `types.ts`.
2. **`MafiaNameClaim` model** (see below). It is written on finale mount by `POST /api/mafia-name/claim`, which is idempotent per actor+name. The claim gets a short public id.
3. **`app/made/[id]/page.tsx` plus `opengraph-image.tsx`**
   - The page is a public, read-only certificate: name, origin line, portrait, archive number, and a "Join the family" CTA.
   - The OG image comes from `next/og` `ImageResponse` (1200x630, portrait plus name). The X share url becomes `/made/[id]`.
   - Only the name, origin and portrait are exposed: no member id, no Discord. `noindex` is optional.
4. **Opt-in PFP (D5):** add a `portraitUrl` column on `MemberProfileExtras` and a "Use as profile picture" button. Changing what `resolvePfpUrl` resolves to is a **separate task** (it becomes async, and about 10 callers change).
5. **Funnel events:** `name_rolled` (from namegen calls made by the wizard, client-side through the existing activation-client), `name_claimed`, `share_x`, `share_native`, `portrait_download`.

## Phase 3: Public /get-your-mafia-name and the redirect

1. **`app/get-your-mafia-name/page.tsx`**
   - Metadata, plus an entry in `sitemap.ts`. No session needed.
   - It renders a new `MafiaNameFlow` client component that reuses ToppingPicker, the film picker, and `NameStep` in a standalone mode. This means extracting `NameStep`'s wizard coupling into callbacks, with no behavior change inside `/join`.
   - It ends on `FinaleScene` with `mode="public"`. In that mode, "Continue to dashboard" becomes "Join the family" and links to `/join?name=…&topping=…&film=…&from=mafia-name`.
2. **`OnboardingWizard`:** read those params and seed `data`:
   - `name` passes through `sanitizeDisplayName`;
   - `topping` is capped at 50 characters;
   - `film` must be a `MAFIA_FILMS` id, otherwise a title capped at 120 characters.
   - Land on the name step with the name pre-selected. Record `signup_started` with code `mafia_name_page`.
3. **Anonymous portraits:** the same route, keyed per IP with `"mafia-portrait-ip"` at 3 per 24h, under the global cap. Optionally add a Vercel BotID or Turnstile check later if abuse shows up. The namegen limit (30 per minute per IP) already applies.
4. **Redirect of pizzadao.org/get-your-mafia-name**
   - pizzadao.org is served by Lovable on its own Cloudflare. Our only lever is the Namecheap apex A record. Moving the apex to Vercel would take over the whole marketing site, so don't.
   - **Recommended:** ask infi1trate to replace their route with a redirect to `https://app.pizzadao.org/get-your-mafia-name` (client-side `window.location.replace`, keeping the query string), and to delete their two edge functions so their Lovable AI spend stops.
   - **Later alternative:** if pizzadao.org ever moves behind a Cloudflare zone or Vercel project we control, use a server-side 301 rule for that path.
   - Nothing is changed in this task.

## Data model (Prisma, Neon; the migration runs against prod before merge because previews share the DB)

```prisma
model MafiaPortrait {
  id        String   @id @default(cuid())
  cacheKey  String   @unique            // sha256(lower(name)|topping|film|variant)
  name      String   @db.VarChar(80)
  topping   String   @db.VarChar(50)
  filmKey   String   @db.VarChar(120)   // MAFIA_FILMS id or clamped title
  variant   Int      @default(0)
  animal    String   @db.VarChar(40)
  model     String   @db.VarChar(80)
  url       String                      // Vercel Blob public URL
  discordId String?                     // null for anonymous (Phase 3)
  createdAt DateTime @default(now())
  @@index([discordId, createdAt])
}

// Phase 2
model MafiaNameClaim {
  id          String   @id              // short public id (nanoid-ish, 10 chars) for /made/[id]
  actor       String                    // activation actor or HMAC member key
  discordId   String?
  source      String   @db.VarChar(16)  // "join" | "public"
  topping     String   @db.VarChar(50)
  filmKey     String   @db.VarChar(120)
  tmdbMovieId String?
  candidates  Json                      // names shown (incl. rerolled), for funnel analysis
  name        String   @db.VarChar(80)
  origin      Json?                     // { kind, person, film }
  portraitId  String?
  createdAt   DateTime @default(now())
  @@unique([actor, name])
  @@index([createdAt])
}
```

There is no `contact_handle`. Unlike Lovable, we collect contact details through signup.

## API routes
- `POST /api/mafia-portrait` (Phase 1; anonymous callers in Phase 3)
- `POST /api/mafia-name/claim` (Phase 2)
- `GET /made/[id]` page and `/made/[id]/opengraph-image` (Phase 2)
- `/api/namegen`: additive `origins` field only (Phase 2)

## Env vars
| Var | Where | Notes |
|---|---|---|
| `MAFIA_PORTRAIT_ENABLED` | Preview and Prod | `"1"` turns it on; anything else is the kill switch |
| `MAFIA_PORTRAIT_MODEL` | optional | default `gpt-image-1` |
| `MAFIA_PORTRAIT_DAILY_CAP` | optional | default 300 |
| `OPENAI_API_KEY` | existing (all envs) | OpenAI image auth |
| `BLOB_READ_WRITE_TOKEN`, `KV_REST_API_URL/TOKEN` | existing | already set |

## Cost per portrait
- OpenAI `gpt-image-1` list prices for 1024x1024: about $0.011 (low), $0.042 (medium), $0.167 (high). The prompt (~900 tokens) adds well under $0.01.
- **Recommended: medium, about $0.04 per draw.** A member who uses every redraw costs at most about $0.21; the global cap of 300/day means at most about $13 a day. Low quality would cut that to about $3.50 a day if the look holds up.
- Blob storage: a 1024px WebP is a few hundred KB, which is negligible.
- Confirm current prices on OpenAI's pricing page and check the key's usage limits before launch.

## Risks
- **Licensing (D1):** we would reuse prompts and code without a license.
- **Model safety:** the prompt tells the model to draw no humans, no celebrities and no weapons, but it may still produce something off. Mitigations: names and free-text are kept out of the prompt, a Redraw button exists, and admins can delete by `cacheKey` (manual SQL plus a Blob delete for now).
- **Latency:** 5-15s, with a 45s timeout. The finale must never wait on the portrait. Vercel `maxDuration` is 60.
- **Cost runaway:** if Redis is down, the per-member and per-IP limits fail open. The global cap must fail closed, and the kill-switch env stays available.
- **OpenAI key limits:** the shared key may have a low usage tier/rate limit; verify on the first preview, and keep the 45s timeout plus fallback.
- **Prod DB shared with previews:** the migration is additive (new tables only) and safe to apply before merge.
- **Namegen regression:** the Phase 2 origin change touches `generateNames`. The golden test is mandatory.
- **ClipboardItem image copy** is unsupported in Firefox and some iOS versions. Fall back to "Download".

## Test plan
- **Vitest:**
  - `prompt.test.ts`:
    - animal choice is deterministic and matches the reference `hashString`;
    - every one of the 28 toppings has a motif;
    - the name and free-text film never appear in the prompt;
    - free-text topping sanitizing works.
  - `generate.test.ts`: mock `ai`. A file result gives an upload; no file or a timeout gives `PortraitUnavailable`.
  - `route.test.ts`:
    - cache hit skips the limits and the provider;
    - per-member 429;
    - global cap fails closed when Upstash throws;
    - 503 when disabled;
    - zod rejects variant 5 and an unknown filmId;
    - a 401 without a session (Phase 1).
  - Phase 2 namegen golden test: fixtures in, snapshot out. Origins exist for every suggestion.
  - Phase 2: `/join` param seeding sanitizes the name, topping and film.
  - i18n parity test: every new key exists in en, es and fr (run the existing parity check if there is one).
- **Manual on the Vercel preview** (`/ship`):
  1. Run the wizard to the finale. Check the seal, then the portrait cross-fade and how long it takes.
  2. Redraw up to the cap; the button disables.
  3. Download a PNG and copy the image (Chrome and Safari).
  4. Check the X intent text in en, es and fr.
  5. Set `MAFIA_PORTRAIT_ENABLED=0`: the finale must still be clean.
  6. Check reduced motion.
  7. Run `/mobile-check` on the finale.
- Check usage in the OpenAI dashboard after the preview run to confirm the per-image cost.
- **Phase 3:** run the anonymous flow end to end into `/join`, check the name and topping are pre-filled, and check that the per-IP 429 shows a friendly message.
