# stuffed-crust-39669 — Activity feed completeness

## Goal

The Phase 3 dashboard PR (`pineapple-40964` / PR #76, merged into `origin/main`
at commit `6cbd7a9`) ships the `RecentActivity` feed on `/dashboard/[id]`. It
wires up these `ActivityKind` sources in `/api/activity/[memberId]`:

- `vouch_received` (Prisma `Vouch`)
- `mission_approved`, `mission_rejected` (Prisma `MissionCompletion`)
- `ticket_added` (Prisma `UnlockTicketClaim`)
- `notification` (Prisma `Notification`)

It explicitly skips three kinds for lack of a reliable timestamp source:

- `task_claimed` — claims write to a Google Sheet cell with no per-claim
  timestamp.
- `poap_received` — POAPs are fetched live from POAP Compass; we never
  persist a "first seen by us" timestamp per member.
- `role_granted` — role state is read live from Discord; transitions are
  not tracked.

The frontend already knows these kinds (`activity-types.ts` enumerates them
and `RecentActivity.tsx` has lucide icons for each). This task wires up the
three missing sources by **persisting events at the point we observe them**,
so the same feed can surface them.

## Design principles

1. **Additive Prisma migration only.** One new migration; three new tables;
   no changes to existing columns/enums. Matches the project memory rule on
   additive migrations.
2. **No backfill of historical timestamps.** We can't fabricate a "received
   at" without a real source. Tables start empty. The first observation of
   a row counts as the event timestamp. Going forward, the feed grows.
3. **Write at observation time, not on a schedule.** Each new kind hooks
   the existing user-facing code path. No background sweeps; no cron.
4. **Owner-only.** The feed endpoint is already owner-gated; the new
   sources inherit that without any extra auth code.
5. **Idempotent writes.** Each table has a uniqueness constraint that makes
   double-firing a no-op. Important because the claim/sync endpoints can be
   replayed by the user (e.g. unclaim → claim again).

## New Prisma models

### `TaskClaimEvent`

```prisma
model TaskClaimEvent {
  id        Int      @id @default(autoincrement())
  memberId  String   // member ID from the sheet (matches /profile/[id])
  taskKey   String   // hash-ish key: sheetId + taskName
  taskName  String   // human-readable task name (denormalized for display)
  sheetUrl  String?  // optional, for deep-link
  claimedAt DateTime @default(now())

  @@index([memberId, claimedAt])
  @@unique([memberId, taskKey]) // re-claim is idempotent for the feed
}
```

Notes:
- We key on `(memberId, taskKey)` and treat re-claims as no-ops in the
  feed. Unclaim → claim again does not produce a duplicate event row.
- `taskKey` is `${sheetId}::${taskName}` to disambiguate identically-named
  tasks across crew sheets.
- `taskName` and `sheetUrl` are denormalized so the feed never has to call
  back to Sheets to render an event row.

### `PoapFirstSeen`

```prisma
model PoapFirstSeen {
  id            Int      @id @default(autoincrement())
  memberId      String
  poapEventId   String   // POAP event/drop ID (not token ID)
  poapTokenId   String   // first token id seen (display only)
  title         String?
  imageUrl      String?
  firstSeenAt   DateTime @default(now())

  @@unique([memberId, poapEventId])
  @@index([memberId, firstSeenAt])
}
```

Notes:
- The current `/api/poaps/[memberId]` route returns whitelisted POAPs.
  After this PR, each successful fetch will upsert any POAPs we haven't
  seen for that member into this table. `@@unique` makes it a no-op for
  already-known events.
- We dedupe by `poapEventId`, not token id, because the user can hold
  multiple tokens of the same event (e.g. multiple wallets).
- **No backfill.** All existing POAPs for a given member appear with
  `firstSeenAt = now()` on the next fetch after deploy. We accept the
  one-time burst (a member with N existing POAPs will see N events
  bunched at the same timestamp). For most users, N is small, and the
  burst clears once they're caught up.

### `RoleGrantEvent`

```prisma
model RoleGrantEvent {
  id         Int      @id @default(autoincrement())
  memberId   String?  // member ID if resolvable; nullable for safety
  discordId  String   // always known (we observe on Discord sync)
  roleId     String   // Discord role id
  roleName   String   // resolved at write time so feed never needs a guild API call
  grantedAt  DateTime @default(now())

  @@unique([discordId, roleId])
  @@index([discordId, grantedAt])
  @@index([memberId, grantedAt])
}
```

Notes:
- We hook the `/api/discord/sync-to-sheet` endpoint, which is the existing
  canonical point where we materialize a user's current Discord roles
  into our app. We snapshot the previously-known roles per Discord user
  (stored in the existing `User.roles` field) and write a row for each
  role id that's newly present.
- Wedon't have a Discord audit log. The earliest observable timestamp is
  the first sync after this PR ships. That's fine.

## Aggregation in `/api/activity/[memberId]`

Add three new sources to the existing aggregator. Each one mirrors the
shape of the wired sources: per-source `take: PER_SOURCE_LIMIT` (10), wrap
in `safe()`, push `ActivityEvent`s into the `events` array, then the
existing sort+cap handles ordering.

Sketch:

```ts
// --- Task claims ---
const claims = await safe(
  prisma.taskClaimEvent.findMany({
    where: { memberId },
    orderBy: { claimedAt: "desc" },
    take: PER_SOURCE_LIMIT,
  }),
  [],
);
for (const c of claims) {
  events.push({
    id: makeId("task_claimed", c.id),
    kind: "task_claimed",
    title: `Claimed task: ${c.taskName}`,
    href: c.sheetUrl ?? null,
    at: toISO(c.claimedAt),
  });
}

// --- POAPs ---
const poaps = await safe(
  prisma.poapFirstSeen.findMany({
    where: { memberId },
    orderBy: { firstSeenAt: "desc" },
    take: PER_SOURCE_LIMIT,
  }),
  [],
);
for (const p of poaps) {
  events.push({
    id: makeId("poap_received", p.id),
    kind: "poap_received",
    title: p.title ? `POAP: ${p.title}` : "POAP received",
    href: `/profile/${memberId}`,
    at: toISO(p.firstSeenAt),
  });
}

// --- Role grants ---
const grants = await safe(
  prisma.roleGrantEvent.findMany({
    where: { discordId }, // discordId is what we always have on the session
    orderBy: { grantedAt: "desc" },
    take: PER_SOURCE_LIMIT,
  }),
  [],
);
for (const g of grants) {
  events.push({
    id: makeId("role_granted", g.id),
    kind: "role_granted",
    title: `Discord role granted: ${g.roleName}`,
    href: null,
    at: toISO(g.grantedAt),
  });
}
```

Also update the source-comment block at the top of `route.ts` to move
these from "deferred" to "wired".

## Write-side hooks

### Task claims — `POST /api/claim-task`

After the existing `sheets.spreadsheets.values.update` succeeds and the
action is `claim` (not `giveup`), upsert into `TaskClaimEvent`. Wrap in
try/catch so a DB hiccup doesn't break the claim flow.

```ts
if (action === 'claim' && memberId) {
  const taskKey = `${sheetId}::${taskName.trim()}`;
  await prisma.taskClaimEvent.upsert({
    where: { memberId_taskKey: { memberId, taskKey } },
    update: {}, // re-claim is a no-op
    create: { memberId, taskKey, taskName, sheetUrl },
  }).catch((err) => {
    console.error('[claim-task] failed to log TaskClaimEvent (non-blocking):', err);
  });
}
```

On `giveup`, we leave the row in place. Rationale: the historical event
("you claimed X on date Y") is still a true thing that happened.

### POAPs — `GET /api/poaps/[memberId]`

After the merged+deduped `allPoaps` array is computed (before the
limit-trimming branch), upsert each unique POAP. Run async and don't
await — the GET response shouldn't slow down for the DB write. But also
guard with try/catch so it never throws.

```ts
const poapUpserts = allPoaps.map((p) =>
  prisma.poapFirstSeen.upsert({
    where: { memberId_poapEventId: { memberId, poapEventId: p.eventId } },
    update: {}, // first observation wins
    create: {
      memberId,
      poapEventId: p.eventId,
      poapTokenId: p.tokenId,
      title: p.title,
      imageUrl: p.imageUrl,
    },
  })
);
Promise.allSettled(poapUpserts).catch(() => {}); // fire-and-forget
```

The unique constraint guarantees once-only timestamp capture.

### Role grants — `POST /api/discord/sync-to-sheet`

After we compute `discordRoleIds` (line 48 in current file), diff against
the existing snapshot in `User.roles`:

```ts
const existing = await prisma.user.findUnique({
  where: { id: discordId },
  select: { roles: true },
}).catch(() => null);
const previousRoles = new Set(existing?.roles ?? []);
const newRoleIds = discordRoleIds.filter((r) => !previousRoles.has(r));

if (newRoleIds.length > 0) {
  await Promise.allSettled(newRoleIds.map((roleId) => {
    const roleName = guildRolesMap.get(roleId) ?? roleId;
    return prisma.roleGrantEvent.upsert({
      where: { discordId_roleId: { discordId, roleId } },
      update: {},
      create: { discordId, memberId: finalMemberId, roleId, roleName },
    });
  }));
}

// Keep the snapshot in sync for the next diff.
await prisma.user.upsert({
  where: { id: discordId },
  update: { roles: discordRoleIds },
  create: { id: discordId, roles: discordRoleIds },
}).catch(() => {});
```

Subtle: the very first time a user syncs after this PR ships, every
current role is "new" relative to the empty snapshot. That's the same
one-time-burst behavior as POAPs. Acceptable.

`guildRolesMap` is already built in the same function so we have role
names for free — no extra Discord API calls.

## Migration

One new migration: `prisma/migrations/20260521000000_add_activity_events/migration.sql`,
containing three `CREATE TABLE` statements and their indexes/uniques. No
ALTER on existing tables.

Apply against Neon via the project memory's documented flow:
1. Copy `.env.migration` → `.env` in the worktree.
2. `DOTENV_CONFIG_PATH=.env npx prisma migrate deploy`.

## Tests

Extend `app/api/activity/[memberId]/route.test.ts` (which already mocks
the prisma client) with:

1. New `vi.mock('@/app/lib/db')` entries for `taskClaimEvent`,
   `poapFirstSeen`, and `roleGrantEvent`'s `findMany`.
2. The "aggregates events" test gets fixtures for each new kind so the
   `kinds.includes(...)` assertions cover all 8 kinds.
3. New assertion: total event count includes the 3 new sources.

We don't need integration tests for the write-side hooks — the unique
constraint is the contract, and adding heavyweight Discord/POAP mocks
would balloon the PR. The plan + code review is the verification.

## Files touched

- `prisma/schema.prisma` — add three models
- `prisma/migrations/20260521000000_add_activity_events/migration.sql` — new
- `app/api/activity/[memberId]/route.ts` — wire 3 new sources, update top comment
- `app/api/activity/[memberId]/route.test.ts` — extend test fixtures
- `app/api/claim-task/route.ts` — add prisma import + write hook
- `app/api/poaps/[memberId]/route.ts` — add prisma import + write hook
- `app/api/discord/sync-to-sheet/route.ts` — add prisma import + write hook + snapshot update
- `plans/stuffed-crust-39669-activity-completeness.md` — this file (will move to plans/done after merge)

## Out of scope

- Backfilling historical timestamps (we explicitly accept "ledger starts
  now" — see project memory's parallel decision for `CallAttendance`).
- A scheduled POAP/role sweep (the on-demand write hooks suffice).
- Surfacing these in any UI other than `RecentActivity` — frontend already
  knows the kinds and has icons.
- Backfilling `User.roles` for users who haven't logged in since this PR.
