# arugula-28029 — Article Comments + Reactions

**Status:** Implementation in progress.
**Date:** 2026-05-21
**Author:** Snax (planning agent: Claude)
**Depends on:** Articles feature (PR #28), Notifications (truffle-41395)

---

## 1. Goal

Let logged-in PizzaDAO members discuss articles in-thread. The articles page
already supports authoring, publishing, drafts, and OG-tagged sharing — but
readers have no way to react, debate, or thank the author from inside the app.

v1 ships **comments only** (flat list, markdown-rendered, author/admin edit &
delete). **Reactions (👍 ❤️ 🍕)** are scoped as a stretch goal — only built if
comments MVP lands cleanly with time to spare.

Out of scope for this PR:

- Threaded replies (we reserve a future `replyToId` column but don't ship UI).
- Comment moderation queue, reporting/flagging flow.
- Email/Discord DM notifications for comments (in-app Notification record only).
- Reaction *to a comment* (only article-level reactions are stretch).

---

## 2. Schema

### `ArticleComment`

```prisma
model ArticleComment {
  id         Int       @id @default(autoincrement())
  articleId  Int
  authorId   String    // Discord ID of commenter
  authorName String?   // Cached display name (matches Article.authorName)
  body       String    // Markdown, capped at 500 chars (validated server-side)
  replyToId  Int?      // Reserved for future threading; not used in v1 UI
  createdAt  DateTime  @default(now())
  updatedAt  DateTime  @updatedAt
  deletedAt  DateTime? // Soft-delete; UI shows "[deleted]" placeholder
  article    Article   @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@index([articleId, createdAt])
  @@index([authorId])
}
```

`Article` gets a back-relation: `comments ArticleComment[]`.

### Why soft-delete?

Author-delete is a destructive UX but we keep the row so that:

- The comment-count badge stays consistent across paginations.
- An admin can audit deletion patterns.
- A future reply chain remains addressable.

The body is **cleared** (`body = ''`) on soft-delete to avoid leaking content; we
only keep the row + timestamps.

### `ArticleReaction` (stretch only)

```prisma
model ArticleReaction {
  id        Int      @id @default(autoincrement())
  articleId Int
  authorId  String
  emoji     String   // One of: "thumbs", "heart", "pizza"
  createdAt DateTime @default(now())
  article   Article  @relation(fields: [articleId], references: [id], onDelete: Cascade)

  @@unique([articleId, authorId]) // One reaction per member per article
  @@index([articleId])
}
```

One reaction per member per article: posting a new emoji **replaces** the old.
Counted at render time; cached header `s-maxage=60`.

---

## 3. API surface

All routes use `withErrorHandling` + `ApiError` subclasses from
`app/lib/errors/`. Body validation throws `ValidationError` for shape, length,
and rate-limit violations.

### `GET /api/articles/[slug]/comments`

- Public for `PUBLISHED` articles; drafts return 404 unless the requester is
  author / collaborator / admin (mirrors `GET /api/articles/[slug]`).
- Returns `{ comments: ArticleCommentDTO[] }` newest-first, capped at 200.
- DTO includes `authorMemberId` (resolved via `fetchMemberIdByDiscordId`) so the
  UI can build `/profile/{memberId}` links without a second round-trip.
- Soft-deleted comments included with `body: ''` and `deletedAt` set; client
  renders "[deleted]" placeholder.
- `Cache-Control: private, no-cache` — comments are time-sensitive and
  user-permissioned.

### `POST /api/articles/[slug]/comments`

- Requires session (`UnauthorizedError` otherwise).
- Body: `{ body: string }`.
- Validation:
  - `body` is a non-empty string, trimmed.
  - `body.length <= 500` (`ValidationError("Comment must be 500 characters or fewer")`).
- **Rate limit**: 1 comment per 30s per (`authorId`, `articleId`). Implemented
  with a single Prisma query — `findFirst` ordered by `createdAt desc` and
  reject if `now - last.createdAt < 30_000ms`. Cheap; no need for Redis in v1.
- On success:
  - Inserts the row with `authorName` from the session (`session.nick || session.username`).
  - Calls `createNotification` to notify the article's `authorId` (skipped if the
    commenter *is* the author). Uses new enum value `ARTICLE_COMMENT`.
  - Returns the created comment DTO.

### `PATCH /api/articles/comments/[id]`

- Requires session.
- Loads the comment. 404 if missing or `deletedAt` set.
- 403 unless `session.discordId === comment.authorId`. Admins do NOT get edit
  permission — only the author may rewrite their own words. Admins delete only.
- Body: `{ body: string }`. Same length cap. Updates `body` + `updatedAt`.

### `DELETE /api/articles/comments/[id]`

- Requires session.
- Allowed if `session.discordId === comment.authorId` **or** the user has any
  role in `ADMIN_ROLE_IDS`.
- Soft-delete: sets `deletedAt = now()` and clears `body`.

### Reactions (stretch only)

- `GET /api/articles/[slug]/reactions` → counts + the requester's own emoji.
- `POST /api/articles/[slug]/reactions` body `{ emoji: "thumbs"|"heart"|"pizza" }`.
  Uses `upsert` on the `(articleId, authorId)` unique constraint.
- `DELETE /api/articles/[slug]/reactions` — removes the requester's reaction.

---

## 4. Service layer — `app/lib/article-comments.ts`

A thin module that owns validation + Prisma access; the route files are kept
small and delegate. Mirrors the pattern in `app/lib/articles.ts`.

Exports:

- `listComments(articleId): Promise<CommentWithAuthor[]>`
- `createComment({ articleId, authorId, authorName, body })`
- `updateComment(id, authorId, body)`
- `deleteComment(id, actorDiscordId, isAdmin)`
- `validateCommentBody(body): string` — trims + length check, throws `ValidationError`
- `checkCommentRateLimit(articleId, authorId, cooldownMs = 30_000)` — throws
  `ValidationError("You're commenting too fast — wait a few seconds and try again.")`
  with a `field: 'cooldown'` hint.

---

## 5. UI

### `app/ui/articles/CommentList.tsx`

- Client component.
- Props: `slug: string`, `articleAuthorId: string`, `currentUserDiscordId: string | null`, `isAdmin: boolean`.
- Fetches `/api/articles/{slug}/comments` in a `useEffect`.
- States: loading skeleton (3 grey blocks), empty ("Be the first to comment"),
  error (red inline message with retry button).
- Renders each comment with:
  - Author name → link to `/profile/{authorMemberId}` (falls back to plain text
    if memberId unresolved).
  - Relative timestamp ("3 days ago"), absolute on hover via `title`.
  - `<ArticleRenderer content={body} />` so markdown works.
  - Edit/Delete buttons visible when `currentUserDiscordId === comment.authorId`.
  - Delete-only button when `isAdmin` and not the author.
  - "[deleted]" placeholder for soft-deleted rows.
- Edit mode: inline textarea + Save/Cancel. Optimistically updates the local list.

### `app/ui/articles/CommentComposer.tsx`

- Client component.
- Props: `slug: string`, `disabled?: boolean`, `onPosted: (comment) => void`.
- Renders an "Add a comment" textarea (4 rows, autoresize), char counter
  `{n}/500` turning tomato red over 480, Submit button.
- Posts `POST /api/articles/{slug}/comments`. Disables submit while in-flight.
- Surfaces rate-limit / validation errors inline.
- Markdown hint subtext: "Markdown supported. Be kind."

If `currentUserDiscordId` is null, the composer is replaced by a sign-in CTA
linking to `/api/auth/discord`.

### Wiring into `ArticleDetailClient.tsx`

- After `<ArticleRenderer />` (and the tag row), add a `<section>` with heading
  "Comments" and the two components below.
- The client component already fetches the article + caller info; reuse the
  existing `/api/me` fetch to obtain `discordId` + admin flag (admin needs a
  small new field — extend `/api/me` to include `isAdmin: boolean`). If `/api/me`
  doesn't already expose admin status, do a single `await hasAnyRole` server
  call in a new `/api/me/permissions` endpoint to avoid leaking role IDs.

Investigate before coding: if `/api/me` already returns `isAdmin`, just consume
it; if not, add a minimal `/api/me/admin` GET returning `{ isAdmin: boolean }`.

### Reactions UI (stretch)

A horizontal row above the comments section: three emoji buttons + count.
Active emoji has tomato background. Click toggles via the POST/DELETE endpoint.
Optimistic update.

---

## 6. Notifications

- Add `ARTICLE_COMMENT` to the `NotificationType` enum (Prisma + migration).
- After a successful POST, call `createNotification` with:
  - `type: NotificationType.ARTICLE_COMMENT`
  - `recipientId: article.authorId`
  - `actorId: commenter.discordId`
  - `title: "New comment on your article"`
  - `message: '"' + truncate(article.title, 50) + '" — ' + truncate(body, 80)`
  - `linkUrl: '/articles/' + article.slug`
  - `metadata: { articleId, commentId }`
- Skip if `recipientId === actorId`.
- v1 does NOT notify previous commenters (only the article author) — keeps the
  noise low. A future enhancement can add a "follow this thread" toggle.

---

## 7. Validation, abuse, edge cases

| Case | Behavior |
|---|---|
| Body empty/whitespace | 400 `ValidationError("Comment cannot be empty")` |
| Body > 500 chars | 400 `ValidationError("Comment must be 500 characters or fewer")` |
| Not logged in | 401 `UnauthorizedError` |
| Comment within 30s of last | 400 `ValidationError("You're commenting too fast …")` |
| Article archived/draft and viewer not allowed | 404 |
| Edit by non-author | 403 |
| Delete by non-author non-admin | 403 |
| Author re-edits a deleted comment | 404 (soft-deleted rows are read-only) |
| Article deleted (archived) | Comments remain visible; composer disabled |

Client side mirrors the 500-char cap with the live counter and disables Submit
when invalid. Server is the source of truth.

---

## 8. Phasing

1. **Plan PR-ready** (this doc). ✅
2. **Schema + migration** — additive only; new table + new enum value.
3. **API routes** (`/api/articles/[slug]/comments` GET+POST, `/api/articles/comments/[id]` PATCH+DELETE).
4. **Service module** `app/lib/article-comments.ts`.
5. **UI components** `CommentList`, `CommentComposer`.
6. **Wire into `ArticleDetailClient`**.
7. **Notifications hookup** (`createNotification` from the POST route).
8. **Build + lint + commit + push + draft PR + Vercel green check**.
9. **Reactions (stretch)** — only if the above is green with margin.

If we hit any of these, defer reactions:

- Build failure that needs > 15 min to chase.
- Migration shadow-DB issue we have to manual-SQL around.
- Any unexpected refactor of `ArticleDetailClient` (it's already large).

---

## 9. Files touched

New files:

- `prisma/migrations/20260521000000_add_article_comments/migration.sql`
- `app/lib/article-comments.ts`
- `app/api/articles/[slug]/comments/route.ts`
- `app/api/articles/comments/[id]/route.ts`
- `app/ui/articles/CommentList.tsx`
- `app/ui/articles/CommentComposer.tsx`

Modified:

- `prisma/schema.prisma` — `ArticleComment` model, `comments` relation on
  `Article`, `ARTICLE_COMMENT` on `NotificationType` enum.
- `app/articles/[slug]/ArticleDetailClient.tsx` — render `<CommentList />` and
  `<CommentComposer />` below the article body.
- `app/ui/articles/index.ts` — export the two new components.

Possibly modified (depends on `/api/me` shape):

- `app/api/me/route.ts` *or* a small new `app/api/me/admin/route.ts`.

---

## 10. Manual test plan

- [ ] Logged-out viewer can read comments on a published article; composer
      shows the sign-in CTA.
- [ ] Logged-in non-author posts a comment → appears at top of list, article
      author gets a Notification row.
- [ ] Author of the article posts a comment → list updated, no self-notification.
- [ ] Posting two comments within 30s → second is rejected with the cooldown
      message.
- [ ] Editing own comment updates inline; non-author sees no edit button.
- [ ] Author deletes own comment → renders "[deleted]" placeholder; the row
      still occupies space (no comment-count drift).
- [ ] Admin deletes someone else's comment → same placeholder.
- [ ] Markdown in the body renders (bold, link, image, code).
- [ ] Char counter goes red past 480; submit disabled at 501.
- [ ] Draft article: comments hidden to randos (404 on the API), visible to
      author + collaborators.

---

## 11. Deferred / future work

- Threaded replies (use the reserved `replyToId` column).
- Notify previous commenters on the same article (subscribe model).
- Markdown image-paste reuse from the article editor (we keep the comment
  composer text-only for v1 to avoid Blob abuse).
- Comment-level reactions (current stretch is article-level only).
- Mod tools — soft-delete reason, audit log, IP/abuse signals.
