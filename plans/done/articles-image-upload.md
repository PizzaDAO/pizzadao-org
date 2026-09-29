# Plan: Articles Image Upload

## Problem
Articles already render images via Markdown `![alt](url)` syntax, but authors must host images externally. We want first-class upload support.

## User flows to support
1. **Explicit upload**: Toolbar button opens file picker → uploaded → Markdown inserted at cursor
2. **Paste from clipboard**: Ctrl/Cmd+V on textarea → auto-upload → Markdown inserted
3. **Drag-and-drop**: Drop image onto textarea → auto-upload → Markdown inserted
4. **Cover image upload**: Upload button next to cover URL field → populates URL

## Storage decision: Vercel Blob
- Native Vercel integration (auto-provisions `BLOB_READ_WRITE_TOKEN` across environments)
- Simple `put()` API, no IAM/CORS/bucket config
- Fits existing Vercel stack (`@vercel/kv` already used)
- Public URLs by default (fine — blog images are public)
- PFP pattern (`public/pfp/`) is unusable — Vercel serverless filesystem is read-only at runtime

Rejected: S3/R2 (more config), Cloudinary (separate account), data URLs (bloats rows), `public/` writes (read-only fs).

## Database changes
**None.** `Article.coverImage` already stores a URL string. Blob URLs fit unchanged. Existing `coverImage` validation in `app/lib/articles.ts` accepts `http(s)` URLs so blob URLs pass.

## Dependencies
```
@vercel/blob ^0.27.0
```

## Env vars
`BLOB_READ_WRITE_TOKEN` — **Snax must provision** by creating a Blob store in Vercel dashboard (Storage tab → Create Blob Store → link to `onboarding` project). Auto-injects into all envs. Local dev: `vercel env pull .env.local`.

## Files to CREATE

### `app/api/articles/upload/route.ts`
- `POST` multipart/form-data with `file` field
- Auth: `getSession()` + `hasAnyRole(ARTICLE_AUTHOR_ROLE_IDS)` — same gate as article creation
- **MIME allow-list**: `image/png|jpeg|webp|gif`. **NO SVG** (XSS risk).
- **Size limit**: 5 MB max (enforced server-side)
- **Filename sanitization**: strip to `[a-zA-Z0-9_-]`, 60 char max
- **Key format**: `articles/{discordId}/{timestamp}-{6-char-random}-{safeBase}.{ext}` — unique, traceable
- Uses `put(key, file, { access: 'public', addRandomSuffix: false })` from `@vercel/blob`
- Returns `{ url, pathname, filename }`
- Wrapped with `withErrorHandling`

## Files to MODIFY

### `app/ui/articles/ArticleEditor.tsx`
Add:
- Refs: `contentRef` (textarea), `imageInputRef`, `coverInputRef` (hidden file inputs)
- State: `uploading: 'content' | 'cover' | null`, `uploadError: string | null`
- **Helper functions**:
  - `uploadImage(file)` — POSTs FormData, client-side MIME/size validation
  - `insertAtCursor(ta, text)` — splices text at selectionStart, restores focus+caret via requestAnimationFrame
  - `handleContentFile(file)` — uploads, derives alt from filename, inserts `![alt](url)` at cursor
  - `handleCoverFile(file)` — uploads, calls `setCoverImage(url)`
- **Event handlers** on content textarea:
  - `onPaste` — detect `image/*` in clipboardData.items, preventDefault, upload
  - `onDrop` — preventDefault, find first `image/*` in dataTransfer.files, upload
  - `onDragOver` — preventDefault if dragging files
- **UI additions**:
  - "Insert image" button in toolbar next to "Show preview", triggers hidden file input
  - Cover image row gets "Upload" button next to URL input
  - Upload error banner above editor body
  - "Uploading…" label / disabled state while in-flight
  - Placeholder updated to mention paste/drop support

### `.env.example`
Document `BLOB_READ_WRITE_TOKEN`.

### `app/ui/articles/ArticleRenderer.tsx`
**No changes needed** — already has `max-width: 100%`, `height: auto`, `border-radius: 8`, `margin: 16px 0` on images.

## Security

1. **Auth gate**: Discord session + `ARTICLE_AUTHOR_ROLE_IDS` role. No anonymous uploads.
2. **MIME allow-list**: png/jpeg/webp/gif only. NO SVG (script injection vector). Server rechecks.
3. **Size limit**: 5 MB server-side (definitive), client validates to fail fast.
4. **Filename sanitization**: strict allow-list regex, length cap.
5. **Collision avoidance**: timestamp + random suffix.
6. **Partitioning by discordId**: traceable attribution, enables per-user cleanup.
7. **CSRF**: SameSite lax session cookie + httpOnly signed HMAC = sufficient (matches existing article POST/PATCH pattern).
8. **Public blobs**: acceptable — published article images must be public. Unguessable URLs hide drafts.
9. **Rate limiting**: v1 relies on role gate. TODO: KV-based sliding window.
10. **EXIF stripping**: NOT in v1 (screenshots rarely have meaningful EXIF; authors are trusted). TODO.
11. **Image re-encoding**: NOT in v1 (pass-through). TODO: `sharp` resize/WebP conversion.
12. **Renderer safety**: react-markdown has NO `rehype-raw`, so only Markdown `![]()` parses to `<img>`. Safe.

## Implementation Steps

1. **Provision Vercel Blob store** (manual Vercel dashboard step)
2. `git worktree add ../onboarding-articles-image-upload -b articles-image-upload`
3. `npm install @vercel/blob`
4. Create `app/api/articles/upload/route.ts`
5. Modify `app/ui/articles/ArticleEditor.tsx` with refs, handlers, UI
6. Update `.env.example`
7. **Local smoke test**: click upload, paste screenshot, drag-drop, cover upload, oversized rejection, SVG rejection, draft+publish round-trip
8. Commit, push, draft PR, verify Vercel green
9. Merge to main for full auth+upload flow test (preview deploys can't test Discord OAuth)

## Verification Checklist

- [ ] `@vercel/blob` in package.json
- [ ] `BLOB_READ_WRITE_TOKEN` in Vercel env vars
- [ ] Upload returns 401 anon / 403 wrong-role / 400 bad-file / 200 success
- [ ] "Insert image" button works
- [ ] Paste screenshot works
- [ ] Drag-drop works
- [ ] Cursor position preserved after insertion (not end-of-doc)
- [ ] Cover upload populates URL field
- [ ] Disabled state during upload
- [ ] Errors surface without losing draft state
- [ ] Uploaded images render in preview AND on published page
- [ ] SVG rejected client + server
- [ ] >5MB rejected client + server

## Trade-offs & Future Work

- **Progress indicator**: v1 shows "Uploading…" label only. `XMLHttpRequest` needed for real progress bar.
- **Rate limiting**: v1 relies on role gate. Future: KV sliding window.
- **Image processing**: v1 is pass-through. Future: `sharp` resize/WebP/EXIF strip.
- **Drag visual feedback**: skipped in v1.
- **Orphan cleanup**: no GC for unused uploads. Future: periodic job.
- **Multi-file upload**: v1 is one-at-a-time.
- **Alt text UX**: v1 derives from filename. Future: prompt modal.
- **Media library**: v1 has no reuse UI. Future: `GET /api/articles/uploads` picker.

## Critical Files for Implementation

- `app/ui/articles/ArticleEditor.tsx` — Core editor to modify
- `app/api/articles/route.ts` — Pattern for withErrorHandling + auth gate
- `app/lib/errors/api-errors.ts` — UnauthorizedError / ForbiddenError / ValidationError
- `app/ui/constants.ts` — `ARTICLE_AUTHOR_ROLE_IDS`
- `app/lib/articles.ts` — Existing `coverImage` URL validation (accepts blob URLs unchanged)
