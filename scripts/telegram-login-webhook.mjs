#!/usr/bin/env node
// Point OUR login bot's webhook at the app (used by "Link with the Telegram app").
//
//   node scripts/telegram-login-webhook.mjs            dry run: prints what it would do
//   node scripts/telegram-login-webhook.mjs --apply    setWebhook on the login bot (--force replaces a different existing URL)
//   node scripts/telegram-login-webhook.mjs --info     getWebhookInfo (url, pending count, last error only)
//
// Reads TELEGRAM_LOGIN_BOT_TOKEN, TELEGRAM_LOGIN_WEBHOOK_SECRET and NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME
// from the environment and never prints the first two. Refuses when the bot behind the token is not the
// configured login bot, so the shared rsv.pizza bot can never be pointed at this app.

const WEBHOOK_URL = "https://app.pizzadao.org/api/telegram/login-bot/webhook";

const token = process.env.TELEGRAM_LOGIN_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET?.trim();
const expected = process.env.NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME?.trim().replace(/^@/, "");
const apply = process.argv.includes("--apply");
const info = process.argv.includes("--info");
const force = process.argv.includes("--force");
const senderBot = process.env.NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME?.trim().replace(/^@/, "");

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

if (!token || !expected) fail("Set TELEGRAM_LOGIN_BOT_TOKEN and NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME.");
if (!info && !secret) fail("Set TELEGRAM_LOGIN_WEBHOOK_SECRET.");

async function call(method, body) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) fail(`${method} failed: ${json.description ?? res.status}`);
    return json.result;
}

const me = await call("getMe");
if (String(me.username ?? "").toLowerCase() !== expected.toLowerCase()) {
    fail(`Refusing: the token belongs to @${me.username}, not the login bot @${expected}.`);
}

if (senderBot && String(me.username ?? "").toLowerCase() === senderBot.toLowerCase()) {
    fail(`Refusing: @${me.username} is the shared sender bot, not the login bot.`);
}

if (info) {
    const w = await call("getWebhookInfo");
    console.log(JSON.stringify({ url: w.url, pending_update_count: w.pending_update_count, last_error_message: w.last_error_message ?? null }, null, 2));
} else if (!apply) {
    console.log(`Dry run. Would set the webhook of @${me.username} to ${WEBHOOK_URL}`);
    console.log("allowed_updates: [message, callback_query], drop_pending_updates: true, secret_token: (from env)");
    console.log("Re-run with --apply to do it.");
} else {
    const current = await call("getWebhookInfo");
    if (current.url && current.url !== WEBHOOK_URL && !force) {
        fail("Refusing: this bot already has a different webhook URL set. Check the bot, or re-run with --force.");
    }
    await call("setWebhook", {
        url: WEBHOOK_URL,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
    });
    console.log(`Webhook of @${me.username} set to ${WEBHOOK_URL}`);
}
