# Onboarding handbook: bring the onboarding and host docs into the app

Status: plan, awaiting review (see "Decisions for Snax" at the end). Public repo: this plan, the code,
the content and the PR text use generic wording only. No real people's names, no private Drive links.

## 1. Goal

The most-used onboarding docs live in Google Drive and are stale. Most of their flow has already been
rebuilt in the app (/join, the mafia-name generator, crews, missions and levels, /calls, the call guide
from #192). Replace the essential docs with maintained, translated (en/es/fr) pages in the app. Link
them from the missions and pages that need them. Then reduce the Drive docs to a pointer to the app.

Top stale docs, from the Drive audit (2026-10-27):

1. Onboarding Manual (EN) and Manual Onboarding (ES): replaced by **Getting started** and **Levels & missions**.
2. "Throwing a PizzaDAO Event" (SOP), plus the 2023 LATAM payment requirements: replaced by **Host a party**.
3. Event Budget Template: **stays a spreadsheet** (hosts copy it). The app links to it and holds the
   facts that change each year (date, cap, deadlines).
4. Proposal Process: replaced by **Proposals**, once the current process is confirmed (D5).
5. Twitter Guide: replaced by **Posting about PizzaDAO**.

Non-goals:

- Editing Drive docs from code or agents. Snax or the doc owners make the pointer edits by hand (section 7).
- Translating mission titles and descriptions. They are DB rows and English only today (see risk R6).
- Sponsor-facing or legal docs (Sponsorship Agreement, invoice tracker, payment form).
- A general CMS.

## 2. What already exists (survey)

| Thing | Where | Notes |
|---|---|---|
| Call guide (from #192) | `app/calls/how-to-attend/page.tsx`, `messages/*.json` → `howToAttend` | Server component. Prose is in i18n keys. The schedule comes from `getCrewMappings()`. Shows the next mission via `pickNextMission`. **Keep this URL** and treat it as a handbook chapter. |
| "Guides" nav item | `app/ui/SiteHeader.tsx:26` → `/manuals`, label `nav.manuals` = "Guides" | `/manuals` is the **crew manuals index, read from a Google Sheet** (`app/manuals/*`). It is not onboarding content. The label clashes with a new handbook (D2). |
| Join welcome links | `app/ui/onboarding/steps/WelcomeStep.tsx:150-152` | Explore → /crews, Stories → /articles, "Browse guides" → /manuals |
| Dashboard | `app/dashboard/[id]/page.tsx:273` | A single "How to attend" text link |
| Links on mission cards | `app/lib/missions-overview.ts:112-115`, `app/ui/missions/MissionCard.tsx:309-311` | Extra links attached per verifierKey (`PROOF_HINTS`, `referral`, `getBoxUrl`). This is the pattern for guide links. |
| Mission rows and editor | `prisma/schema.prisma` `Mission`, `app/admin/missions/MissionsEditor.tsx`, seeds in `app/lib/mission-verify/mission-config.ts` | DPR-only editor for title, description, isActive, params and reward. Edits are audited in `AppSettingChange`. |
| Settings system | `app/lib/settings/{registry,store,index}.ts`, `app/admin/settings/*` | Typed, audited, DPR-gated. **Integer inputs only today** (`input: { type: 'int' }`). Areas: missions, calls, disavow. |
| Markdown rendering | `app/ui/articles/ArticleRenderer.tsx` (react-markdown + remark-gfm, no raw HTML) | A client component. It can be reused, or a server twin can be made. |
| Locale | `app/lib/i18n/*`. Cookie `NEXT_LOCALE`, then Accept-Language. No URL prefix. `__tests__/catalog-parity.test.ts` | The handbook follows the same locale resolution. |
| Proposals in the app | `/vote` + `Poll` model (blind-signature polls, role-gated) | Not clear whether proposals go through /vote or a Sesh poll in Discord (D5). |
| Missions that need a how-to | L2 social post, L4 "Make a POAP for a community call", L5 selfie interview, L6 "Onboard a Bitcoin Pizza Day city" (rsv.pizza proof), vouch missions L4/L5/L6/L8, L5 Rare Pizza Box | None link to any explanation today, except the box purchase link. |

## 3. Where the content lives: code vs DB

The project rule: anything an admin will want to change without a PR goes in DB config with an admin
UI. That rule fits the **facts** in these docs (dates, the dollar cap, deadlines, links, thresholds).
Those facts are exactly what went stale in Drive. It fits the **prose** less well. The prose changes
rarely, has to be kept in sync across three languages, and benefits from review diffs.

**Recommended: a hybrid.**

1. **Prose lives in code**: one Markdown file per page per locale. It is rendered with react-markdown
   (no raw HTML) and reviewed in PRs, and the translations sit side by side so they cannot drift
   silently (parity tests, 5.4).
2. **Facts are DB settings**: a new `guide` area in the existing settings registry. Prose refers to
   them with whitelisted placeholders such as `{{gppDate}}` or `{{hostCapUsd}}`. DPR edits them at
   /admin/settings, and every language updates at once with no PR.
3. **Rules are rendered live from existing data**, never restated in prose. The Levels page generates
   its level table (titles, rewards, missions, vouch counts) from `Mission` rows. The call schedule
   comes from crew mappings, as the call guide already does. Writing rule: **prose never states a
   number that lives in config**. Use a placeholder or the generated table.

Alternatives considered:

- **A. Everything in i18n JSON keys** (as `howToAttend` does). Fine for a one-screen page, but painful
  for long SOP prose: hundreds of keys, no headings or lists, and translators lose context. Rejected
  for long pages. The page chrome (titles, nav, the "last reviewed" label) still uses JSON keys.
- **B. DB-editable pages**: a `HandbookPage(slug, locale, markdown, reviewedAt)` table, a DPR editor
  with preview, and audit through `AppSettingChange`. Fully satisfies "no PR to edit". Costs: an
  editor UI, per-locale drift that no test catches, content that cannot be reviewed in a PR, and
  translations that go stale silently when one locale is edited. **Deferred** as an optional follow-up
  (PR 7). The loader is built as `getHandbookPage(slug, locale)` so a DB override row can take
  precedence over the file later without touching any page.
- **C. MDX (@next/mdx)**. It adds a build dependency and config, and allows arbitrary JSX in content.
  More power than prose needs. Rejected.
- **D. Reuse Articles (`Article` model)**. Articles are member stories with comments and reactions,
  and have no locale dimension. Wrong shape. Rejected.

How the files are stored: markdown inside TS modules, e.g. `content/handbook/getting-started/en.ts`
with `export default String.raw\`...\``. They load with a static `import()` map keyed by
slug and locale. There is no `fs` read (no Vercel file-tracing config) and no raw-loader config for
Turbopack, and the type checker sees a missing file.

## 4. Pages (information architecture)

Route: **`/handbook`** (D2). Nav: add "Handbook" first in the Resources group. Rename `nav.manuals`
from "Guides" to "Crew manuals" so the two are not confused.

| Path | Replaces (Drive) | Content outline | Live data |
|---|---|---|---|
| `/handbook` | n/a | Short intro plus cards per chapter, grouped "New member" / "Hosting" / "Taking part". If signed in, shows "your next mission" (reuses `pickNextMission`). | next mission |
| `/handbook/getting-started` | Onboarding Manual EN + ES | `#join` (/join: Discord login, mafia name, crews, profile made for you) · `#discord` (verify, key channels, #show-and-tell) · `#calls` (link to the call guide and /calls) · `#crews` · `#connect-x` · `#invite` (personal invite link) · `#missions` (link to Levels) · `#rare-pizza-box` · `#help` (/support) | Discord invite (`{{discordUrl}}`), events URL |
| `/handbook/levels` | Manual "Buy our NFT" + levels sections | What levels are, how PEP rewards work, review vs auto-check, why some passes wait for a human (generic wording, no thresholds), `#vouching` (what a vouch means, how to vouch at /vouches), `#selfie-interview`, `#rare-pizza-box`, `#crew-leader`. **Generated table**: one section per level with `id="level-N"`, title, reward and mission titles. | `getMissionsByLevel()`, settings readers |
| `/calls/how-to-attend` (existing) | Manual step 1.6 / step 3 | Unchanged. Gains a "Handbook" pill and a breadcrumb back. | already live |
| `/handbook/host-a-party` | "Throwing a PizzaDAO Event" SOP, payment requirements 2023 (ES), LATAM playbook gist | `#before` (pick a venue, co-hosts, list it on the events site, rsv.pizza page, copy the budget template), `#budget` (cap `{{hostCapUsd}}`, needs approval, link to the template), `#pizza-math` (**one** ordering rule, D6), `#poaps`, `#announce` (Comms drafts page, posting guide), `#day-of` (global call link, photos and video checklist), `#after` (receipts, payment form, recap, survey), `#gpp` (Global Pizza Party `{{gppDate}}`, edition `{{gppEdition}}`, deadlines) | guide settings |
| `/handbook/make-a-poap` | none (gap the audit found) | Short how-to for the L4 POAP mission: create a drop, what to submit (matches `PROOF_HINTS.poap_drop`) | n/a |
| `/handbook/proposals` | Proposal Process | Written after D5. Who can propose, the template, how voting works, thresholds `{{proposalTiers}}`, and a link to /vote if the app is the venue | guide settings |
| `/handbook/posting` | Twitter Guide | Voice, what to post, the Comms drafts page (one-click Post on X / LinkedIn), hashtags `{{hashtags}}`, how the L2 social-post mission is checked (no numbers; the mission title carries them) | guide settings |

Every page shows "Last reviewed: <month year>" from the module's `reviewed` export. A page more than
12 months old gets a muted "may be out of date" note. Each page ends with "Something wrong? Tell us" →
`/support` (D7).

If a locale file is missing, the English page is shown with a one-line "Not yet translated" notice. The
parity test (5.4) keeps this from happening on main. The fallback is only a safety net.

## 5. Implementation (small PRs)

Each PR is independent and shippable, merged in order. Branch names `task/onboarding-guide-<n>`.

### PR 1: text, date and URL settings + the `guide` area

Files:
- `app/lib/settings/registry.ts`: add input types `{ type: 'text'; maxLength }`, `{ type: 'date' }`
  (ISO `YYYY-MM-DD`), `{ type: 'url' }` (https only, max 300). Add helpers `textSetting`, `dateSetting`,
  `urlSetting`. Add `SettingArea` `'guide'` with label "Handbook facts".
- New keys, all public (not `private`), `onReadFailure: { value: default }`. Defaults are generic facts
  only:
  - `guide.discordUrl`: url, default `https://discord.pizzadao.xyz`
  - `guide.eventsUrl`: url, default `https://events.pizzadao.xyz`
  - `guide.gppDate`: date, default `2027-05-22`
  - `guide.gppEdition`: int 1..50, default 7
  - `guide.hostCapUsd`: int 0..100000, default 625 (D4. 0 hides the cap sentence)
  - `guide.budgetTemplateUrl`, `guide.paymentFormUrl`, `guide.hostPlaybookUrl`: url, default **empty**
    (the link is hidden when empty). The Drive URLs go in via the admin UI, not into the public repo.
  - `guide.hashtags`: text max 200, default `#globalpizzaparty`
  - `guide.hostDeadlines`: text max 1000, markdown list, default empty (section hidden). A structured
    list is over-engineering for one yearly edit.
  - `guide.proposalTiers`: text max 1000, default empty (added in PR 5 once D5 is settled)
- `app/admin/settings/SettingsEditor.tsx`: render text, textarea, date and url inputs. The same
  confirm, reset-to-default and audit paths already exist.
- `app/lib/settings/registry.test.ts`: defaults validate, https-only urls, a bad date is rejected, and
  `javascript:` / `http:` urls are rejected.

### PR 2: handbook framework + Getting started + Levels (en/es/fr)

Files:
- `content/handbook/index.ts`: page registry, in order: `{ slug, group, icon, reviewed }`. Also an
  `import()` map keyed by slug and locale.
- `content/handbook/getting-started/{en,es,fr}.ts`, `content/handbook/levels/{en,es,fr}.ts`. Each
  exports `title`, `dek`, `reviewed`, `body` (markdown).
- `app/lib/handbook.ts`:
  - `getHandbookPage(slug, locale)` returns `{ meta, body, fellBack }`.
  - `renderPlaceholders(body, facts)` substitutes only whitelisted `{{key}}` names. Unknown names are
    left as-is and fail tests. A paragraph whose placeholder resolves to empty is dropped (so empty
    URLs hide their sentence).
  - `getHandbookFacts()` reads the guide settings and formats `gppDate` per locale with `Intl.DateTimeFormat`.
- `app/ui/handbook/HandbookMarkdown.tsx`: a **server** component (react-markdown works in RSC), styled
  like `ArticleRenderer`. Custom `h2`/`h3` renderers take an explicit trailing `{#anchor}` from the
  heading text and use it as the `id`. Anchors then stay identical across languages, so
  `/handbook/levels#vouching` works in es and fr. External links get `target=_blank rel="noopener
  noreferrer"`. Internal links use `next/link`.
- `app/handbook/page.tsx`, `app/handbook/[slug]/page.tsx`: `EditorialPage` / `EditorialMasthead`, like
  the call guide. `generateStaticParams` comes from the registry, with `dynamicParams = false` (an
  unknown slug gives a 404). Use `revalidate = 300` rather than `force-dynamic`, because the facts
  and mission rows change rarely. The "next mission" block on the index is the only per-viewer part;
  render it in a small `Suspense` child that reads the session.
- `app/handbook/levels/LevelsTable.tsx`: server component. It reads `getMissionsByLevel()`. If the DB
  is down it shows the prose without the table plus a "see /missions" link.
- `messages/{en,es,fr}.json`: new `handbook` namespace (chrome only: meta, group names, "Last
  reviewed", "Not yet translated", "Something wrong?", next mission). `nav.handbook`. `nav.manuals` →
  "Crew manuals" / "Manuales de crews" / "Manuels des crews".
- `app/ui/SiteHeader.tsx`: add `{ href: "/handbook", label: "handbook" }` first in Resources.
- `app/sitemap.ts`: add `/handbook` and each slug.
- `app/calls/how-to-attend/page.tsx`: add a "Handbook" pill to the masthead nav.

Content sources: rewrite from the audit's facts. Do not copy the Drive text: it is stale and it names
people. Use generic roles ("a crew lead", "the events crew"). ES and FR are drafted in the same PR and
need a fluent review (D3).

Tests (`app/lib/__tests__/handbook.test.ts`):
- Every registry slug has en, es and fr modules.
- Each locale's set of `{#anchor}`s equals the English set.
- Every `{{placeholder}}` used is in the whitelist, and every whitelist key exists in the settings registry.
- `renderPlaceholders` drops a paragraph whose value is empty.
- No raw HTML in bodies (`/<[a-z]/i` outside code spans).
- Internal links (`](/...)`) resolve to a known route or a handbook slug#anchor.

### PR 3: link missions and entry points to the handbook

Mission → page links are per-mission data that DPR will want to change when missions change, so they
go on the row:

- `prisma/schema.prisma`: `Mission.guideHref String? @db.VarChar(120)`. Migration
  `prisma/migrations/<ts>_mission_guide_href/` is additive and nullable, so the deploy is safe.
- `app/lib/mission-verify/mission-config.ts`: add `guideHref` to `MissionVerifierConfig`. The seed
  script `scripts/missions/set-verifiers.mjs` **fills NULLs only** (its existing contract), so admin
  edits are never reverted.
- `app/lib/admin-missions.ts` + `MissionsEditor.tsx`: an editable "Guide link" field. Validation is
  internal paths only, `^/(handbook|calls/how-to-attend|manuals|vouches|missions)(/[a-z0-9-]+)?(#[a-z0-9-]+)?$`,
  so it cannot be an external or `javascript:` URL. Edits are audited as `mission:<id>:guideHref`.
- `app/lib/missions-overview.ts`: pass `guideHref` through, and keep it in the cached anonymous list.
- `app/ui/missions/MissionCard.tsx`: if `guideHref` is set, show a "How to do this" link (i18n key)
  next to the invite/box links. Show it on completed cards too, but muted.
- `app/missions/MissionsClient.tsx`: link "How levels work" → `/handbook/levels` in the header.
- `app/ui/missions/LevelUpModal.tsx`: on the new level, link "What's next" → `/handbook/levels#level-N`.
- `app/dashboard/[id]/page.tsx:273`: replace the lone "How to attend" link with a row: "Getting
  started" (only while level ≤ 2), "How to attend a call", "Handbook".
- `app/ui/onboarding/steps/WelcomeStep.tsx:152`: "Browse guides" → `/handbook/getting-started`
  ("Read the handbook"). Keep `/manuals` reachable from the handbook index under "Crew manuals".

Default mission → page map (seeded; match rows by level and seedTitle, as the script does):

| Mission | guideHref |
|---|---|
| L1 Link X + follow | `/handbook/getting-started#connect-x` |
| L2 Say hi on a call | `/calls/how-to-attend` |
| L2 Post about PizzaDAO | `/handbook/posting` |
| L3 Share in #show-and-tell | `/handbook/getting-started#discord` |
| L3 Invite a friend | `/handbook/getting-started#invite` |
| L4 Make a POAP for a community call | `/handbook/make-a-poap` (PR 4; until it lands, `/handbook/host-a-party#poaps` or null) |
| L4 Get vouched by a member | `/handbook/levels#vouching` |
| L5 Join three crew calls | `/calls/how-to-attend` |
| L5 Do a selfie interview | `/handbook/levels#selfie-interview` |
| L5 Vouch for another member | `/handbook/levels#vouching` |
| L5 Own a Rare Pizza Box | `/handbook/levels#rare-pizza-box` (the box purchase link stays) |
| L6 Join Pepperoni Mafia | `/handbook/levels#level-6` |
| L6 Onboard a Bitcoin Pizza Day city | `/handbook/host-a-party` |
| L6 Get vouched by 5 members | `/handbook/levels#vouching` |
| L7 Become a Crew Leader | `/handbook/levels#crew-leader` |
| L8 Called upon by DPR | null |
| L8 Get vouched by 10 members | `/handbook/levels#vouching` |

Tests: the editor rejects an external URL, `javascript:` and an unknown root. The overview includes
`guideHref`. A test checks that every seeded `guideHref` anchor exists in the English handbook anchors
(it imports the PR 2 registry), so renaming an anchor breaks the build rather than the link.

### PR 4: Host a party + Make a POAP (en/es/fr)

- `content/handbook/host-a-party/{en,es,fr}.ts`, `content/handbook/make-a-poap/{en,es,fr}.ts`, plus
  registry entries.
- Uses `{{gppDate}}`, `{{gppEdition}}`, `{{hostCapUsd}}`, `{{budgetTemplateUrl}}`, `{{paymentFormUrl}}`,
  `{{eventsUrl}}`, `{{hostPlaybookUrl}}` and the `{{hostDeadlines}}` block.
- Settle the pizza-ordering contradiction (D6) and state **one** rule.
- City and attendance stats: none in prose unless Snax supplies verified numbers. The audit flagged
  the old blurb's numbers as wrong.
- Update the L4 POAP mission's `guideHref` default in `mission-config.ts`. This only takes effect on
  rows that are still NULL; otherwise DPR sets it in the editor.

### PR 5: Proposals + Posting (en/es/fr). Blocked on D5

- `content/handbook/proposals/*`, `content/handbook/posting/*`. Add the `guide.proposalTiers` setting.
- If proposals now run on /vote, link there and describe the role gate generically. If they still run
  as a Discord poll, describe the steps without channel-specific poll-creator links (they rot), and
  point to the channel by name.

### PR 6 (no code): Drive pointers. See section 7.

### PR 7 (optional, later): DB overrides for page prose

Only if DPR finds the PR cycle too slow after a couple of months. It would add a `HandbookOverride(slug,
locale, body, reviewedAt, updatedBy)` table, a DPR editor with preview at /admin/handbook, and audit via
`AppSettingChange` (`handbook:<slug>:<locale>`). The loader prefers the override, and the parity tests
run against the override at save time (an edit that drops an anchor is rejected).

## 6. Risks

- **R1 Content accuracy.** Several facts are unconfirmed: the call schedule, the proposal process, the
  2027 cap and deadlines, the canonical host playbook. Mitigation: all of them are settings or
  generated data, and empty defaults hide their sentences. Unconfirmed sections ship hidden rather than
  guessed.
- **R2 Translation quality.** The ES and FR drafts are machine-assisted. Mitigation: a fluent review
  before merge (D3), and the parity tests keep structure aligned.
- **R3 Duplicate sources of truth.** The Drive docs live on. Mitigation: the section 7 pointer edits
  are part of "done", and the app pages carry "Last reviewed".
- **R4 Broken deep links.** Mission links point at anchors. Mitigation: explicit `{#anchor}` ids,
  cross-locale parity tests, and the PR 3 test tying seeded links to real anchors. The admin field
  only accepts known roots.
- **R5 Confusion between "Guides" and "Handbook".** Mitigation: rename the nav label to "Crew manuals"
  (D2) and link to them from the handbook index.
- **R6 Mission titles stay English** inside translated pages (the levels table, mission cards).
  Accepted for now. Follow-up: an optional per-locale title/description on `Mission`.
- **R7 Public repo.** No Drive URLs, people's names or editorial values in code or PR text. Drive
  links go in only through the admin settings UI.
- **R8 Caching.** The levels table and facts use `revalidate = 300`, and the mission list has its own
  10-minute in-memory cache, so an edit can take up to ~10 minutes to show. That is acceptable for
  docs. The settings page help text says so.
- **R9 Markdown injection.** Only DPR can edit settings, and markdown is rendered without raw HTML. The
  `hostDeadlines` text goes through the same renderer. URL settings are https-only.

## 7. Drive docs after launch

Snax or the doc owners do this by hand after PR 4 is live (an agent can draft the pointer text, but
must not edit Drive).

Replace the body with a pointer (keep the title, prefixed "MOVED:", plus a one-paragraph note and the
link):

| Drive doc | Pointer to |
|---|---|
| PizzaDAO Onboarding Manual (EN) | app.pizzadao.org/handbook/getting-started |
| Manual Onboarding Español 2025 | same URL (the page follows the reader's language; note "cambia el idioma en el menú") |
| Throwing a PizzaDAO Event (SOP) | /handbook/host-a-party |
| Requisito aprobación Pagos GPP 2023 | /handbook/host-a-party#after |
| Proposal Process | /handbook/proposals (after PR 5) |
| PizzaDAO Twitter Guide | /handbook/posting (after PR 5) |

Keep in Drive, but link from the app (through settings):

- Event Budget Template: roll it forward to 2027 and put its URL in `guide.budgetTemplateUrl`. Replace
  its "Important info" text with a link to /handbook/host-a-party.
- PizzaDAO Work Payment form: put its URL in `guide.paymentFormUrl`.
- Global Pizza Party Host Playbook: once the canonical link is known, put it in `guide.hostPlaybookUrl`.

Keep as is (out of scope): Sponsorship Agreement, Sponsor invoice tracker, Event Announcement Guide
(check its dates separately), and the Crew sheet (live data).

Move to an "Archive" folder (no edit): How to Throw a Pizza Party (2022), Universal Event Guide 5/22,
5/22 Documentation Guide, 5/22 One Sheet, Pizzeria Perks Onboarding, Onboarding Plan slides (2021),
the 2022 outreach scripts. Close responses on the old Onboarding Google Forms and point them to /join.

Pointer text (EN): "This guide now lives in the PizzaDAO app and is kept up to date there:
<URL>. This copy is no longer maintained."

## 8. Verification

Automated (each PR): `npm run test:run` (the new handbook, settings and mission-editor tests, plus the
existing `catalog-parity.test.ts`), `npx tsc --noEmit`, `npm run lint`, `npm run build`.

Vercel preview (each PR, via `/ship`):

1. `/handbook` and each slug render in en, es and fr (switch with the language menu or the
   `NEXT_LOCALE` cookie). A missing slug gives a 404.
2. Deep links scroll to the right section in all three languages: `/handbook/levels#vouching`,
   `/handbook/getting-started#invite`.
3. The levels table matches /missions (titles, rewards, vouch counts). Edit a mission title in
   /admin/missions; the change appears within the cache window.
4. In /admin/settings → Handbook facts: set `guide.gppDate`, `guide.hostCapUsd` and
   `guide.budgetTemplateUrl`. The host page shows them, formatted per locale. Clear the URL and the
   sentence disappears. `http://` and `javascript:` are rejected. The audit row is written.
5. /missions: every mapped card shows "How to do this" and it lands on the right anchor. The L5 box
   card still shows the purchase link. A logged-out view works (cached list).
6. Dashboard (level 1 member): the "Getting started" link shows. /join welcome step → handbook.
   /calls/how-to-attend shows the Handbook pill. Nav: "Handbook" and "Crew manuals" are in Resources,
   on desktop and in the mobile menu.
7. `/mobile-check` on /handbook, /handbook/host-a-party and /missions (375px, long ES/FR words wrap,
   44px tap targets). Dark mode readable.
8. `/sitemap.xml` lists the handbook pages. View-source shows the page text server-rendered (good for
   SEO and link previews).
9. DB-down behaviour (local, bad `DATABASE_URL`): the handbook pages still render prose with the
   default facts, and the levels table falls back to the /missions link.

## 9. Decisions for Snax (recommended defaults in bold)

- **D1 Content storage.** **Hybrid: prose in code (markdown per locale), facts in DB settings, rules
  generated from data.** Alternative: fully DB-editable pages now (PR 7 first).
- **D2 Naming and route.** **`/handbook`, nav "Handbook"; rename the current "Guides" (/manuals) to
  "Crew manuals".** Alternative: `/guide`, keeping "Guides" for /manuals.
- **D3 Translations.** **Claude drafts ES and FR in the same PR; a fluent member (LATAM community for
  ES) reviews on the preview before merge.** Alternative: ship EN first with the "not yet translated"
  fallback.
- **D4 Host contribution cap.** **Ship with the setting at 625 but set it to 0 (hidden) until the
  November budget review confirms the 2027 figure.**
- **D5 Proposals.** Where do proposals run today: /vote, or a Discord poll? What are the current
  thresholds? **Hold PR 5 until answered; ship PRs 1-4 meanwhile.**
- **D6 Pizza math.** The SOP and budget template disagree. **Use the budget template's rule (an order
  about every 45 minutes, roughly one pizza per 1.5 guests)** unless the events crew prefers the other.
- **D7 Feedback link.** **"Something wrong? Tell us" → /support** (a ticket). Alternative: a GitHub
  edit link (public repo, but most members have no GitHub).
- **D8 Mission links.** **Store on `Mission.guideHref` (DPR-editable, seeded from the table in PR 3).**
  Alternative: a code map keyed by verifierKey (no migration, but needs a PR to change).
- **D9 Stats in the host page.** **Omit city and attendance numbers unless you supply verified figures**
  (optionally as `guide.*` settings with an "as of" date).

## 10. Implementation notes (PRs 1-4, branch feat/handbook)

Snax took every recommended default in section 9 and said "do it". Built: PRs 1-4. Not built: PR 5
(Proposals and Posting, still blocked on D5), PR 6 (Drive pointers, by hand), PR 7 (DB overrides).

Where the build differs from the plan above:

- **Unconfirmed settings ship empty, not at a guessed default.** All `guide.*` settings default to unset
  (empty string, or 0 for the numbers), including `discordUrl`, `eventsUrl`, `gppDate`, `gppEdition` and
  `hostCapUsd`. Text that depends on a value is hidden until DPR fills it in /admin/settings ("Handbook
  facts"). `guide.proposalTiers` was not added (PR 5).
- **Placeholder syntax.** `{{name}}` inline; a paragraph (or list line) with an empty value is dropped;
  `::if name` ... `::end` hides a whole section (no nesting).
- **No ISR.** The reader's language comes from a cookie, so the pages are `force-dynamic` (like the call
  guide) rather than `revalidate = 300`. Facts are still cached ~30s by the settings reader, and the
  mission list by its own cache.
- **Language names.** The nav and page title read "Handbook" / "Manual" / "Manuel".
- **ES and FR are drafts.** A fluent member (LATAM community for ES, a French speaker for FR) should read
  them on the preview before merge. Mission titles inside the levels table stay English (R6).
- **Mission links.** `Mission.guideHref` (migration `20261102300000_mission_guide_href`, additive, not
  applied). Defaults are seeded by `scripts/missions/set-guide-links.mjs` (dry run by default, fills NULLs
  only). The L2 "Post about PizzaDAO" mission has no default link until the Posting page (PR 5) exists.
- **Pizza math (D6).** The Host a party page states the budget template's rule: an order about every 45
  minutes, roughly one pizza per one and a half guests.
- **No city or attendance numbers (D9).**
- **Needs a person (Snax), in this order:** apply the migration, merge and deploy, fill the `guide.*`
  settings listed in the PR description, then run `set-guide-links.mjs` (dry run first), then do the Drive
  pointer edits in section 7.
