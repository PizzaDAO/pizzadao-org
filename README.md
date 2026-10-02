This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Logged-in E2E smoke test (fully local)

```bash
npm run e2e:local            # needs Docker running
npm run e2e:local -- --serve # same setup, but just serve http://localhost:3100 for manual poking
```

`e2e/local/run.mjs` starts a throwaway Postgres in Docker (tmpfs, port 54329), creates the
schema with `prisma db push`, seeds two synthetic members (`990001` with an incomplete profile,
`990002` with a complete one), mints their `pizzadao_session` cookies with the app's own
`createSessionToken`, and runs `e2e/logged-in.local.spec.ts` at 1280px and 390px against
`next dev` on port 3100. Screenshots land in `e2e/.local/shots/` (override with `E2E_SHOTS_DIR`).

Nothing touches production. The run uses only dummy and local env values, and it refuses to
start if a real `.env`/`.env.local` exists. Google ADC is disabled. `e2e/local/preload.cjs`
routes the Neon driver to the local Postgres, serves the members sheet as the public GViz
data plus the synthetic rows, and blocks Discord and every non-GET request to external hosts.
Blocked calls are listed at the end of the run. Other options: `E2E_DATABASE_URL`
(an existing localhost Postgres with password auth), `E2E_KEEP_DB=1`, `E2E_PORT`, `E2E_PG_PORT`.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
