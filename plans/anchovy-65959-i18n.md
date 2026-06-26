# anchovy-65959 — i18n Infrastructure Scaffold

## Goal

Lay the foundation for multi-language support in the PizzaDAO onboarding app so
that the LATAM (Spanish), Africa (French, eventually Portuguese), and Music
crews can ship a translated UX in follow-up PRs. This PR is **infrastructure
only** — translation tables, locale resolution, the React hook, the DB column,
and the editor toggle. The only string actually translated end-to-end is the
onboarding `WelcomeStep`, which serves as a smoke-test for the pipeline. The
remaining ~thousands of strings stay English and will be migrated per-feature
in subsequent PRs.

Initial target locales:
- `en` — English (default fallback)
- `es` — Spanish (LATAM crews, Música crew Latin America)
- `fr` — French (Africa francophone crews — Mali, Côte d'Ivoire, Senegal, …)

Future locales (deferred): `pt-BR` (Brasil + Lusophone Africa), `it` (Italy
crews), `de`, `tr`, `ja`.

## Sheet entry

This task is `anchovy-65959`. The sheet has a related task `mozzarella-67760`
("Add Language Preference to the dashboard") — that task is the **member-facing
UI surface**; this one is the **infrastructure underneath**. After this PR,
mozzarella-67760 reduces to "add a dropdown to dashboard header that mutates
the same `locale` field this PR introduces."

The sheets-claude CLI has a known phantom-row bug (CLAUDE.md memory). Do not
attempt to mark this task Doing via the CLI — it will return success and the
row will not appear. Proceed without sheet updates.

## Library choice

Recommendation: **`next-intl`**.

### Alternatives considered

| Library | Pros | Cons |
|---|---|---|
| **`next-intl`** | First-class App Router support, server + client components both work, `useTranslations()` hook, ICU message format, locale routing optional, ~5 KB client runtime, active 2025/2026 releases | Adds ~5 KB + a provider wrapper; ICU syntax has a learning curve |
| `react-intl` (FormatJS) | Mature, ICU support, big ecosystem | Designed for Pages Router; needs adapters for App Router / RSC; provider must be client-only which forces "use client" everywhere |
| `i18next` + `react-i18next` | Largest ecosystem, namespaces | Bundle ~30 KB, awkward for RSC, two libraries to learn |
| `next-translate` | Lightweight | Author archived the repo in 2024, no longer maintained |
| Hand-rolled JSON map + `Intl.MessageFormat` browser API | Zero deps, full control | `Intl.MessageFormat` is Stage-2 and shipping piecemeal; we'd reimplement plurals, gender, fallback chains; messy SSR |

`next-intl` wins because (a) it is the only option specifically designed for
App Router + RSC, (b) it has both a client `useTranslations()` and a server
`getTranslations()` so we can translate both kinds of components, (c) ICU
syntax is standard and translators can use existing CAT tools, (d) we already
use TanStack Query so adding one more provider is no architectural change.

### Version

Install `next-intl@^4` (4.x is the line that supports Next 16 + React 19;
the 3.x peer-deps top out at Next 15, which blocks our install). This PR
locks in `next-intl@4.12.0`.

## URL strategy

Recommendation: **Cookie-based locale, no URL prefix**.

### Options considered

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **Cookie / `NEXT_LOCALE`** | `pizzadao.org/dashboard/123` everywhere | No URL changes, OG/social-share links stay stable, no rewriting needed, simplest to roll out | Less SEO-friendly for multi-lingual indexing (not a goal — DAO members find us via Discord, not Google) |
| URL prefix | `pizzadao.org/es/dashboard/123` | Crawlable per-locale, easy to share a specific-language link | Every route file must move under `app/[locale]/` (~80 files), all internal links must be locale-aware, OG metadata must be locale-aware, breaks every existing bookmark |
| Subdomain | `es.pizzadao.org` | Separation of concerns | DNS + Vercel project per locale, overkill |
| `Accept-Language` only | n/a | Zero config | User can't override; can't link "in Spanish please" to someone |

**Decision**: Cookie. Set `NEXT_LOCALE=es` on a 1-year cookie. On first request
with no cookie, derive from `Accept-Language` header. Profile editor lets the
member pin their preference (also written to DB so it persists across devices).

### Resolution order on a request

1. If logged-in member has `MemberProfileExtras.locale` set, use that and
   refresh the cookie.
2. Else if `NEXT_LOCALE` cookie is set, use that.
3. Else read `Accept-Language` header → first match in `['en','es','fr']`.
4. Else `en`.

This logic lives in `app/lib/i18n/get-locale.ts` (server only) and is wired
into the `next-intl` request config.

## Translation file layout

```
messages/
  en.json
  es.json
  fr.json
```

Per-locale flat-ish JSON keyed by feature namespace. Initial structure:

```json
{
  "common": { "save": "Save", "cancel": "Cancel", "loading": "Loading…", "back": "Back" },
  "onboarding": {
    "welcome": {
      "tagline": "Join the world's largest pizza co-op.",
      "joinButton": "Join PizzaDAO",
      "loginButton": "Already in our Discord? Login",
      "magicLoginButton": "Can't log in? Try Discord DM"
    }
  },
  "language": { "label": "Language", "english": "English", "spanish": "Español", "french": "Français" }
}
```

Only `onboarding.welcome.*` + the `language.*` keys + a handful of `common.*`
keys ship with real translations in this PR. Other namespaces will be added in
follow-up PRs as each feature is migrated.

### Rationale for one file per locale (vs. one per route)

- Translators get one file to edit per locale → simpler hand-off.
- Routes that compose multiple features (e.g. dashboard pulls
  missions+articles+pep) would otherwise need to import many namespace files.
- Bundle size: `next-intl` ships only the active locale's catalog to the
  client; the JSON is tree-shakeable per top-level key if it becomes large.

If files grow > ~5 K lines we can split into `messages/en/onboarding.json`
etc. — `next-intl` supports both layouts.

## String extraction process

Manual for now.

1. PR author looks at component, replaces literal `"Save"` with
   `t('common.save')`.
2. Adds the key to `messages/en.json` first (source of truth).
3. Adds the same key to `es.json` + `fr.json` — either translates inline or
   leaves it as the English value to be picked up by a translator in a later
   pass (marked with a `TODO_TRANSLATE_ES` / `TODO_TRANSLATE_FR` comment-like
   sentinel value, or just left as English string).
4. PR description lists the new keys added so a translator pass can sweep them.

Automation (deferred, separate task):
- ESLint rule `react-intl/no-literal-string` or similar to flag unwrapped
  JSX text.
- Script `npm run extract-strings` that walks `app/` for `t('...')` calls and
  diffs against catalogs to find missing keys per locale.
- Eventual integration with a translation service (Crowdin / Lokalise / Tolgee)
  — out of scope.

## Per-member preference

`MemberProfileExtras` already exists (from `truffle-91035`/`burrata-13316`,
where it was introduced for the `tagline` field). We extend it additively
with a `locale` column rather than creating a parallel table:

```prisma
model MemberProfileExtras {
  memberId  String   @id // Google Sheets member ID
  tagline   String?  @db.VarChar(140)
  locale    String   @default("en") // ISO 639-1, one of SUPPORTED_LOCALES
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Migration: `prisma/migrations/20260521000000_add_locale_to_member_profile_extras/`
runs an `ALTER TABLE … ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en'`.
Existing rows pick up `en` automatically — no backfill needed. New members
without a row still resolve to `en` via the API's fallback logic.

## API surface

The endpoint `/api/profile-extras/[id]` already exists (built for `tagline`
in burrata-13316). We extend rather than fork:

- `GET /api/profile-extras/[id]` → `{ tagline: string | null, locale: SupportedLocale }`
  - Public read. `locale` falls back to `'en'` when no row or the stored
    value is unrecognized.
  - Cache: `public, max-age=60` (same as the existing tagline cache).
- `POST /api/profile-extras/[id]` → body accepts a subset of
  `{ tagline?: string, locale?: SupportedLocale }`
  - Auth-gated: caller's Discord ID must resolve to the same memberId.
  - Validates `locale` against `SUPPORTED_LOCALES` (400 otherwise).
  - Upserts only the fields present in the body — tagline-only PRs from the
    existing `TaglineEditor` keep working unchanged.
  - When `locale` is included and accepted, the response **also sets the
    `NEXT_LOCALE` cookie** so the change takes effect on the very next
    navigation.

## Editor UI

New route: `/profile/[id]/edit/` (does not exist yet — the wizard is the
current "edit" surface, accessed via `?edit=1` query).

For this PR we'll add the minimal **Language** section as a stand-alone page
that re-uses the existing card styles. Layout:

```
┌─ Language ───────────────────────────┐
│  Choose how the app talks to you.    │
│                                      │
│  [ English  ▼ ]                      │
│    English                           │
│    Español                           │
│    Français                          │
│                                      │
│  [ Save ]                            │
└──────────────────────────────────────┘
```

On Save: `POST /api/profile-extras/[memberId]`, then `router.refresh()` so the
new locale propagates through RSC. Toast on success (re-use existing pattern
from profile-links page if present, else minimal inline confirmation).

Auth check on the page: must be logged in **and** the session's Discord ID
must match the member's Discord ID. Otherwise 403.

In follow-up PRs, we'll likely fold this into a larger profile-settings page;
for this PR it stands alone so the verification flow is unambiguous.

## Server-side rendering considerations

- Root layout becomes async; reads locale from the request via
  `next-intl/server`'s `getLocale()` and wraps children in
  `NextIntlClientProvider` with the resolved messages catalog.
- `<html lang={locale}>` so the browser, screen readers, and Google all get
  the right hint.
- Client components use `useTranslations('namespace')`.
- Server components use `getTranslations('namespace')`.
- Loading skeletons render before locale is resolved → fine, they have no
  strings.
- OG metadata: `generateMetadata` can read locale and return localized titles
  / descriptions. **Out of scope for this PR** — articles' OG tags stay
  English. Tracked as a follow-up.
- Streaming / Suspense: `next-intl` is Suspense-compatible; nothing special.

## Phased delivery

This PR (#1 of ~5):

- Install `next-intl`.
- Add `messages/{en,es,fr}.json` with welcome + common + language keys.
- Wire `i18n/request.ts`, `i18n/get-locale.ts`, `middleware.ts` (if needed
  for cookie reading — likely not, can be done in request config).
- Wrap root layout in `NextIntlClientProvider`.
- Prisma migration for `MemberProfileExtras`.
- `GET`/`POST /api/profile-extras/[memberId]`.
- `/profile/[id]/edit/` page with the Language card.
- Translate `WelcomeStep` end-to-end (real es + fr).
- Smoke-test: change locale via the editor → `WelcomeStep` shows translated
  copy on next visit.

PR #2 (follow-up): Translate the onboarding wizard fully — every step + the
claim flow + magic login + loading screen.

PR #3: Translate the dashboard — hero, missions card, attendance card,
turtles, crews list, all CTAs.

PR #4: Translate the profile page — section headings, level badge, vouch
button, articles list, attendance card, profile-links display.

PR #5: Translate articles + missions + pep + remaining surfaces (admin /
notifications). May split into separate PRs if it gets large.

After PR #5: enable automation (extraction script + lint rule), open the door
to additional locales (pt-BR, it).

## Files changed (in this PR)

- `package.json`, `package-lock.json` — `next-intl@4` dep
- `messages/en.json` (new)
- `messages/es.json` (new)
- `messages/fr.json` (new)
- `app/lib/i18n/request.ts` (new) — `next-intl` request config
- `app/lib/i18n/get-locale.ts` (new) — cookie/Accept-Language resolution
- `app/lib/i18n/locales.ts` (new) — `SUPPORTED_LOCALES` constant
- `app/layout.tsx` — async, `NextIntlClientProvider` wrap, `<html lang>`
- `app/ui/onboarding/steps/WelcomeStep.tsx` — uses `useTranslations`
- `app/api/profile-extras/[id]/route.ts` — extends existing tagline endpoint
  to also handle `locale` field (additive: tagline-only POSTs still work)
- `app/profile/[id]/edit/EditClient.tsx` — adds `LanguageSection` +
  `LanguageEditor` (page.tsx unchanged — already does ownership gating)
- `prisma/schema.prisma` — extends `MemberProfileExtras` with `locale`
- `prisma/migrations/20260521000000_add_locale_to_member_profile_extras/migration.sql`
- `next.config.ts` — wires `createNextIntlPlugin('./app/lib/i18n/request.ts')`

## Open questions

1. **RTL languages**: When/if Arabic ships, we'll need `dir="rtl"` on
   `<html>` and an audit of every absolutely-positioned UI element. Punt.
2. **Date/number formatting**: `next-intl` includes `useFormatter()` —
   relative dates, currency. We'll start using it lazily; current code uses
   raw `toLocaleDateString('en-US')` in many places, which is the wrong
   pattern but not breaking. Cleanup in a later PR.
3. **Article content** (Markdown body) is authored in one language by the
   author. Do we translate manually, machine-translate on the fly, or
   tag-and-route? Probably "author tags the language, surface it on the
   article card, render as-is". Out of scope; flagged.
4. **Discord bot messages** (notifications, DM-via-bot magic login) are
   currently English-only and live in a separate codebase. Cross-team
   coordination needed — flagged, out of scope.
5. **Email templates** (if any are added later) need their own i18n strategy
   — `next-intl` doesn't help there since emails are rendered ahead-of-time.
6. **Pluralization**: ICU plural syntax (`{count, plural, one {1 task} other {# tasks}}`)
   works in `next-intl` out of the box. We don't have many plurals yet so
   not stressing about it.
7. **Locale fallback chain**: If a key is missing from `es.json`, do we fall
   back to `en` silently or render the key path? `next-intl` defaults to
   key-path with a console warning, which is good for development. In
   production we'll want silent fallback to `en` — configurable via
   `onError` / `getMessageFallback` in the provider. Wire on first PR.

## Verification

Local:
1. `cd onboarding-anchovy-65959`
2. `npm install`
3. `npm run dev`
4. Open `/`. Confirm `WelcomeStep` shows English copy.
5. Log in, navigate to `/profile/<id>/edit`. Change language to Español.
   Save.
6. Navigate to `/` again (or log out → re-enter wizard). `WelcomeStep` now
   shows Spanish copy.
7. Repeat for Français.

Vercel preview: same flow on the preview URL. Discord OAuth won't work on
preview (memory note), so verify the Language editor + `WelcomeStep` switch
either (a) by manually setting the cookie via DevTools, or (b) by skipping
auth in the preview and visiting `/` directly with a `NEXT_LOCALE` cookie.

## Risks

- `next-intl`'s plugin wraps `next.config`. If the project's `next.config` is
  TypeScript-style, the integration uses `withNextIntl(nextConfig)`. Verify
  before pushing.
- Root layout becoming async means children that depended on sync render are
  fine but we should re-check the existing `<Providers>` wrapper. Should be
  no-op.
- `prisma generate` runs on `postinstall`. The new model needs to be in the
  schema before `npm install` is re-run in CI. The migration deploy is
  separate (`prisma migrate deploy`).
- Database migration deploys via `.env.migration` per CLAUDE.md memory. Run
  manually before merging this PR or the preview will 500 on profile-extras
  endpoints.

## Done means

- Plan committed.
- Worktree off main, branch `anchovy-65959-i18n-scaffold`.
- `next-intl` installed and wired.
- Migration applied to Neon.
- `WelcomeStep` translated to es + fr.
- Profile editor `/profile/[id]/edit` shows the Language card and saving
  flips the locale.
- Vercel preview green, smoke-test passes against preview.
- Draft PR opened, follow-up PRs (#2–#5) listed in PR body.
