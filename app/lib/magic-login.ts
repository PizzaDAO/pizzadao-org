import { randomBytes, createHash } from "crypto";
import { prisma } from "./db";
import { searchGuildMembers, sendDM } from "./discord";
import { sanitizeSignupDraft, type SignupDraft } from "./signup-draft";
import { recordActivationLater as recordActivation } from "./activation";
import { loginReturnPath } from "./login-return";
import { realNick, TRAINEE_NICK } from "./trainee-nick";
import { sanitizeDisplayName } from "./display-name";

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 3;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type MagicLoginResult =
  | { status: "sent" }
  | { status: "not_found" }
  | { status: "ambiguous" }
  | { status: "lookup_failed" }
  | { status: "dm_failed"; error: string }
  | { status: "rate_limited" };

type SearchMember = Awaited<ReturnType<typeof searchGuildMembers>>[number];

/** Trim, drop a leading "@", collapse inner whitespace. */
export function normalizeLoginName(input: string): string {
  return input.trim().replace(/^@+/, "").replace(/\s+/g, " ").trim();
}

const SYMBOL_RUN = /[\p{Extended_Pictographic}\p{S}]/gu;
// ZWJ, variation selectors, combining enclosing keycap, skin-tone modifiers.
const EMOJI_GLUE = /[\u200D\uFE0F\u20E3\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * "Loose" form for comparing nicknames/display names: stylised letters folded
 * (Ⓢ -> s), emoji/symbols/skin tones/ZWJ/variation selectors/keycaps removed,
 * NFKC-folded, lowercased, whitespace collapsed. Returns "" when no
 * letter/number remains (such a name must never match).
 */
export function looseName(v?: string | null): string {
  if (!v) return "";
  const folded = v.replace(EMOJI_GLUE, "").replace(SYMBOL_RUN, (c) => {
    const n = c.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "");
    return /^[\p{L}\p{N}]$/u.test(n) ? n : " ";
  });
  return sanitizeDisplayName(folded).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Loose form of a member-chosen name; "" for the Pizza Trainee placeholder. */
const looseRealName = (v?: string | null): string => {
  const l = looseName(v);
  return l === looseName(TRAINEE_NICK) ? "" : l;
};


export type LoginMatch =
  | { kind: "match"; member: SearchMember }
  | { kind: "none" }
  | { kind: "ambiguous" };

/**
 * Exact username (case-insensitive) wins. Otherwise match the real server nick
 * (never the "Pizza Trainee" placeholder) or global display name; login only
 * when exactly one distinct member matches. Bots never match.
 */
export function pickLoginMember(members: SearchMember[], input: string, truncated = false): LoginMatch {
  const q = normalizeLoginName(input).toLowerCase();
  if (!q) return { kind: "none" };
  const humans = members.filter((m) => !m.user.bot);
  const distinct = (list: SearchMember[]) => [...new Map(list.map((m) => [m.user.id, m])).values()];

  const byUsername = distinct(humans.filter((m) => m.user.username.toLowerCase() === q));
  if (byUsername.length === 1) return { kind: "match", member: byUsername[0] };
  if (byUsername.length > 1) return { kind: "ambiguous" };

  const resolve = (list: SearchMember[]): LoginMatch | null => {
    if (list.length === 0) return null;
    // Search hit its limit: a unique nick/display-name hit may have a twin we never saw.
    if (truncated || list.length > 1) return { kind: "ambiguous" };
    return { kind: "match", member: list[0] };
  };

  // A name with no letters/digits (emoji-only) never matches by nick/display name.
  const lq = looseName(q);
  if (!lq) return { kind: "none" };

  // Pass 1: exact (normalized) nick / global name. Beats emoji twins ("Sam" vs "Sam 🍕").
  const norm = (v?: string | null) => (v ? v.trim().replace(/\s+/g, " ").toLowerCase() : "");
  const exact = resolve(
    distinct(humans.filter((m) => norm(realNick(m.nick)) === q || norm(m.user.global_name) === q)),
  );
  if (exact) return exact;

  // Pass 2: loose compare (emoji/symbols ignored) so "Enzo Pepperoni" matches
  // "Enzo Pepperoni 🍫". A name or input with no letters/digits left never matches.
  // Limitation: Discord's member search is a prefix search on the typed text, so
  // twins whose emoji/symbol is at the START of the name ("🍫 Enzo") are never
  // returned for "Enzo"; the DM may then go to the only prefix-visible match.
  const loose = resolve(
    distinct(humans.filter((m) => looseRealName(m.nick) === lq || looseRealName(m.user.global_name) === lq)),
  );
  if (loose) return loose;
  return { kind: "none" };
}

export async function requestMagicLogin(
  username: string,
  origin: string,
  options: { returnTo?: unknown; onboarding?: boolean; signupDraft?: unknown } = {},
): Promise<MagicLoginResult> {
  const draft = options.onboarding ? sanitizeSignupDraft(options.signupDraft) : null;
  // Discord's member search matches username/nickname prefixes. Members often
  // type their server nickname or display name, so fall back to those.
  const query = normalizeLoginName(username);
  if (query.length < 2) return { status: "not_found" };
  const limit = 100;
  let members: SearchMember[];
  try {
    members = await searchGuildMembers(query, limit);
  } catch (e) {
    console.error("Magic login member search failed:", e);
    return { status: "lookup_failed" };
  }
  const found = pickLoginMember(members, username, members.length >= limit);

  if (found.kind === "none") return { status: "not_found" };
  if (found.kind === "ambiguous") return { status: "ambiguous" };
  const match = found.member;

  const discordId = match.user.id;
  const nick = realNick(match.nick) || match.user.global_name || match.user.username;

  // Rate limit: max 3 requests per 15 min per Discord user
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const recentCount = await prisma.magicLoginToken.count({
    where: { discordId, createdAt: { gte: windowStart } },
  });
  if (recentCount >= RATE_LIMIT_MAX) return { status: "rate_limited" };

  // Generate 256-bit random token
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(rawToken);

  // Store hash in DB
  await prisma.magicLoginToken.create({
    data: {
      tokenHash,
      ...(draft ? { signupDraft: draft } : {}),
      discordId,
      username: match.user.username,
      nick,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  // DM the user
  const loginUrl = new URL("/api/auth/magic-login", origin);
  loginUrl.searchParams.set("token", rawToken);
  const returnTo = loginReturnPath(options.returnTo);
  if (returnTo) loginUrl.searchParams.set("returnTo", returnTo);
  if (options.onboarding) loginUrl.searchParams.set("onboarding", "1");
  const message = [
    "**PizzaDAO Login Link**",
    "",
    `Click to log in: <${loginUrl}>`,
    "",
    "This link expires in 10 minutes and can only be used once.",
    "If you didn't request this, you can ignore it.",
  ].join("\n");

  const dmResult = await sendDM(discordId, message);

  if (!dmResult.success) {
    // Clean up the token since we couldn't deliver it
    await prisma.magicLoginToken.delete({ where: { tokenHash } });
    return { status: "dm_failed", error: dmResult.error || "unknown" };
  }

  // Lazy cleanup: 5% of requests delete old tokens
  if (Math.random() < 0.05) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    prisma.magicLoginToken
      .deleteMany({ where: { createdAt: { lt: oneHourAgo } } })
      .catch(() => {});
  }

  recordActivation("dm_sent", { actor: draft?.sessionId, discordId });
  return { status: "sent" };
}

export type VerifyResult =
  | { valid: true; discordId: string; username: string; nick: string | null; draft?: SignupDraft; tokenHash?: string }
  | { valid: false; reason: "invalid" | "expired" | "used" };

export async function verifyMagicToken(rawToken: string): Promise<VerifyResult> {
  const tokenHash = hashToken(rawToken);

  const token = await prisma.magicLoginToken.findUnique({
    where: { tokenHash },
  });

  if (!token) return { valid: false, reason: "invalid" };
  if (token.usedAt) return { valid: false, reason: "used" };
  if (token.expiresAt < new Date()) return { valid: false, reason: "expired" };

  // Atomic one-time use: only mark used if still unused (prevents race)
  const result = await prisma.magicLoginToken.updateMany({
    where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });

  if (result.count === 0) return { valid: false, reason: "used" };

  const draft = sanitizeSignupDraft(token.signupDraft);
  recordActivation("discord_verified", { actor: draft?.sessionId, discordId: token.discordId });
  return {
    valid: true,
    ...(draft ? { draft, tokenHash } : {}),
    discordId: token.discordId,
    username: token.username,
    nick: token.nick,
  };
}
