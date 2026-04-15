import { randomBytes, createHash } from "crypto";
import { prisma } from "./db";
import { searchGuildMembers, sendDM } from "./discord";

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 3;

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export type MagicLoginResult =
  | { status: "sent" }
  | { status: "not_found" }
  | { status: "dm_failed"; error: string }
  | { status: "rate_limited" };

export async function requestMagicLogin(
  username: string,
  origin: string,
): Promise<MagicLoginResult> {
  // Search guild for exact username match
  const members = await searchGuildMembers(username, 5);
  const match = members.find(
    (m) => m.user.username.toLowerCase() === username.toLowerCase(),
  );

  if (!match) return { status: "not_found" };

  const discordId = match.user.id;
  const nick = match.nick || match.user.global_name || match.user.username;

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
      discordId,
      username: match.user.username,
      nick,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  // DM the user
  const loginUrl = `${origin}/api/auth/magic-login?token=${rawToken}`;
  const message = [
    "**PizzaDAO Login Link**",
    "",
    `Click to log in: ${loginUrl}`,
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

  return { status: "sent" };
}

export type VerifyResult =
  | { valid: true; discordId: string; username: string; nick: string | null }
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
    where: { tokenHash, usedAt: null },
    data: { usedAt: new Date() },
  });

  if (result.count === 0) return { valid: false, reason: "used" };

  return {
    valid: true,
    discordId: token.discordId,
    username: token.username,
    nick: token.nick,
  };
}
