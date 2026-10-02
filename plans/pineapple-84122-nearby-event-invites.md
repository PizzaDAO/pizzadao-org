# pineapple-84122: Auto-invite members to events near their city

Status: design only, decisions needed. No code in this PR.

## Goal

When a pizza party is published on rsv.pizza near where a member lives, that member gets an invite through a
channel they opted into. They can RSVP in one click. We should never spam, and never invite people to private
events.

## What exists today

### pizzadao-org (app.pizzadao.org)

- **Member location** is a free-text `City` column in the Google Sheets roster (`member-repository.ts` maps
  `city`). Onboarding fills it through Google Places autocomplete (`/api/city-autocomplete`).
  **We don't store a place_id, lat/lng or country code.**
- **Region:** `app/lib/region-mapping.ts` maps an ISO country code to 9 regions (`NORTH_AMERICA` ...
  `OCEANIA`) and their Discord region roles. `/api/city-region` turns a Places `place_id` into country, then
  region, then role at onboarding time. The derived region is only persisted as a **Discord role**, not in our
  DB.
- **City chapters:** `data/city-chapters.json` (about 530 cities, each with a Telegram chat URL) and
  `/api/city-telegram` give fuzzy city matching. That's useful as a fallback "your city's chat" link.
- **Channels available:** in-app `Notification` (Prisma, `NotificationType` enum), Discord DM
  (`app/lib/discord.ts` `sendDM`), Discord webhooks (`app/lib/discord-webhook.ts`), and, after calzone-93434,
  a linked Telegram identity (`TelegramAccount`). The bot can't DM yet; see "Telegram" below.

### rsv.pizza (`/Users/samweinrott/Code/pizzadao/rsv-pizza`)

- Express + Prisma backend on Supabase Postgres, deployed as its own Vercel project. The frontend is
  `https://rsv.pizza`.
- **`Party` (`parties`)** has the geo fields we need: `latitude`, `longitude`, `city`, `country`, `region`,
  `address`, `placeId`, `timezone`, `date`, `endTime`, plus `addressIsCityDefault` (coordinates are city-level
  only).
  - **Visibility isn't one flag.** Treat an event as public only if all of these hold:
    - `eventType != 'private'`
    - no `password`
    - `underbossStatus in ('approved','listed')` (for GPP and series events)
    - `cancelledAt is null`
  - `maxGuests`, `requireApproval` and `rsvpClosedAt` gate RSVPs.
  - The event URL is `rsv.pizza/{customUrl || inviteCode}`.
- **`Guest`** is identified by email, wallet or Privy ID. **There is no Discord id.** `status` includes
  `'INVITED'`, which is excluded from capacity counts. `submittedVia` includes `'api'` and `'invite'`.
- **Public listing APIs:**
  - `GET /api/gpp/events` filters by `city`, `country` and `region`, and returns lat/lng, but **only for
    `eventType='gpp'`**.
  - `GET /api/series/:slug/events` returns approved or listed events in a series.
  - Neither has a radius query.
- **API keys (`/api/v1`)** are scoped to the key owner's own parties:
  - `GET /api/v1/parties` lists only `userId`'s events.
  - `POST /api/v1/parties/:id/guests` and `send-invite` require ownership.
- **Webhooks** (`party.created`, `party.updated`, `party.cancelled`, ...) only fire to the event owner's own
  keys. **No platform-wide event feed exists.**
- **Geo helpers:** `backend/src/lib/geocode.ts` (Nominatim with Google fallback) and
  `backend/src/lib/distance.ts` (`haversineKm`). GPP creation already does an 80 km proximity check.
- **Email:** Resend.

**Bottom line:** today there is no way for app.pizzadao.org to discover all public upcoming events near a point,
or to create guests on parties it doesn't own. Phase 1 needs a small addition on the rsv.pizza side.

## Proposed design

### 1. rsv.pizza: a public "nearby events" feed (new, small)

`GET /api/public/events/upcoming?since=<iso>&lat=&lng=&radiusKm=&limit=`

- Applies the public-visibility predicate above and returns only future events (`date > now()`, or
  `endTime > now()`).
- Response: `{ id, slug, url, name, date, endTime, timezone, city, country, region, latitude, longitude,
  addressIsCityDefault, eventType, seriesSlug, updatedAt, cancelledAt }`. Never include host email, address
  details or the guest list.
- Two modes:
  - **Incremental:** `since=updatedAt` cursor, so the pizzadao-org cron can poll everything that changed.
  - **Geo:** bounding box prefilter in SQL, then `haversineKm`.
- Auth: public and cached (like `/api/gpp/events`), or protected by a **PizzaDAO platform key** (a new
  `ApiKey` scope `events:read:all`). Recommend the platform key, so we control rate and can add fields later.

Alternative: a platform-wide outbound webhook (`party.published`) to app.pizzadao.org. It has lower latency, but
needs a new "platform subscriber" concept in `webhook.service.ts`. Polling every 15 minutes is simpler and is
good enough for parties announced days or weeks ahead.

### 2. pizzadao-org: member locations (new model)

```
model MemberLocation {
  discordId    String   @id
  memberId     String?
  cityRaw      String            // as typed in the roster, for change detection
  placeId      String?
  lat          Float?
  lng          Float?
  countryCode  String?
  region       String?           // region-mapping.ts key
  geocodedAt   DateTime?
  source       String            // "onboarding" | "backfill" | "manual"
}
```

- **Going forward:** onboarding already has the Places `place_id`. Save it plus geocoded lat/lng and country
  when `/api/city-region` runs (one extra write).
- **Backfill:** a one-off script geocodes the roster's `City` strings with the Google Geocoding API (already
  keyed as `GOOGLE_MAPS_API_KEY`) and caches them by normalized string, since many members share a city.
  Unresolvable strings stay null and are excluded.
- **Change detection:** the daily job compares `cityRaw` with the sheet and re-geocodes on change.

### 3. Matching

For each new or updated public event `E` with coordinates:

1. **Radius match (primary).** Members with `haversine(member, E) <= radiusKm`.
   - Default radius is 50 km, or 100 km when `E.addressIsCityDefault` (city-level coordinates are fuzzy).
   - Members can override it to 10, 25, 50, 100 or 250 km.
2. **City-string fallback** for members without coordinates: normalized `E.city` equals the member's city,
   using the same tiering as `/api/city-telegram` `findBestMatch`, to avoid "New York" matching "New Haven".
3. **Region match (opt-in, low volume).** `resolveRegionFromCountryCode(E.countryCode) === member.region`.
   This only feeds a **weekly regional digest**, never an individual invite. Regions are continent-sized, so
   a "near you" invite from a region match would be wrong.
4. Exclusions:
   - already invited (`EventInvite` exists)
   - the member is the event's host or a co-host
   - the event is full or RSVP is closed
   - the event starts within 12h, or more than 60 days out
   - the member is over their frequency cap

```
model EventInvite {
  id          Int      @id @default(autoincrement())
  discordId   String
  rsvpEventId String           // rsv.pizza Party.id
  channel     String           // "discord_dm" | "telegram" | "email" | "in_app" | "digest"
  distanceKm  Float?
  matchedBy   String           // "radius" | "city" | "region"
  sentAt      DateTime @default(now())
  clickedAt   DateTime?
  rsvpedAt    DateTime?
  @@unique([discordId, rsvpEventId])
  @@index([rsvpEventId])
}
```

### 4. Notification channels

| Channel | Pros | Cons / requirements |
|---|---|---|
| In-app `Notification` (new `EVENT_NEARBY` type) | Free, no consent issues | Only seen when the member visits |
| Discord DM via bot (`sendDM`) | Most members are reachable | Members can have DMs off; Discord rate-limits bulk DMs; can feel spammy |
| Telegram bot DM | Good for chapters that live on Telegram | The member must have linked Telegram **and** granted `request-access=write` (or started the bot). Needs a bot send path |
| Email (Resend, as rsv.pizza does) | Highest reach for RSVP | We don't store member emails in pizzadao-org today, so we'd need a consented email field |
| City chat (Telegram group or Discord city channel) | One message reaches the whole chapter | Not personal; needs the group's bot or webhook |

**Recommendation for v1:** in-app notification plus Discord DM for members who opted in, and a post to the city
chapter's chat link where one exists. Telegram DM comes in v2, once the bot can message linked members.

The invite message includes the event name, date (in the event's timezone), distance, and a deep link
`https://rsv.pizza/{slug}?ref=pizzadao&m=<signed member token>`. rsv.pizza can use the signed token to prefill
name and email and attribute the RSVP back (`clickedAt` / `rsvpedAt`).

We shouldn't create `Guest` rows with status `INVITED` on the member's behalf in v1. That needs the host's
consent (it's their guest list), and the v1 API keys can't do it anyway.

### 5. Opt-in and preferences

Add a new `MemberEventPrefs { discordId @id, nearbyInvites Boolean @default(false), radiusKm Int @default(50),
channels String[], regionalDigest Boolean @default(false), maxPerWeek Int @default(3), updatedAt }`.

- **Opt-in, off by default.** Show a toggle on `/profile/[id]/edit` and a one-time prompt on the dashboard
  after onboarding ("Want to hear about pizza parties near {city}?").
- Every message has a one-click unsubscribe (signed link) and a "change radius" link.
- Frequency cap: at most N invites per member per week, with extras rolled into the weekly digest.
- Quiet hours: send between 9am and 8pm in the member's local time, from the timezone we geocode.

### 6. Job

Run a Vercel cron every 15 minutes on pizzadao-org (`/api/cron/nearby-events`, protected with
`checkSecret(..., "CRON_SECRET")`):

1. Fetch rsv.pizza events changed since the cursor.
2. For each newly public event, match members, insert `EventInvite` rows (the unique constraint makes retries
   idempotent), and enqueue sends.
3. Send with a concurrency limit and back off on Discord 429s.
4. On `cancelledAt`, send a short "cancelled" follow-up only to members who clicked.

Scale check: about 10k members and about 2k events a year (mostly GPP week) means the matching is trivial in
SQL or in memory. GPP week is the spike, with hundreds of events in a few days. The frequency cap and digest
fallback matter most there.

## Privacy

- Never expose member locations publicly or to rsv.pizza. Matching happens on our side, and rsv.pizza only
  learns about members who click through.
- Store coordinates at city level only (geocode the city, not the address).
- Respect `hideGuests`, and never show a member who else was invited.

## Phasing

1. **Phase 0:** decisions below, plus the rsv.pizza feed endpoint and platform key (rsv-pizza PR, which needs a
   prod migration only if we add an `ApiKey` scope).
2. **Phase 1:** `MemberLocation` backfill, prefs UI, in-app and Discord DM invites with a radius match, and a
   GPP-only pilot (it already has a public endpoint, so it can start before the feed ships).
3. **Phase 2:** Telegram DM, regional digest, click and RSVP attribution.
4. **Phase 3:** let hosts opt their event into "invite nearby PizzaDAO members" and create `INVITED` guests
   with host consent.

## Decisions needed

1. **Opt-in vs opt-out.** Recommend opt-in (default off), with a prominent prompt.
2. **Which events qualify?** GPP and series only (curated through `underbossStatus`), or any public rsv.pizza
   event? Any public event raises the risk of spam or unsafe events. Recommend GPP and approved series for v1.
3. **Default radius,** and whether the region match is allowed for individual invites (recommend digest only).
4. **Channels for v1,** and whether we start collecting consented member emails.
5. **rsv.pizza integration:** a new platform feed endpoint with a key (recommended), a platform webhook, or
   direct read access to the Supabase DB (fast but couples the two schemas; not recommended).
6. **Frequency cap** and quiet-hours policy.
7. **Host consent** before members appear on a guest list as `INVITED` (Phase 3).
8. **Ownership:** who maintains the cron and responds to "why did I get this?" support tickets. These can route
   to `/support` from buffalo-96244.
