# Articles Page - pizzadao.org/articles

## Overview
A blog/articles feature where PizzaDAO can publish articles about the DAO. Public read access, role-gated authoring.

## Data Model

Add to `prisma/schema.prisma`:

```prisma
enum ArticleStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

model Article {
  id          Int           @id @default(autoincrement())
  slug        String        @unique
  title       String
  excerpt     String?
  content     String        // Markdown
  coverImage  String?       // URL
  authorId    String        // Discord ID
  authorName  String?       // Cached display name
  status      ArticleStatus @default(DRAFT)
  tags        String[]      // PostgreSQL array
  publishedAt DateTime?
  createdAt   DateTime      @default(now())
  updatedAt   DateTime      @updatedAt

  @@index([status, publishedAt])
  @@index([authorId])
}
```

## Authorization
- **View published**: Everyone (no auth)
- **View drafts**: Author + admins only
- **Create/edit**: Users with `ARTICLE_AUTHOR_ROLE_IDS` (Leonardo role + future Comms role)
- **Delete**: Admins only (soft delete → ARCHIVED)

Add `ARTICLE_AUTHOR_ROLE_IDS` to `app/ui/constants.ts`.

## New Dependencies
- `react-markdown` ^9.0.1
- `remark-gfm` ^4.0.0

## Pages

| Route | Purpose | Auth |
|-------|---------|------|
| `/articles` | Public list with search, tag filter, pagination | Public |
| `/articles/[slug]` | Article view with Markdown rendering | Public (published) |
| `/articles/new` | Create article form with live preview | Role-gated |
| `/articles/[slug]/edit` | Edit existing article | Author or admin |

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/articles` | GET, POST | List published (public) / Create (auth+role) |
| `/api/articles/[slug]` | GET, PATCH, DELETE | Read / Update / Archive |
| `/api/articles/drafts` | GET | Author's drafts (auth) |

## New Files to Create

**API:**
- `app/api/articles/route.ts`
- `app/api/articles/[slug]/route.ts`
- `app/api/articles/drafts/route.ts`

**Pages:**
- `app/articles/page.tsx`
- `app/articles/[slug]/page.tsx`
- `app/articles/new/page.tsx`
- `app/articles/[slug]/edit/page.tsx`

**Components:**
- `app/ui/articles/ArticleCard.tsx` — Card for list view (cover, title, excerpt, author, date, tags)
- `app/ui/articles/ArticleList.tsx` — Grid of cards with loading skeletons
- `app/ui/articles/ArticleEditor.tsx` — Markdown editor with split-pane live preview
- `app/ui/articles/ArticleRenderer.tsx` — react-markdown wrapper with themed styles
- `app/ui/articles/TagBadge.tsx` — Reusable tag badge
- `app/ui/articles/index.ts` — Barrel exports

**Library:**
- `app/lib/articles.ts` — CRUD functions, slug generation, validation

## Files to Modify
- `prisma/schema.prisma` — Add Article model + ArticleStatus enum
- `app/ui/constants.ts` — Add ARTICLE_AUTHOR_ROLE_IDS
- `app/dashboard/[id]/page.tsx` — Add "Articles" nav link (~line 327)

## Implementation Steps

### Step 1: Database Schema
1. Add ArticleStatus enum and Article model to schema.prisma
2. Run `npx prisma migrate dev --name add_articles`
3. Run `npx prisma generate`

### Step 2: Constants
Add `ARTICLE_AUTHOR_ROLE_IDS` to constants.ts (Leonardo role initially)

### Step 3: Library (`app/lib/articles.ts`)
- `generateSlug(title)` — URL-safe, handle collisions with numeric suffix
- `createArticle(authorId, authorName, data)` — Create draft
- `updateArticle(slug, authorId, data)` — Update (check ownership or admin)
- `publishArticle(slug, authorId)` — Set PUBLISHED + publishedAt
- `getPublishedArticles({page, limit, tag, search})` — Paginated public list
- `getArticleBySlug(slug)` — Single fetch
- `getUserDrafts(authorId)` — Author's drafts
- `deleteArticle(slug)` — Set to ARCHIVED

### Step 4: API Routes
Follow patterns from `app/api/polls/route.ts` and `app/api/bounties/route.ts`:
- `getSession()` for auth
- `hasAnyRole()` for permission checks
- `withErrorHandling()` wrapper
- `NextResponse.json()` responses

### Step 5: Components
- ArticleCard: Follow ManualCard pattern from `app/manuals/page.tsx`
- ArticleRenderer: react-markdown + remark-gfm, CSS variable theming
- ArticleEditor: Split pane (textarea + live preview), title/slug/excerpt/tags/cover fields
- Follow form patterns from `app/admin/polls/page.tsx`

### Step 6: Pages
- List page: Follow `app/manuals/page.tsx` pattern (back link, header, search, filters, cards)
- Detail page: Cover image, title, author (profile link), date, tags, rendered Markdown, edit button
- New/Edit pages: Auth-gated, ArticleEditor component, save draft / publish controls

### Step 7: Navigation
Add "Articles" link to dashboard header buttons (`app/dashboard/[id]/page.tsx` ~line 327)

## Design Decisions
- **Markdown content**: Developer-friendly, safe by default (no XSS), fits tech community
- **Slug-based URLs**: SEO-friendly (`/articles/how-pizza-dao-works`)
- **Cover images as URLs**: v1 uses external URLs; future iteration could add upload
- **Client components**: Match existing `"use client"` pattern; server-side metadata for SEO can be added later
- **No global nav change**: Dashboard is the hub; articles link goes there

## Verification Steps
1. Migration runs successfully, Article table exists
2. API: GET /api/articles returns empty list; POST without auth returns 401; POST with admin creates article
3. UI: /articles loads, /articles/[slug] renders Markdown, /articles/new is auth-gated
4. Dark mode works on all article pages
5. Vercel preview deployment builds successfully

## Potential Challenges
- **Markdown XSS**: react-markdown is safe by default; only add rehype-raw with rehype-sanitize
- **Slug collisions**: generateSlug must append numeric suffix on conflict
- **Large content**: Consider debounced auto-save for long articles
- **Cover image hosting**: v1 = external URLs, future = upload support
