#!/usr/bin/env node
/**
 * Register (or inspect) the Telegram webhook for the login bot. Run ONCE, against production only:
 * a bot has a single webhook, so a preview or local URL would steal the production traffic.
 *
 *   node scripts/telegram-set-webhook.mjs https://app.pizzadao.org/api/telegram/webhook        # dry run
 *   node scripts/telegram-set-webhook.mjs https://app.pizzadao.org/api/telegram/webhook --apply
 *   node scripts/telegram-set-webhook.mjs --info                                              # getWebhookInfo
 *
 * Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment (from a vercel env pull
 * kept OUTSIDE the repo). Never prints either. Refuses any URL that is not https on the production
 * host (PRODUCTION_HOST, default app.pizzadao.org) or that is a *.vercel.app preview.
 * Follow-ups are private chats, so BotFather's group privacy mode does not matter for them.
 */
const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const prodHost = (process.env.PRODUCTION_HOST || "app.pizzadao.org").trim();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const info = args.includes("--info");
const url = args.find((a) => /^https?:\/\//.test(a));

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is not set.");
  process.exit(1);
}

async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method} failed: ${json.description || res.status}`);
  return json.result;
}

if (info) {
  const r = await call("getWebhookInfo");
  // Only fields that are safe to show (no secret, no token).
  console.log(
    JSON.stringify(
      {
        url: r.url,
        pending_update_count: r.pending_update_count,
        last_error_date: r.last_error_date,
        last_error_message: r.last_error_message,
        allowed_updates: r.allowed_updates,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (!url) {
  console.error("Usage: node scripts/telegram-set-webhook.mjs <https url> [--apply] | --info");
  process.exit(1);
}
const u = new URL(url);
if (u.protocol !== "https:" || u.host !== prodHost || u.host.endsWith(".vercel.app") || u.pathname !== "/api/telegram/webhook") {
  console.error(`Refusing: the webhook must be https://${prodHost}/api/telegram/webhook (production only).`);
  process.exit(1);
}
if (!secret || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
  console.error("TELEGRAM_WEBHOOK_SECRET must be set (1-256 chars of A-Z a-z 0-9 _ -).");
  process.exit(1);
}
const body = {
  url: u.toString(),
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "my_chat_member"],
  drop_pending_updates: false,
};
if (!apply) {
  console.log(`Dry run. Would set the webhook to ${body.url} with allowed_updates ${body.allowed_updates.join(", ")}. Add --apply to do it.`);
  process.exit(0);
}
await call("setWebhook", body);
console.log("Webhook set. Check it with: node scripts/telegram-set-webhook.mjs --info");
