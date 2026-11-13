# tax-form-native: host the Rare Pizzas tax-form page on app.pizzadao.org

Status: plan. Branch `task/tax-form-native` (pizzadao-org), plus one small rsv-pizza PR.

## 1. Goal

A payee opens `https://app.pizzadao.org/tax-form?payee=<token>`, fills in a W-9, W-8BEN or W-8BEN-E,
saves drafts and signs, and never lands on rsv.pizza. Only the frontend moves. The rsv-pizza backend
(`https://api.rsv.pizza`) stays the source of truth for drafts, TIN encryption, PDF generation, signing,
private storage and status. The 134 existing tokens keep working unchanged: no DB, token or API changes.

Today `next.config.ts` `redirects()` sends `/tax-form` to `https://rsv.pizza/tax-form` with a 307 (PR #165).
`proxy.ts` is unrelated (its matcher is `/disavow` only).

## 2. What exists (rsv-pizza `origin/master` @ f04ad2a1)

- Page: `frontend/src/pages/TaxFormRequestPage.tsx` (249 lines). It covers these states: loading,
  invalid token, load error, submitted, locked, rejected banner, "TIN on file" banner, form picker, editor,
  and Save draft / Sign and submit. Sets `noindex,nofollow`.
- Hook: `frontend/src/hooks/useTaxFormEditor.ts` (78 lines). This is the pick, edit, save, submit state
  machine with an API adapter, and `seedFormData` defaults the date to today.
- Forms, in `frontend/src/components/payouts/tax/`: `W9Form.tsx` (656), `W8BENForm.tsx` (509),
  `W8BENEForm.tsx` (761), `TaxFormPicker.tsx` (76), `CountryPicker.tsx` (191).
- Utils: `frontend/src/utils/taxTreaties.ts` (310) and `frontend/src/utils/countries.ts` (350).
- Primitives the forms use: `IconInput` (66), `Checkbox` (45), and `LocationAutocomplete` (396, which
  needs Google Maps Places).
- API client in `frontend/src/lib/api.ts` (lines about 8075-8125): `PublicTaxFormRequest` type,
  `getPublicTaxFormRequest`, `savePublicTaxFormDraft`, `submitPublicTaxForm`. Errors come back as
  `{ error: { message, code } }`, and the page branches on `code === 'INVALID_TOKEN'`.
- Backend `backend/src/routes/tax-form-request.routes.ts`:
  - `GET /api/tax-form-requests/:token` sets `openedAt` and flips `sent` to `opened`. Every load has
    this side effect.
  - `POST /:token/draft` and `POST /:token/submit` both take `{ formType, formData }`.
  - Submit records `signerIp: req.ip` and `signerUserAgent`.
  - Rate limits: 120 per 15 min per IP on the router, and 60 per 15 min per IP+token on each route. The
    global `/api` limiter adds 500 per 15 min per IP.
  - The routes take no user auth, so a Bearer header is ignored.
- Backend `backend/src/index.ts`: `trust proxy 1`. A global `cors()` with `credentials: true` checks
  `isAllowedOrigin(origin, ALLOWED_ORIGINS)` from `backend/src/lib/cors.ts` (tests in `cors.test.ts`).
  - `ALLOWED_ORIGINS` comes from the env var when it is set, otherwise from the hard-coded list (rsv.pizza
    and globalpizza.party). The env var REPLACES the list.
  - Any other origin gets a 403 `CORS_FORBIDDEN` on every request, preflight included.
  - CORS runs before the rate limiters, so preflights don't use up rate-limit budget.
- **Verified 2026-11-13** with a preflight-only probe (`OPTIONS`, which never reaches the route or the DB):
  `Origin: https://rsv.pizza` returns 204 with ACAO, and `Origin: https://app.pizzadao.org` and
  `https://onboarding-git-x-pizza-dao.vercel.app` both return **403**. The CORS change is a hard
  prerequisite.
- pizzadao-org preview origins (from PR #165) are `https://onboarding-git-<branch>-pizza-dao.vercel.app`
  and `https://onboarding-v7lj-git-<branch>-pizza-dao.vercel.app`, plus hash-style `onboarding-<hash>-pizza-dao`.

## 3. Approach

Use a client component that calls `api.rsv.pizza` directly from the browser. The payee's own IP reaches
the backend, so the signature IP and the per-IP rate limits behave exactly as they do on rsv.pizza today.
The cost is a cross-origin call, which needs the CORS PR.

### Alternatives considered (rejected)
- **Next.js rewrite or route-handler proxy** (`/api/tax-form-requests/* -> api.rsv.pizza`): this needs
  no CORS and shows no rsv host in devtools. But the backend would see Vercel's egress IP: with
  `trust proxy 1`, `req.ip` becomes the proxy. That breaks `signerIp` (an audit field on the signed
  form) and puts every payee in one rate-limit bucket (120 per 15 min). Forwarding `X-Forwarded-For` would
  need backend trust changes, which is more than scope allows.
- **Server-side fetch of the GET in `page.tsx`**: same IP problem. It would also flip status to `opened`
  on link-unfurl bots (Slack, iMessage) that fetch HTML. A client-side fetch only fires in a real
  browser that runs JS, and that is the behavior today.
- **Import the rsv-pizza components as a shared package**: these are Vite/React-router components
  with rsv theme classes, and no package exists. That is too much for one page. We copy them and
  record the source commit (drift risk, section 6).
- **Google Places on the address fields**: drop it. It would need a Maps key and CSP additions in
  pizzadao-org. City, state and ZIP are already separate required inputs, so a plain street input loses
  only autofill.

## 4. rsv-pizza PR (merge FIRST)

Branch `tax-form-cors` (rsv convention is `{task-id}-{short-name}` with no prefix, against `master`).

1. `backend/src/lib/cors.ts` gets three additions:
   - `PIZZADAO_APP_ORIGIN = 'https://app.pizzadao.org'`.
   - `PIZZADAO_PREVIEW_ORIGIN = /^https:\/\/onboarding(-v7lj)?-[a-z0-9-]+-pizza-dao\.vercel\.app$/`.
     The `-pizza-dao.vercel.app` suffix is reserved for the pizza-dao Vercel team.
   - `isTaxFormRequestPublicPath(path)`, which returns `/^\/api\/tax-form-requests(\/|$)/.test(path)`.
     It must NOT match `/api/admin/tax-form-requests`.
   - Also `isAllowedTaxFormOrigin(origin, allowed)`, which returns
     `isAllowedOrigin(origin, allowed) || origin === PIZZADAO_APP_ORIGIN || PIZZADAO_PREVIEW_ORIGIN.test(origin)`.
   - The pizzadao origins are in code, not in `ALLOWED_ORIGINS`, so they work whether or not that env
     var is set in prod.
2. `backend/src/index.ts` switches the global middleware to the per-request options form,
   `app.use(cors((req, cb) => ...))`:
   - Tax-form public paths use `origin: (o, done) => !o || isAllowedTaxFormOrigin(o, ALLOWED_ORIGINS) ? done(null, true) : done(new AppError('Not allowed by CORS', 403, 'CORS_FORBIDDEN'))`
     with `credentials: false`. These routes use no cookies, and rsv.pizza's `apiRequest` never sends
     `credentials: 'include'`, so this is safe and gives the narrowest grant.
   - Every other path keeps today's options unchanged.
   - Keep the middleware in the same position, before the limiters, so preflights still don't count.
3. Tests:
   - Extend `backend/src/lib/cors.test.ts`: the app origin and both preview patterns are allowed on the
     tax path. They are rejected for `/api/parties/...` and for `/api/admin/tax-form-requests`.
     `onboarding-git-x-otherteam.vercel.app` and `https://app.pizzadao.org.evil.com` are rejected.
   - Add a supertest case: OPTIONS and GET on `/api/tax-form-requests/<bogus>` with
     `Origin: https://app.pizzadao.org` return ACAO, and the GET returns 404 `INVALID_TOKEN`.
4. Implications to note in the PR body:
   - Cookies: none (`credentials: false`).
   - Signature IP: unchanged, because the browser calls the API directly and `req.ip` is still the
     payee. The UA comes from the payee's browser as before.
   - Rate limits: unchanged per payee. `POST` with JSON adds one preflight per call. Preflights are
     answered by cors before the limiters.
   - The backend logs nothing new.
5. Merge, wait for the backend auto-deploy (about 1 min from master), then verify with preflight-only
   curls (no DB touch):
   `curl -s -o /dev/null -D - -X OPTIONS https://api.rsv.pizza/api/tax-form-requests/probe-not-a-token -H 'Origin: https://app.pizzadao.org' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type'`
   should return 204 with `access-control-allow-origin: https://app.pizzadao.org`. Repeat with a preview
   origin (204) and against `/api/parties/x` (403).

## 5. pizzadao-org PR (merge SECOND)

### Files

New, under `app/tax-form/`:
- `page.tsx` is a server component:
  - `export const dynamic = "force-dynamic"`.
  - `generateMetadata` uses `getTranslations("taxForm")` for the title, and sets
    `robots: { index: false, follow: false }` and `referrer: "no-referrer"`.
  - It reads `searchParams` (a Promise in Next 16) and passes `token` to the client, which avoids the
    `useSearchParams` Suspense boundary.
  - Wrap in `EditorialPage width="max-w-[720px]"` (`app/ui/shared/Editorial.tsx`), as
    `app/payments/new/page.tsx` does.
- `TaxFormClient.tsx` (`"use client"`) ports `TaxFormRequestPage`:
  - Same states and logic. Brand-neutral copy: "Rare Pizzas is requesting...", using `info.requester`
    from the API. No rsv or GPP text.
  - Styling: `paperCard`, `pillInk` and `pillOutline` from `Editorial.tsx`, plus `hsl(var(--...))` tokens.
  - Chrome strings come from `useTranslations("taxForm")`.
- `_lib/api.ts` holds:
  - `TAX_FORM_API_BASE = (process.env.NEXT_PUBLIC_RSV_PIZZA_API_URL?.trim() || "https://api.rsv.pizza").replace(/\/+$/, "")`.
  - `PublicTaxFormRequest` and `TaxFormType` types.
  - `getRequest`, `saveDraft` and `submit` using `fetch(..., { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" })`.
  - Parse `{ error: { message, code } }` into `Error & { code }`. Handle a 429 with a friendly message.
- `_lib/useTaxFormEditor.ts` is copied verbatim (no React deps beyond hooks).
- `_components/`: `W9Form.tsx`, `W8BENForm.tsx`, `W8BENEForm.tsx`, `TaxFormPicker.tsx`, `CountryPicker.tsx`.
  - Logic and the `*FormData` field names stay byte-for-byte the same, because the backend's PDF
    service keys off them.
  - Only these mechanical edits:
    - Import paths.
    - `LocationAutocomplete` becomes a plain street `IconInput`. Remove the `onCitySelected` autofill.
    - Class swaps: `text-theme-text` becomes `text-foreground` and `text-theme-text-muted` becomes
      `text-muted-foreground`. `text-white/40` becomes `text-foreground/50`. Drop every
      `[.gpp-theme_&]:` variant and use the light-theme colour (the app has a light/dark toggle, so
      check both). `card` becomes `paperCard`.
  - Each file gets a header comment: `Ported from rsv-pizza@f04ad2a1 frontend/src/...; keep formData keys in sync`.
- `_components/primitives.tsx` holds `IconInput` and `Checkbox` with the same props as rsv's. Restyle
  inputs to the pizzadao `field` look: `min-h-11 rounded border bg-card px-3`, keep the icon padding.
- `_lib/taxTreaties.ts` and `_lib/countries.ts` are copied verbatim (pure data and functions).

Modified:
- `next.config.ts`:
  - Delete the `/tax-form` entry in `redirects()`. It must go in the same PR: config redirects run
    before filesystem routes, so the page would otherwise be shadowed. Remove `redirects()` if it is
    empty.
  - Append a header rule after the global one (Next applies the later match for the same key):
    `{ source: "/tax-form", headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "X-Robots-Tag", value: "noindex, nofollow" }, { key: "Cache-Control", value: "private, no-store" }] }`.
  - Add the API origin to `connect-src` in `CSP_REPORT_ONLY` (`https://api.rsv.pizza`). This avoids
    violation reports now and breakage once the CSP is enforced.
- `app/robots.ts`: add `"/tax-form"` to `disallow`. A crawler that runs JS would otherwise call the
  GET and flip a real token to `opened`.
- `messages/en.json`, `es.json`, `fr.json`: add a `taxForm` namespace with page chrome only: title,
  intro, payee line, the invalid, locked, submitted and rejected texts, the "TIN on file" text, the
  picker heading, buttons, and loading or error text.
  - `app/lib/i18n/__tests__/catalog-parity.test.ts` requires the same keys and ICU placeholders in all
    three files.
  - The IRS form field text inside the W-forms stays English, as on rsv.pizza (US tax forms).
- `.env.example` (if present) or a README note: `NEXT_PUBLIC_RSV_PIZZA_API_URL` is optional and
  defaults to `https://api.rsv.pizza`. No Vercel env change is needed. Previews also hit the prod
  backend, which is the only one there is.

### Token-leak hardening (summary)
- The token stays in the query string (links are already out).
- `Referrer-Policy: no-referrer` comes from the header, the `<meta name="referrer">` (via metadata) and
  the per-fetch `referrerPolicy`.
- `X-Robots-Tag` plus robots metadata, a robots.txt disallow, and `no-store`.
- No analytics are loaded in pizzadao-org (checked `layout.tsx` and `providers.tsx`).
- Never log the token or formData in the client. Never echo a TIN (the API already redacts it).

## 6. Risks
- **Form drift**: the backend may add or rename formData keys and update rsv's forms but not these.
  Mitigations: the header comment with the source SHA, and a vitest snapshot of each form's emitted
  keys (section 7). Add a line to the rsv-pizza `CLAUDE.md` in the CORS PR: "tax forms are also
  rendered by pizzadao-org app/tax-form; update both".
- **CORS ordering**: if the pizzadao-org PR merges first, the page breaks. Merge rsv-pizza first and
  verify with curl. pizzadao-org previews also only work after that.
- **Preview regex too broad or narrow**: covered by the tests. If Vercel renames the projects, previews
  fail closed (403) and prod is unaffected.
- **Address autofill lost** (Places dropped): accepted for this scope.
- **Copy says "Rare Pizzas"** only through `info.requester`. Requests with requester `pizzadao` show
  "PizzaDAO", which is fine.
- Rollback: revert the pizzadao-org PR, which also restores the redirect. The CORS change is additive
  and harmless to leave in place.

## 7. Verification

Unit tests (vitest, jsdom). Never hit the network: stub `global.fetch` with `vi.stubGlobal`.
- `app/tax-form/__tests__/api.test.ts` covers:
  - URL building uses `encodeURIComponent(token)` and the env base, with a trailing slash stripped.
  - `credentials: "omit"` and `referrerPolicy: "no-referrer"` are sent.
  - The error `code` is parsed, including on a 429.
- `app/tax-form/__tests__/TaxFormClient.test.tsx` renders with `renderWithIntl`
  (`app/lib/i18n/test-utils.tsx`) against mocked API responses and covers:
  - Invalid token, and no token (no fetch at all).
  - Locked, and the rejected banner.
  - Draft restore (shows the "TIN on file" banner; the SSN input is empty).
  - Pick W-9, then Save draft posts `{formType, formData}`.
  - Submit shows the thank-you state. A double-click results in a single POST.
- `app/tax-form/__tests__/formKeys.test.tsx`: fill each form and snapshot `Object.keys(formData)`
  (drift guard).
- `useTaxFormEditor` gets the `seedFormData` date default test.
- `npm run test:run`, `npm run lint`, `npm run build`.

E2E (Playwright, `e2e/tax-form.spec.ts`). It must never open a real link: mock everything and block
the real API.
- First route `https://api.rsv.pizza/**` (and the env base) to `route.abort()`. Then fulfil
  `**/api/tax-form-requests/e2e-fake-token-000000000000000/**` with fixtures. Only use that fake
  token (at least 20 chars, so it is shaped like a real one but not in the DB).
- Assert:
  - The page renders, the picker works, Save draft and submit work against the mocks.
  - `page.request.get('/tax-form?payee=e2e-fake...')` response headers include
    `referrer-policy: no-referrer` and `x-robots-tag: noindex, nofollow`, with no 307 to rsv.pizza.
  - The DOM has `<meta name="robots" content="noindex, nofollow">`.
  - No request goes to any rsv.pizza page host.
- Run it against the preview: `PLAYWRIGHT_BASE_URL=https://onboarding-git-task-tax-form-native-pizza-dao.vercel.app npx playwright test -c e2e e2e/tax-form.spec.ts`.

Vercel preview checks (after the rsv-pizza PR is live), with no real tokens:
- `curl -sI '<preview>/tax-form?payee=x'` returns 200 (not 307) with the headers above.
- Open `<preview>/tax-form?payee=not-a-real-token-xxxxxxxxxx` in a browser. Expect the "This link isn't
  valid" card. The network tab shows the GET to api.rsv.pizza answered 404 with ACAO set and no CORS
  error. An unknown token does no DB write.
- Repeat on mobile width (`/mobile-check`).
- Do NOT open any link copied from the 134 existing requests on the preview or in prod checks.

Snax end-to-end, on the preview and then again on prod after merge:
1. On `https://rsv.pizza/payments` (Tax-form requests section), create one request with label
   `TEST Snax <date>` and his own email, then copy the link.
2. Replace `https://rsv.pizza` with the preview origin (later `https://app.pizzadao.org`) and open it.
   Expect the intro "Rare Pizzas is requesting...", Payee "TEST Snax...", with nothing that says rsv.pizza.
3. Pick W-9. Fill it in and type a fake but format-valid SSN himself. Click Save draft and reload. The
   draft is restored, the SSN field is empty, and the "TIN on file" banner shows.
4. Retype the signature and click Sign and submit. The thank-you card shows, and reloading shows the
   "Form already submitted" card.
5. Back on rsv.pizza/payments, check the request: status submitted, the PDF opens in the review panel,
   and the signer IP is his own IP, not a Vercel IP.
6. Optionally reject it with a reason and reopen the link: the rejected banner shows and he can
   resubmit (try W-8BEN this time).
7. Revoke the test request. The link now shows "This link isn't valid".

## 8. Order of operations
1. rsv-pizza PR `tax-form-cors`: implement, review, merge to `master`, then run the curl checks in
   section 4.5.
2. pizzadao-org `task/tax-form-native`: implement, `/ship` for the PR and preview, preview checks, then
   Snax's e2e on the preview.
3. Merge pizzadao-org. This is a go-live switch for payees, so get Snax's explicit OK. `vercel-deploy --prod`
   if it doesn't auto-deploy. Repeat the header curl and Snax's steps 1-7 with a fresh test request on
   `app.pizzadao.org`.
4. Optional follow-up rsv-pizza PR, after Snax OKs it: in
   `frontend/src/components/payments-admin/TaxFormRequestsSection.tsx`, `linkFor` currently uses
   `window.location.origin`. Make it emit `https://app.pizzadao.org/tax-form?payee=` (env
   `VITE_TAX_FORM_LINK_BASE`) so newly copied and CSV links point to the native page.
   `rsv.pizza/tax-form` keeps working as a fallback; do not redirect or remove it.
5. `/task done tax-form-native <pr#>`. Also close `tax-form-redirect` (still `review` in TASKS.md;
   #165 merged 2026-10-18), which this PR supersedes.
