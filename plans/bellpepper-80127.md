# bellpepper-80127: Meme folder on the member dashboard

Status: plan v1 (2026-11-21).

## Open questions for Snax

1. **Moderation model.** Options:
   - (a) Pre-approval. Every upload is hidden until a capo approves it. This is recommended, because the
     folder is a public-facing brand asset library and the repo/site is public.
   - (b) Post-moderation. Uploads show at once, and reports auto-hide them.
   - Default: (a), with a setting to switch to (b) later. Reports and hiding work in both modes.
2. **Who approves.** Recommended: Pizza Capo role holders plus DPR, using the same `holdsAny(CALL_CAPO_ROLE_IDS)`
   check as image review. Default: capos + DPR.
3. **Who can see the folder.** Recommended: signed-in members only at first. A public `/memes` page can come
   later. Default: members only.
4. **Who can upload.** Recommended: members at or above a completed level (setting, default 1), to keep
   throwaway accounts out. Default: level 1.
5. **$PEP for approved memes?** Recommended: not in v1. Default: none.

## Goal

Members upload PizzaDAO and Benny memes, browse an approved gallery from their dashboard, and download
originals. Capos keep it clean.

## Where it lives

- Page: `app/memes/page.tsx` (client grid, session-gated) with tabs **All / Benny / PizzaDAO / Mine**, plus a
  capo queue at `app/memes/review/page.tsx`.
- Dashboard: a small "Meme folder" card in `app/dashboard/[id]/components/MemeFolderCard.tsx`. It shows 4 recent
  thumbnails, an Upload button and "Open folder". It renders nothing while `memes.enabled` is off.
- APIs:
  - `app/api/memes/route.ts` (GET list, cursor-paged, approved only; or own + pending for the uploader)
  - `app/api/memes/upload/route.ts` (POST multipart)
  - `app/api/memes/[id]/route.ts` (DELETE own; PATCH tags/caption by the owner while pending)
  - `app/api/memes/[id]/report/route.ts`
  - `app/api/memes/[id]/file/route.ts` (streams private pending files to the owner or a capo)
  - `app/api/memes/review/route.ts` (capo approve/reject/hide)
- Lib: `app/lib/memes/` (store, access, validation).

## Storage (reuse existing infra)

- **Pending files are private.** Upload with `uploadPrivate()` (`app/lib/private-blob-upload.ts`, magic-byte
  sniffing, no SVG) under `memes/pending/<discordId>/`. Reviewers see them through the authenticated `file`
  route (`readPrivate`), so nothing unreviewed is ever on a public URL.
- **On approval**, copy to public Blob under `memes/<id>.<ext>` and delete the private object. Use `put` from the
  streamed bytes (or `copy` if the store supports private-to-public). Store the public URL. Public URLs are
  checked with `isOwnBlobUrl(url, "/memes/")`.
- On reject or hide-after-approval, `del()` the public blob and keep the row with status. The file is gone
  but the audit trail stays.
- Types: PNG, JPEG, WebP, GIF (animated GIFs are fine). No video in v1. Size cap: setting, default 5 MB (the private
  helper's hard cap is 8 MB). Also reject images larger than 4096 px on a side. Read dimensions from the header
  bytes: add a small `imageDimensions()` beside `image-sniff.ts`.
- Dedupe: `uploadPrivate` already returns `sha256`. Reject an exact duplicate of an existing non-rejected meme
  ("Already in the folder").
- Downloads: the public URL with `?download=1` (Blob supports a content-disposition download). The grid's
  Download button uses `<a download>`.

## Data / migration (additive)

```prisma
model Meme {
  id           String    @id @default(cuid())
  uploaderId   String    // Discord id
  memberId     String?
  category     String    @db.VarChar(16)   // "benny" | "pizzadao"
  caption      String?   @db.VarChar(200)
  tags         String[]  @default([])
  status       String    @default("PENDING") @db.VarChar(16) // PENDING | APPROVED | REJECTED | HIDDEN | DELETED
  privatePath  String?   // while pending
  publicUrl    String?   // once approved
  mime         String    @db.VarChar(32)
  sizeBytes    Int
  width        Int?
  height       Int?
  sha256       String    @db.VarChar(64)
  reviewedBy   String?
  reviewedAt   DateTime?
  reviewNote   String?   @db.VarChar(300) // shown to the uploader on reject
  reportCount  Int       @default(0)
  downloadCount Int      @default(0)
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  @@index([status, createdAt])
  @@index([uploaderId, createdAt])
  @@index([sha256])
}
model MemeReport {
  memeId     String
  reporterId String
  reason     String   @db.VarChar(300)
  createdAt  DateTime @default(now())
  @@id([memeId, reporterId])   // one report per member per meme
}
```

## UI

- Grid: masonry thumbnails using `next/image` with the blob host (already in `image-hosts.ts`). Each tile shows
  the caption, uploader name (public name only), Download, and Report (behind the overflow menu).
- Upload dialog:
  - fields: file, category (Benny / PizzaDAO), optional caption and up to 5 tags
  - a "this is PizzaDAO-related, I made it or may share it" checkbox
  - shows "Waiting for a capo" afterwards
- Mine tab: status chips (Waiting / Live / Not accepted + note), Delete.
- Review queue:
  - capo only; lists pending items oldest first, then reported items
  - Approve / Reject (optional note) / Hide
  - keyboard shortcuts optional
  - a count badge goes on the capo's dashboard card
- Optional: a Discord ping to a review channel when the queue is non-empty. Setting `memes.reviewChannelId`,
  empty = no post, at most one post per hour.

## Security / abuse

- Session required for everything. Upload also requires `memes.enabled`, the level gate, and the per-member caps
  below. `rejectUnsafeWrite` (same-origin) on every write.
- Per-member limits, enforced in the DB, not memory:
  - at most `memes.maxUploadsPerDay` (default 10)
  - at most `memes.maxPending` (default 20) waiting at once
- Plus the IP limiter `memes-upload` in `RATE_LIMITS` (10 / 10 min, like `spotlight-upload`).
- Reports: one per member per meme. Reports are limited to 20 per member per day.
  - At `memes.autoHideReports` (default 3) distinct reporters, an approved meme flips to HIDDEN pending capo
    review.
  - Capos can restore it.
- Strip metadata: `sharp` is not a dependency today, so v1 does not re-encode. Instead, on approval, drop the
  JPEG APP1 (EXIF/GPS) segment with a small byte-level strip (JPEG only; PNG/WebP/GIF metadata is rare and
  low-risk). Warn uploaders in the copy. Adding sharp is a follow-up.
- No SVG, no HTML. Content-Type comes from the sniffed type, never from the client.
- Uploader identity is shown by public name only, never the Discord id.
- A member who is disavowed or has left the guild: their uploads stay but they can't upload. Reuse the
  disavow check.

## Settings (new file `app/lib/settings/memes-settings.ts`; add `'memes'` to `SettingArea` and one spread line in the registry)

- `memes.enabled` (bool, off; env kill switch `MEMES_ENABLED`)
- `memes.requireApproval` (bool, default on)
- `memes.minCompletedLevel` (int 0-10, default 1)
- `memes.maxUploadBytes` (int, 1-8 MB, default 5 MB)
- `memes.maxUploadsPerDay` (default 10)
- `memes.maxPending` (default 20)
- `memes.autoHideReports` (default 3)
- `memes.reviewChannelId` (channel, empty)

## Tests

- `app/lib/memes/*.test.ts`:
  - validation (type, size, dimensions, duplicate sha)
  - access (level gate, capo check fails closed)
  - status transitions (only PENDING -> APPROVED/REJECTED; HIDDEN <-> APPROVED by capo)
  - auto-hide threshold
- Route tests:
  - upload with no session, feature off, over cap, over pending
  - the file route refuses other members
  - review refuses non-capos
  - approve moves the file (blob calls mocked) and sets `publicUrl`
  - reject deletes the blob
- Dashboard card hidden when the feature is off. i18n keys present (`dashboard-i18n.test.tsx` pattern).

## Rough size

Medium: about 2-3 days. One migration, about 6 routes, 2 pages, 1 dashboard card, settings and tests. The
storage and sniffing helpers already exist.
