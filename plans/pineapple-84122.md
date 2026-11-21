# pineapple-84122: Invite members to events near their city

Status: plan v2 (2026-11-21). Replaces `plans/pineapple-84122-nearby-event-invites.md` (2026-10-02). Since then
the app gained the reminders DM pipeline, the Telegram send proxy, verified member emails, the rsv.pizza
service key and the map-levels place resolver, so most of the plumbing exists.

## Open questions for Snax

1. **Invite = notification, not auto-RSVP.** Recommended: a DM/notification with the RSVP link. We never
   create guests on someone else's party. Default: notification.
2. **Opt-in or opt-out.** Recommended: opt-in (off per member). Show a one-time prompt on the dashboard and
   a toggle with the other reminder settings. Default: opt-in.
3. **Which events qualify.** Recommended: public GPP and approved/listed series events only (curated by
   underbosses). "Any public rsv.pizza event" can come later. Default: curated only.
4. **Default radius.** Recommended: 50 km. When the event only has city-level coordinates, add 25 km. Members
   can pick 10 / 25 / 50 / 100 / 250 km. Default: 50 km.
5. **Channels.** Recommended: the member's existing reminder channel choice (Discord / Telegram / both). Email
   only for members with a verified, opted-in address, plus the in-app notification. Default: reminder channel
   + in-app; email off until a setting turns it on.

## Goal

When a curated public event is published within the member's radius, the member gets one short invite (name,
date in the event's timezone, distance, RSVP link) on the channel they chose. There are caps, quiet hours and
one-tap opt-out.

## What exists (reused)

- **Member city:** the free-text `city` column in `Member.cells` (`MEMBER_COLUMNS.city`, `cellText`).
- **City to coordinates:** `app/lib/map-levels/places.ts` `resolvePlace()` maps raw city text to one of
  about 420 chapter cities in `map-cities.json` (with coords), honouring the admin aliases
  `map.placeAliases`. Ambiguous or unknown text stays unplaced. That's correct for invites: no coordinates
  means no invite. No geocoding API calls and no new location table.
- **Sending:** `app/lib/reminders/deliver.ts` (`deliverDm`, `deliverTelegram` via the rsv.pizza proxy, outcome
  classification), and `ReminderPref.channel` (AUTO/DISCORD/TELEGRAM/BOTH).
  `ReminderSend` with `@@unique([discordId, kind, refKey])` is the claim, giving idempotent retries.
  - Quiet hours: `app/lib/followups/quiet-hours.ts`.
  - In-app: `createNotification` (`app/lib/notifications.ts`).
  - Email: verified address in `MemberProfileExtras` and the Resend path used by re-engage.
- **rsv.pizza service auth:** `x-service-key` / `PIZZADAO_SERVICE_KEY` routes in
  `backend/src/routes/service.routes.ts`. The app side already uses `RSV_PIZZA_SERVICE_KEY` (see
  `events-attended/guest-attendance.ts`).
- **Gap:** rsv.pizza has no upcoming-events feed. `GET /api/gpp/events` is GPP-only, has no time filter and has
  no cursor.

## Design

### 1. rsv.pizza (separate PR in rsv-pizza): `POST /api/service/upcoming-events`

- Behind `requireServiceKey`, plus a feature flag (503 `disabled` when off, like guest-attendance).
- Body: `{ since?: ISO updatedAt cursor, limit<=500 }`.
- Returns only parties that are:
  - `eventType` gpp, or in a series with `underbossStatus in (approved, listed)`
  - not private, no password, `cancelledAt` null
  - `date > now()`
- Also returns cancellations since the cursor (`cancelled: true`), so we can stop pending sends.
- Fields: `id, url (rsv.pizza/{customUrl||inviteCode}), name, date, endTime, timezone, city, country,
  latitude, longitude, addressIsCityDefault, full (maxGuests reached), rsvpClosed, updatedAt`.
- Never returns host or guest data, or the street address.

### 2. pizzadao-org

- `app/lib/nearby-events/client.ts`: a typed client (zod), modelled on `guest-attendance.ts`. Any failure means
  "no data this run".
- `app/lib/nearby-events/match.ts` (pure):
  - Resolve each opted-in member's city once per run (build the place index once). Use `haversineKm` (add a
    tiny helper) against the event coordinates.
  - Include a member when the distance is within their radius (plus the city-level slack).
  - Exclude when:
    - the event is full or RSVP is closed
    - the event starts in under `minLeadHours` or over `maxLeadDays`
    - the member is already sent for this event
    - the member is over the cap
- `app/lib/nearby-events/run.ts`: a cron step every 15 minutes, added as a phase of `/api/cron/reminders`
  (`checkSecret`):
  1. Fetch events changed since the cursor (stored in a tiny `NearbyEventCursor`
     table).
  2. Match.
  3. Claim a `ReminderSend { kind: NEARBY_EVENT, refKey: rsvEventId }`.
  4. Send with the same outcome handling as call reminders.
  - Quiet hours use `MemberProfileExtras.timezone`, falling back to a daytime-UTC window as follow-ups do (`followups/send.ts`). They defer to the next run.
  - Production only; previews log "would send".
- Cancellation: if a claimed but unsent row's event is cancelled, mark it SKIPPED. Sent invites get no follow-up
  in v1.

### Message

"Pizza party near you: <name>, <date local>, about <n> km from <city>. RSVP: <url>". Buttons: RSVP (URL), "Not
interested in nearby events" (Discord button / Telegram link to the settings page, like call reminders). Use
`?ref=pizzadao` on the URL for attribution. There's no signed member token in v1.

## Data / migrations (additive)

- `enum ReminderKind` add `NEARBY_EVENT`.
- `ReminderPref` add `nearbyEvents Boolean @default(false)`, `nearbyRadiusKm Int?` (null = setting default),
  `nearbyEmail Boolean @default(false)`.
- `NearbyEventCursor { id String @id, since DateTime, updatedAt }`. There's no generic KV table.
- No member location table: coordinates come from `resolvePlace` at run time.

## UI

- Profile edit, reminder settings card (`/api/reminder-prefs`): toggle "Tell me about pizza parties near
  <resolved city>", plus a radius select. If the city can't be placed, show "We can't place your city; update it
  on your profile".
- A dashboard one-time prompt (dismissible, stored client-side) when the feature is on and the member hasn't
  opted in.
- Admin `/admin/settings` shows the switches. No reminders admin page exists, so add a small "Nearby events" panel on
  `/admin/settings` (reminders area): last run, events seen, sends and skips by reason.

## Security / privacy / abuse

- Member locations never leave our side. rsv.pizza learns nothing about members. Coordinates are city
  centroids only.
- Frequency caps:
  - `maxPerWeek` per member (default 3)
  - at most one per member per day
  - extras are dropped, not queued (GPP week would otherwise flood people)
  - global `maxSendsPerRun` (default 200) with Discord 429 back-off (existing `rate_limited` stop)
- Opt-out: the button or link turns `nearbyEvents` off immediately. Discord DMs-closed and Telegram blocked
  outcomes already back off per channel.
- Event safety: only curated events (open question 3). Never invite the host (match the host by member email
  hash if cheap; otherwise accept the rare self-invite).

## Settings (new `app/lib/settings/nearby-events-settings.ts`, area `reminders`)

- `reminders.nearbyEventsEnabled` (bool, off; env kill switch `REMINDERS_NEARBY_EVENTS_ENABLED`)
- `reminders.nearbyDefaultRadiusKm` (5-500, default 50)
- `reminders.nearbyCityLevelSlackKm` (0-100, default 25)
- `reminders.nearbyMaxPerWeek` (1-10, default 3)
- `reminders.nearbyMinLeadHours` (default 24)
- `reminders.nearbyMaxLeadDays` (default 45)
- `reminders.nearbyMaxSendsPerRun` (default 200)
- `reminders.nearbyEmailEnabled` (bool, off)
- `reminders.nearbyEventKinds` (stringList, default `gpp`, `series`)
- rsv.pizza side: an env flag `UPCOMING_EVENTS_ENABLED` (its own convention).

## Tests

- `match.test.ts`:
  - radius edges and city-level slack
  - unplaced, ambiguous and alias-resolved cities
  - lead-time window, full/closed events
  - weekly and daily caps, the already-sent exclusion
- `run.test.ts`:
  - cursor advance only after a successful fetch
  - claim idempotency on rerun
  - quiet-hours deferral
  - cancelled event marked SKIPPED
  - preview never sends
  - switch off logs only
- `client.test.ts`: schema rejects extra PII fields, failure returns null.
- Prefs route: new fields round-trip; radius validated.
- rsv-pizza: route test for the visibility predicate (private, password, cancelled and unapproved series
  excluded) and service-key auth.

## Rough size

Medium-large: about 3 days. pizzadao-org is about 2 days (client, matcher, cron phase, prefs, UI, migration).
rsv-pizza is about 1 day (one service route + test). Ship rsv-pizza first, behind its flag.

## Decisions (Snax, 2026-11-21)

Snax approved the recommended defaults above, with one change:

- **Invites are OPT-OUT.** Members get nearby-event invites unless they turn them off (`nearbyEvents`
  defaults to true). One-tap opt-out stays on every message. This replaces the opt-in default in question 2;
  the dashboard opt-in prompt is dropped (no prompt needed).
- Notification with RSVP link, not auto-RSVP.
- Curated events only: GPP and approved/listed series.
- Radius 50 km, plus 25 km slack for city-level event coordinates.
- Channel: the member's reminder channel plus in-app; email off at first.
- Caps: 3 per week, 1 per day.
- The global feature switch (`reminders.nearbyEventsEnabled`) still starts OFF. Opt-out is the per-member
  default once Snax switches it on.
