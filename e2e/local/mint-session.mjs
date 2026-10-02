// e2e/local/mint-session.mjs
//
// Mints signed `pizzadao_session` cookies for the synthetic test members using
// the app's own signer (createSessionToken in app/lib/session.ts), so the
// cookie format can never drift from what the server verifies.
//
//   SESSION_SECRET=... node e2e/local/mint-session.mjs <out.json>
import { registerHooks } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import fixtures from "./fixtures.cjs";

// app/lib/session.ts imports "next/headers", which has no ESM exports map.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "next/headers") specifier = "next/headers.js";
    return next(specifier, context);
  },
});

if (!process.env.SESSION_SECRET) {
  console.error("SESSION_SECRET is required");
  process.exit(1);
}

const { createSessionToken, COOKIE_NAME } = await import("../../app/lib/session.ts");

const out = process.argv[2];
if (!out) {
  console.error("usage: node e2e/local/mint-session.mjs <out.json>");
  process.exit(1);
}

const sessions = {};
for (const m of fixtures.MEMBERS) {
  sessions[m.memberId] = {
    memberId: m.memberId,
    discordId: m.discordId,
    cookieName: COOKIE_NAME,
    token: createSessionToken({
      discordId: m.discordId,
      username: m.username,
      nick: m.name,
      createdAt: Date.now(),
    }),
  };
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(sessions, null, 2));
console.log(`[e2e:local] minted ${Object.keys(sessions).length} session cookies -> ${out}`);
