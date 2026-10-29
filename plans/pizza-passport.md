# Pizza Passport: stamps for independent pizzerias

Status: plan, awaiting Snax's decisions (section 12). Source: Ops call; idea and Bolt prototype by Don Scrimmy John.
No TASKS.md row yet. Suggested: `margherita-<n> | Pizza Passport (stamps for independent pizzerias) | todo | P2 | plans/pizza-passport.md`.

## 1. Goal

Members collect a **stamp** for each local, independent pizzeria they visit. Each stamp looks like a smudged
ink stamp of the pizzeria (its logo when we have permission, otherwise a typographic stamp). A visit is a
**check-in** that we verify, and members with a stamp can leave a **review**. The passport is one of the main
blocks on the member profile. It ties into missions, POAPs (the poap-claims feature in progress on
`task/poap-claims`) and the Global Pizza Party (GPP).

Big chains are excluded. The point is to send people to independent shops, and the GPP partner pizzerias are
the natural first stamps.

Non-goals for v1: a full Yelp clone, PEP payouts per stamp (they invite fraud; see Phase 3), on-chain stamps.

## 2. What exists today (relevant to this plan)

- **DB**: Prisma 7 on **Neon Postgres** (`app/lib/db.ts`, `PrismaNeon`). The project CLAUDE.md says Supabase,
  but this app's DB is Neon. Migrations live in `prisma/migrations/<ts>_<name>/migration.sql`.
- **Profile**: `app/profile/[id]/ProfileClient.tsx` composes `ProfileHero`, `AboutChips`, `CrewChipRow`,
  `ContributionsBlock`, `AttendanceCard` and `CollectionsLazy` (POAPs/NFTs, lazy). The passport block goes here.
- **POAPs**: `app/lib/poap.ts` (POAP Compass + a whitelist sheet), `PoapFirstSeen` model, `app/ui/poap/*`.
  `task/poap-claims` (worktree `.claude/worktrees/agent-aabf37618de8ef3df`) has no passport-relevant code or
  plan yet, so the integration has to stay loosely coupled (section 9).
- **Missions**: `Mission` rows with `verifierKey`/`verifierParams`. The registry is in
  `app/lib/mission-verify/verifiers.ts`, data access is in `sources.ts`, and seeds are in
  `scripts/seed-missions.mjs`. A level is done only when every active mission in it is approved (or the level
  is already paid; see `computeCurrentLevel`), so a new mission blocks *new* members on that level.
- **GPP data**: `data/gpp-contracts.json` (GPP event contracts on Base with `event_location` strings) and the
  rsv.pizza API (`RSV_PIZZA_API_URL`, `RSV_PIZZA_SERVICE_KEY`, used by the `gpp_host` verifier).
- **Google**: `GOOGLE_MAPS_API_KEY` is already used for city autocomplete and timezone.
- **Uploads**: `app/lib/blob-image-upload.ts` handles Vercel Blob uploads with magic-byte sniffing (no SVG,
  5 MB). `app/lib/mafia-portrait/generate.ts` already generates images with OpenAI `gpt-image-1` and stores them
  in Blob.
- **Rate limiting**: `app/lib/rate-limit.ts` (Upstash, with an in-memory fallback). `checkKeyedRateLimit` gives
  per-user limits.
- **Guards**: `requireSession`, `requireAdmin` and `hasAnyRoleSafe` in `app/lib/auth-guards.ts`.
  `MissionHold.NEW_ACCOUNT` sets the precedent of holding results for Discord accounts younger than 30 days.
- **Print**: `app/print` and `app/ui/print/catalog.ts` hold printable assets, which is where partner QR table
  tents can go.
- **i18n**: `messages/en.json`, `es.json` and `fr.json` all need new keys (next-intl).

## 3. Pizzeria data source

| Source | Coverage / quality | Cost | Can we store it? | Chain detection |
|---|---|---|---|---|
| **Overture Maps Places** (monthly GeoParquet on S3/Azure) | Global, Meta + Microsoft + Foursquare + AllThePlaces, with confidence scores. Category `pizza_restaurant`. | Free. One-time import via DuckDB, then a monthly refresh. | Yes: CDLA-Permissive-2.0 / Apache / CC0 per source. Attribution required. | `brand.wikidata` and `brand.names` fields |
| **OSM via Overpass** | Variable. Strong in Europe, weak in parts of LatAm and Africa. `cuisine=pizza`. | Free. The public Overpass has rate limits, so don't call it per request. | Yes, but the DB is ODbL: attribution plus share-alike on the derived database. | `brand`, `brand:wikidata` (name-suggestion-index) |
| **Foursquare OS Places** | Large (100M+ POIs), Apache-2.0. Category "Pizzeria". | Free dataset. The paid Places API has a free tier. | Yes (Apache-2.0) | Chains only in the paid API (verify) |
| **Google Places API (New)** | Best freshness and coverage, plus logos/photos | Nearby Search Pro is $32/1k after 5k free calls/month per SKU. Autocomplete is billed per session. | **No.** The ToS allows caching only `place_id`. Lat/lng can be cached for 30 days at most, and names, addresses and photos can't be stored. That rules out a stored catalog. | Weak (no brand field) |

**Recommendation:** use **Overture as the stored catalog**, imported only for pizza categories, plus
**member-submitted pizzerias** that an admin approves and **admin-added partners**. Use OSM/Overpass only as an
offline gap-filler during imports. Don't use Google for the catalog. Optionally, use Google Autocomplete in the
"add a missing pizzeria" form, keeping only the `place_id`, while the member confirms the name. Rough size: on
the order of a few hundred thousand pizza places worldwide, which is fine for Neon. The import can also start
with only the countries that have chapters (`data/city-chapters.json`). Measure the real count in Phase 0.

**Chain exclusion** (an `isChain` flag with a reason, layered):
1. Overture `brand.wikidata` / OSM `brand:wikidata` is non-null → chain, unless the brand is on an allowlist of
   small local multi-location brands.
2. A curated denylist in `app/lib/passport/chains.ts`, matched on normalized names and Wikidata QIDs: Domino's,
   Pizza Hut, Papa John's, Little Caesars, Sbarro, Marco's, Papa Murphy's, Telepizza, Pizza Pizza, 241, Round
   Table, CiCi's, Hungry Howie's, Jet's, MOD, Blaze, &pizza, PizzaExpress, Pizza Inn, Debonairs, Chicago Town,
   Dodo Pizza, etc. Keep it editable as a JSON list.
3. Heuristic: the same normalized name at 10 or more locations in the import → flagged for admin review, not
   auto-excluded, since many family brands have 2 or 3 shops.
4. Admin override in both directions (`chainOverride`).

Chains stay in the DB as hidden rows, so check-in search can say "chains don't earn stamps" instead of "not
found".

## 4. Check-in verification

Options, from cheapest to strongest:

| Method | Strength | UX | Notes |
|---|---|---|---|
| Self-report | none | best | Only fine with no rewards attached |
| **Geo radius** (browser Geolocation) | medium. Spoofable with devtools or mock-location apps. | one tap | Require `accuracy <= 150 m` and `distance <= 150 m` (larger for big venues). The server recomputes haversine and never trusts the client's distance. |
| Photo | low-medium | ok | EXIF GPS is unreliable: iOS Safari strips location on upload, so EXIF can't be a requirement. Photos are useful as review content and for human review. |
| Receipt photo | medium | friction | Needs human or AI review. Privacy (card digits). Not worth it for v1. |
| **Partner QR** | high, combined with geo | great | A static QR on a table tent or sticker encodes `/passport/q/<pizzeriaSlug>.<code>`, where code = HMAC(`PASSPORT_QR_SECRET`, pizzeriaId + qrVersion). A leaked photo of the QR still needs geo to match, and rotating means bumping `qrVersion` and reprinting. |
| Staff code | high | needs staff | Later, with the partner portal (Phase 4) |

**Recommendation:**
- **Partner pizzerias**: QR + geo → auto-approved stamp. If the QR is valid but geo is missing or denied → a
  PENDING stamp an admin can release.
- **Any other non-chain pizzeria**: geo within the radius → auto-approved, subject to anti-abuse rules. A photo
  is optional and is shown on the stamp detail.
- Outside the radius, or geo denied → no stamp. The member can save the place to a "want to visit" list later.
- Verification strength is stored per check-in (`method`). Stamps from QR show a small "verified at partner"
  mark.

## 5. Anti-abuse

Shaped like missions: holds rather than clawbacks.
- One stamp per (member, pizzeria). Repeat check-ins add to `visits`, at most 1 per pizzeria per local day.
- At most **5 new stamps per member per day** (`checkKeyedRateLimit`). IP rate limit on the check-in route.
- **Impossible travel**: if a new check-in is more than (elapsed hours × 900 km/h + 50 km) from the member's
  previous one, it's held PENDING with `riskFlags.velocity`.
- **New Discord account** (< 30 days, same signal as `MissionHold.NEW_ACCOUNT`) → held.
- **Disavowed** members (LISTED/SUSPENDED in `app/lib/disavow/access.ts`) cannot check in.
- **Accuracy gaming**: reject `accuracy > 150 m`. Readings of exactly 0 m or suspiciously round coordinates go
  into `riskFlags`.
- **Clustering**: many accounts checking in at one place within minutes from the same IP → flag for review, not
  auto-reject (groups of friends are legit).
- No PEP per stamp in Phases 1–2. When rewards come (Phase 3), they're milestone-based (e.g., 5 stamps, 3
  countries), so farming one block of pizzerias pays little.
- Admin queue at `/admin/passport`: pending check-ins, flagged reviews, member-submitted pizzerias, chain
  overrides.
- Privacy: raw lat/lng on a check-in is kept for 30 days (for review) and then nulled by the existing cron
  pattern. Only `distanceM` and `accuracyM` are retained.

## 6. Data model (Prisma; one migration per phase)

```prisma
enum PizzeriaSource { OVERTURE OSM MEMBER ADMIN GPP }
enum PizzeriaStatus { ACTIVE PENDING HIDDEN CLOSED }
enum CheckInMethod  { GEO QR QR_NO_GEO ADMIN }
enum CheckInStatus  { APPROVED PENDING REJECTED }
enum ReviewStatus   { VISIBLE HIDDEN }

model Pizzeria {
  id            String         @id @default(cuid())
  slug          String         @unique            // "lucalis-brooklyn"
  name          String         @db.VarChar(160)
  address       String?
  city          String?        @db.VarChar(120)
  countryCode   String?        @db.VarChar(2)
  lat           Float
  lng           Float
  source        PizzeriaSource
  sourceId      String?                            // Overture id / osm "node/123"
  brandName     String?
  brandWikidata String?
  isChain       Boolean        @default(false)
  chainReason   String?                            // "wikidata" | "denylist" | "admin"
  chainOverride Boolean?                           // admin: true=force chain, false=force independent
  status        PizzeriaStatus @default(ACTIVE)
  isPartner     Boolean        @default(false)
  partnerSince  DateTime?
  qrVersion     Int            @default(1)
  logoUrl       String?                            // Blob, partner-granted only
  logoConsentAt DateTime?
  stampInk      String?        @db.VarChar(16)     // hex override
  gppEventSlug  String?                            // links to a GPP event (rsv.pizza)
  poapEventId   String?                            // optional partner POAP drop
  website       String?
  createdBy     String?                            // discordId for MEMBER submissions
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
  checkIns      PizzeriaCheckIn[]
  stamps        PassportStamp[]
  reviews       PizzeriaReview[]
  @@unique([source, sourceId])
  @@index([lat, lng])
  @@index([countryCode, city])
  @@index([isPartner])
}

model PizzeriaCheckIn {
  id          Int           @id @default(autoincrement())
  pizzeriaId  String
  discordId   String
  memberId    String?
  method      CheckInMethod
  status      CheckInStatus @default(APPROVED)
  lat         Float?        // nulled after 30 days
  lng         Float?
  accuracyM   Int?
  distanceM   Int?
  photoUrl    String?
  riskFlags   Json?
  reviewedBy  String?
  createdAt   DateTime      @default(now())
  pizzeria    Pizzeria      @relation(fields: [pizzeriaId], references: [id])
  @@index([discordId, createdAt])
  @@index([pizzeriaId, createdAt])
  @@index([status])
}

model PassportStamp {
  id             Int      @id @default(autoincrement())
  discordId      String
  memberId       String?
  pizzeriaId     String
  firstCheckInId Int
  visits         Int      @default(1)
  verified       Boolean  @default(false)   // QR at partner
  stampedAt      DateTime @default(now())
  pinned         Boolean  @default(false)   // shown first on profile
  pizzeria       Pizzeria @relation(fields: [pizzeriaId], references: [id])
  @@unique([discordId, pizzeriaId])
  @@index([discordId, stampedAt])
}

model PizzeriaReview {
  id         Int          @id @default(autoincrement())
  pizzeriaId String
  discordId  String
  rating     Int          // 1..5 (slices)
  body       String?      @db.VarChar(1000)
  photoUrl   String?
  status     ReviewStatus @default(VISIBLE)
  createdAt  DateTime     @default(now())
  updatedAt  DateTime     @updatedAt
  pizzeria   Pizzeria     @relation(fields: [pizzeriaId], references: [id])
  @@unique([pizzeriaId, discordId])
  @@index([pizzeriaId, createdAt])
}
```

Geo queries: a bounding-box prefilter on `(lat, lng)` followed by haversine in TS (`app/lib/passport/geo.ts`).
That's enough at this scale and avoids PostGIS/Prisma friction. PostGIS (available on Neon) is a later
optimization if nearby search gets slow. Add a `passportVisibility` (`public` | `members` | `private`) column to
`MemberProfileExtras`.

## 7. Stamp art (logo → ink stamp)

**Rendering (v1, $0): a deterministic SVG component** `app/ui/passport/InkStamp.tsx`:
- Shape: circle, rounded rectangle or oval, picked by `hash(pizzeriaId)`. A double border ring with the name on
  a text path, plus the city and `MM·YYYY` on the bottom arc.
- Center: the partner logo (if consented) rendered as single-color ink: `feColorMatrix` maps luminance to
  alpha, then `feFlood` with the ink color and `feComposite in`. Without a logo, a slice/peel glyph and the
  initials.
- Smudge: `feTurbulence` + `feDisplacementMap` (scale 2–4) roughens edges, and a second turbulence used as an
  alpha mask gives uneven ink coverage. The rotation is a seeded ±10°, with `mix-blend-mode: multiply` over a
  paper texture. Seeding by stamp id makes every stamp unique but stable.
- Ink color by region: red, blue, green, purple, black. A partner can choose it (`stampInk`).
- Must render server-side for OG images. `next/og` (satori) doesn't support SVG filters, so OG cards use a
  pre-rendered PNG (below) or a simple non-filtered version.

**Logo preprocessing** (partner uploads only): `scripts/passport/process-logo.mjs`, admin-run, uses `sharp`
(a dev dependency, or reuse Next's bundled copy) to trim, grayscale, threshold to 1-bit, resize to 256 px and
write a transparent PNG to Blob (`passport/logos/<slug>.png`). The admin uploads through the existing
`uploadImageToBlob` path, which rejects SVG. That's consistent with the security posture.

**Optional later:** a `gpt-image-1` "hand-carved rubber stamp" variant for partners, reusing
`app/lib/mafia-portrait/generate.ts`. Not v1: it costs money per image and the results are inconsistent.

**Logo licensing:** pizzeria logos are trademarks and usually copyrighted artwork.
- **Default: no third-party logos.** Non-partners get the typographic stamp (name + city + glyph), which is
  nominative use of a business name and low risk.
- **Partners** grant a written license when they join. The partner form has a checkbox: "PizzaDAO may display our
  logo as a passport stamp in the app and on social shares; revocable by email". `logoConsentAt` records it.
  Revoking it means clearing `logoUrl`, after which stamps fall back to typographic.
- Never scrape logos from Google, websites or Overture photos.

## 8. Profile and app UI

- **Profile**: a new `app/ui/profile/PassportBlock.tsx`, lazy like `CollectionsLazy`, placed directly after
  `ContributionsBlock` in `ProfileClient.tsx` so it's "a main part" of the profile. It shows a header line ("12
  stamps · 4 countries · 3 partner"), a passport-page grid of `InkStamp`s (pinned first, then newest; 12 visible
  and "See all"), and an empty state with a "Find a pizzeria near you" CTA when viewing your own profile. It
  respects `passportVisibility`. **Privacy: public stamps show month/year, never exact dates or times, and stamps
  appear 6 hours after check-in**, so a public profile isn't a live location feed (decision D7).
- **API**: `GET /api/passport/[memberId]` (cached and visibility-aware), `GET /api/passport/nearby?lat&lng`
  (session required and rate-limited; returns non-chain ACTIVE pizzerias within 2 km), `POST
  /api/passport/check-in` (`{pizzeriaId, lat, lng, accuracy, qr?, photo?}`), `POST
  /api/passport/pizzerias` (member submission → PENDING), `POST/PUT /api/passport/reviews` (requires a stamp),
  and admin routes under `/api/admin/passport/*`.
- **Pages**: `/passport` (my passport, plus a big "Check in" button), `/passport/check-in` (geolocate → nearby
  list → tap → stamp animation; reuse the celebration loop style in `app/lib/celebration.ts`),
  `/passport/q/[code]` (QR landing: logs in if needed, then runs the check-in), `/pizzerias/[slug]` (public page
  with the stamp, aggregate rating and reviews by stamp holders; feeds the sitemap and SEO), and
  `/admin/passport`.
- **Mobile first**: check-ins happen on phones. Run `/mobile-check` on the preview.
- **Bolt prototype**: get Don Scrimmy John's Bolt link or export before building the UI, and reuse its layout and
  copy where it fits (D9).

## 9. Missions, POAPs, GPP

- **Mission verifier** `passport_stamps` in `verifiers.ts` with params
  `{ min: number, distinctCountries?: number, partnerOnly?: boolean }`, reading `PassportStamp` through a new
  `sources.ts` getter. Because every mission in a level is required, adding one blocks new members on that
  level. Options: (a) add "Collect 3 passport stamps" as a new **L4** mission (L4 "Do some dirty work" is
  IRL-ish); (b) replace L2.0's "say hi on a call" with "call **or** stamp" (the engine has no OR; that would need
  a composite verifier); (c) keep passport goals as side achievements outside levels (D5). Recommendation: (c) in
  Phase 2 and (a) in Phase 3, once it's proven that stamps are reachable worldwide.
- **POAPs** (keep the coupling loose; the poap-claims branch has nothing to bind to yet):
  - `Pizzeria.poapEventId`: a partner can have a POAP drop, and a verified (QR) stamp makes the member eligible.
    The passport calls a small interface `grantPoapClaim(discordId, poapEventId, reason)`, to be provided by
    poap-claims. Until it exists, the stub records eligibility to a table or log.
  - Milestone POAPs (first stamp, 10 stamps, 5 countries, "visited 3 GPP venues") also go through the same
    interface.
  - **Retro stamps**: members who already hold a GPP POAP or GPP ticket (`data/gpp-contracts.json`) for an event
    at a now-partner pizzeria get a backfilled stamp (`method=ADMIN`, `verified=true`). This seeds profiles on
    day one. Matching event to pizzeria is manual through `gppEventSlug`.
  - Coordinate with whoever owns `task/poap-claims`: agree on the `grantPoapClaim` signature before Phase 3.
- **GPP**: the GPP host flow (rsv.pizza) gains "is your venue a pizzeria? Become a Passport partner", which sets
  `isPartner` + `gppEventSlug`. Every GPP venue that is a pizzeria becomes a stamp location on party day, and the
  GPP printables include the passport QR.

## 10. Phased rollout

Feature flag `PASSPORT_ENABLED`, plus `PASSPORT_PUBLIC_PROFILE` for the profile block. Each phase is its own PR
through `/ship`.

**Phase 0: spike and decisions (1–2 days, no prod changes)**
1. Get the Bolt prototype from Don Scrimmy John.
2. Run a DuckDB query against the latest Overture release: count `pizza_restaurant` (plus `pizza` alternates)
   globally and in the 20 biggest chapter cities, and measure chain-flag precision on a sample of 200
   (`scripts/passport/overture-spike.sql`).
3. Snax answers section 12.

**Phase 1: partner pilot (GPP partner pizzerias only)**
1. Migration: `Pizzeria`, `PizzeriaCheckIn`, `PassportStamp` and `MemberProfileExtras.passportVisibility`.
2. `app/lib/passport/{geo,chains,qr,checkin,abuse}.ts` with unit tests.
3. Admin: `/admin/passport` to add or edit a partner (name, address → lat/lng via the existing Google geocode
   key, only for admin-entered partner rows the partner supplied, which is fine under the ToS), upload a logo
   with the consent checkbox, and print the QR (a new entry in `app/ui/print/catalog.ts`, built from a
   per-pizzeria QR route).
4. Check-in (QR + geo), the `/passport` page, `PassportBlock` on the profile and `InkStamp`.
5. Seed 10–30 partners from GPP 2026 venues (rsv.pizza plus `data/gpp-contracts.json` locations), confirmed by
   the GPP crew.
6. Retro stamps for GPP POAP holders (if D6 is yes).
7. i18n en/es/fr.
Exit criteria: about 50 real stamps and no fraud incidents in 4 weeks.

**Phase 2: open passport (any independent pizzeria)**
1. Overture import script `scripts/passport/import-overture.mjs` (DuckDB → NDJSON → batched upserts on
   `(source, sourceId)`), run by an admin locally and monthly.
2. Chain classifier plus an admin review list.
3. Geo-only check-ins, `/api/passport/nearby` and member-submitted pizzerias (PENDING).
4. Reviews (stamp holders only, 1–5 slices, optional photo through `uploadImageToBlob`), `/pizzerias/[slug]` and
   a report button that feeds the admin queue.
5. Anti-abuse holds and the 30-day coordinate scrub (added to an existing cron route).
6. Overture attribution in the footer of pizzeria pages.

**Phase 3: rewards**
1. The `passport_stamps` verifier and mission placement per D5.
2. Milestone and partner POAPs through poap-claims.
3. Optional milestone PEP (ledger rows like `MISSION_REWARD`, capped).
4. Leaderboards (most countries, most partner stamps) and an X share card for a new stamp.

**Phase 4: partner program**
1. A self-serve partner claim page (verified by email to the business domain or a code posted in the shop),
   logo upload, partner POAPs and "Passport partner" window stickers.
2. A map view (MapLibre + free OSM tiles, or a Google Maps JS key).
3. Staff codes for higher-assurance events.

## 11. Risks

- **Location spoofing**: geo is beatable. Mitigations are no per-stamp rewards, QR for partners, holds and
  velocity checks. Accept that some cheating will happen.
- **Privacy and safety**: public stamps reveal places people frequent. Mitigations are delayed display,
  month-only dates, visibility settings, and scrubbing raw coordinates after 30 days.
- **Data quality**: Overture has closed or mislabeled places. Members can report "closed" or "not a pizzeria",
  and admins resolve the reports.
- **Chain mislabels**: small family brands flagged as chains. Admin override and the allowlist handle these.
- **Logo IP**: handled by using partner logos only, with consent.
- **Review moderation**: reviews are public UGC. Mitigations are stamp-gating, a report button and admin hide.
  We can't moderate at Yelp scale, so this stays gated.
- **ODbL contamination**: if OSM rows are mixed in, the derived DB is ODbL. Prefer Overture and keep the
  `source` column so OSM rows can be dropped.
- **Scope creep**: a phased flag rollout. Phase 1 alone is useful.
- **Coupling with poap-claims**: use the interface stub. Don't import from an unmerged branch.

## 12. Decisions for Snax

- **D1 Catalog source:** Overture as the stored catalog plus member submissions; no Google catalog
  (recommended). Alternative: Google Places live search (better data, ~$32/1k after the free tier, can't store).
- **D2 Who can check in:** any logged-in member (recommended, since it's a growth hook), or level 2+.
- **D3 Verification bar:** QR+geo for partners and geo-only elsewhere (recommended). Or require a photo
  everywhere (more friction, little extra assurance).
- **D4 Reviews:** stamp holders only, from Phase 2 (recommended)? Ratings as 1–5 slices?
- **D5 Missions:** side achievements first and an L4 mission in Phase 3 (recommended), or put it in a level now.
- **D6 Retro stamps** for existing GPP POAP or ticket holders at partner venues: yes or no?
- **D7 Profile privacy defaults:** public, month-only dates, 6-hour delay (recommended), or members-only by
  default.
- **D8 Logos:** partners only, with consent (recommended), or also show logos for non-partners (legal risk).
- **D9 Bolt prototype:** who gets the link from Don Scrimmy John, and is his UI the design baseline?
- **D10 Partner pilot list:** which GPP pizzerias, and who on the GPP crew owns outreach and QR printing?
- **D11 Naming:** "Pizza Passport"? Stamp ink colors by region?
- **D12 PEP:** none until Phase 3, then milestone-only (recommended)?

## 13. Verification

- **Unit (vitest)**: haversine and bounding box; the chain classifier (denylist, wikidata, allowlist, override);
  QR HMAC sign/verify and version bump; the check-in decision table (QR±geo, radius, accuracy, daily cap,
  velocity, new account, disavowed → APPROVED/PENDING/REJECTED); stamp upsert idempotency (a second check-in
  increments `visits` with at most one per day); the visibility filter on `GET /api/passport/[memberId]`; the
  `passport_stamps` verifier, following the existing `verifiers.test.ts` patterns.
- **Migration**: `npx prisma migrate diff` / `prisma generate`, plus `npm run build` and `npm run lint`.
- **Vercel preview** (`/ship`):
  1. Admin creates a test partner at the tester's own location and prints or opens the QR.
  2. On a phone, scan the QR → log in → stamp is granted with the animation → it appears on `/passport`.
  3. Desktop Chrome DevTools → Sensors → override the location far away → the check-in is rejected.
     Override it nearby → approved. Do two check-ins on different continents 10 minutes apart → held.
  4. The profile shows `PassportBlock` with month-only dates, the visibility toggle hides it for logged-out
     viewers, and the stamps look smudged and vary in rotation and shape across 6+ stamps.
  5. `/mobile-check` on `/passport`, `/passport/check-in` and `/profile/<id>`.
  6. es/fr locales render without missing-key warnings.
- **Phase 2 extra**: run the Overture import on a single small country against the preview DB branch, and spot-
  check that the 20 biggest chain names are hidden.

## 14. Files to change (Phases 1–2)

- New: `app/lib/passport/{geo,chains,qr,checkin,abuse,stamps}.ts` (+ tests), `app/api/passport/**` and
  `app/api/admin/passport/**` routes, `app/passport/{page,check-in/page,q/[code]/page}.tsx`,
  `app/pizzerias/[slug]/page.tsx`, `app/admin/passport/page.tsx`,
  `app/ui/passport/{InkStamp,StampGrid,CheckInFlow}.tsx`, `app/ui/profile/PassportBlock.tsx`,
  `scripts/passport/{overture-spike.sql,import-overture.mjs,process-logo.mjs}` and `data/passport-chains.json`.
- Edit: `prisma/schema.prisma` + migration(s), `app/profile/[id]/ProfileClient.tsx` (mount `PassportBlock`),
  `app/lib/rate-limit.ts` (new rule names), `app/ui/print/catalog.ts` (partner QR table tent), `app/sitemap.ts`
  (pizzeria pages), `messages/{en,es,fr}.json`, and in Phase 3 `app/lib/mission-verify/{verifiers,sources}.ts`
  and `scripts/seed-missions.mjs`.

## Decisions (Snax, 2026-10-27)
- Start with the Phase 1 pilot: GPP partner pizzerias, table QR + location; stamps are side achievements (not level requirements).
- Next: get Don Scrimmy John's Bolt prototype link.

## Phase 1 build notes
- Built as the partner pilot: partner pizzerias only, table QR + location, stamps are side achievements (not level requirements).
- Open decisions taken at the recommended option: D2 any logged-in member, D3 QR+geo for partners, D6 no retro stamps for now, D7 public profile with month-only dates and a 6 hour delay, D8 partner logos only with a consent box, D11 name "Pizza Passport", D12 no PEP.
- On/off and tunables are DB settings (`passport.*`, edited at /admin/settings), off by default. `PASSPORT_ENABLED=off` in the environment is a kill switch that wins. Table QR codes need `PASSPORT_QR_SECRET`, which must be identical in Preview and Production (a QR printed from one must work on the other). QR links always use `NEXT_PUBLIC_APP_URL`, falling back to https://app.pizzadao.org, never the request origin.
- The UI is our own design. A community-made prototype can restyle it later: `app/ui/passport/InkStamp.tsx` and `StampGrid.tsx` take plain props, and the pages are thin.
- A daily cron (`/api/cron/passport-scrub`) clears check-in coordinates older than 30 days; rejected check-ins never store coordinates.
- Not in phase 1: the printable catalog entry (the admin page prints each QR as SVG), nearby search, reviews, the `passport_stamps` mission verifier.
