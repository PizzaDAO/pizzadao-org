import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// The canonical production app. Preview deployments bounce Discord OAuth
// through here (Discord only allows fixed redirect URIs). Note: the bare
// pizzadao.org apex is the separate marketing site, not this app.
const PRODUCTION_ORIGIN = "https://app.pizzadao.org";

// Where the production callback may send a transfer token / redirect:
// only this app's own preview deployments (Vercel project `onboarding` on the
// `pizza-dao` team, e.g. onboarding-abc123xyz-pizza-dao.vercel.app or
// onboarding-git-my-branch-pizza-dao.vercel.app) and production itself.
// The preview host must be a single DNS label under vercel.app.
const ALLOWED_RETURN_PATTERNS = [
  /^https:\/\/onboarding-[a-z0-9-]+-pizza-dao\.vercel\.app$/,
  /^https:\/\/app\.pizzadao\.org$/,
];

// Local development only (never accepted in production builds).
const DEV_RETURN_PATTERNS = [/^http:\/\/localhost:\d+$/];

const TRANSFER_TOKEN_TTL_MS = 60_000;

export interface TransferPayload {
  discordId: string;
  username: string;
  nick: string;
  exp: number;
  origin: string;
}

export function isPreviewEnvironment(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

export function getProductionOrigin(): string {
  return PRODUCTION_ORIGIN;
}

export function validateReturnTo(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false;
    const origin = parsed.origin;
    const patterns =
      process.env.NODE_ENV === "production"
        ? ALLOWED_RETURN_PATTERNS
        : [...ALLOWED_RETURN_PATTERNS, ...DEV_RETURN_PATTERNS];
    return patterns.some((pattern) => pattern.test(origin));
  } catch {
    return false;
  }
}

function signTransfer(payload: string): string {
  const secret = process.env.SESSION_SECRET!;
  const hmac = createHmac("sha256", secret);
  hmac.update("transfer:" + payload);
  return hmac.digest("base64url");
}

export function createTransferToken(data: Omit<TransferPayload, "exp">): string {
  const payload = Buffer.from(
    JSON.stringify({ ...data, exp: Date.now() + TRANSFER_TOKEN_TTL_MS })
  ).toString("base64url");
  const signature = signTransfer(payload);
  return `${payload}.${signature}`;
}

export function verifyTransferToken(token: string): TransferPayload | null {
  if (!token) return null;
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const payload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const expected = signTransfer(payload);

  if (signature.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const decoded = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8")
    ) as TransferPayload;
    if (!decoded.discordId || !decoded.exp) return null;
    if (Date.now() > decoded.exp) return null;
    return decoded;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// OAuth `state` + login-CSRF nonce
// ---------------------------------------------------------------------------
//
// `state` is base64url(JSON) carrying:
//   - sessionId: the onboarding wizard's session id (opaque, may be "")
//   - return_to: preview origin for the OAuth proxy flow (optional)
//   - nonce:     random value that must match the httpOnly `oauth_state`
//                cookie set by /api/discord/login (login-CSRF protection)
//   - join:      true on the explicit "join the Discord" authorize request
//                (the one that asks for the guilds.join scope)
//
// In the preview proxy flow both /api/discord/login?return_to=... and the
// callback run on the production host, so the cookie is set and checked on
// the same origin.

export const OAUTH_STATE_COOKIE = "oauth_state";
export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export interface OAuthState {
  sessionId: string;
  return_to?: string;
  nonce?: string;
  join?: boolean;
}

export function generateOAuthNonce(): string {
  return randomBytes(24).toString("base64url");
}

export function oauthStateCookieOptions(req?: Request) {
  // Secure everywhere except plain-http local dev.
  const isHttp = req ? new URL(req.url).protocol === "http:" : false;
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || !isHttp,
    sameSite: "lax" as const,
    path: "/api/discord",
    maxAge: OAUTH_STATE_TTL_SECONDS,
  };
}

export function encodeOAuthState(state: OAuthState): string {
  const payload: OAuthState = { sessionId: state.sessionId || "" };
  if (state.return_to) payload.return_to = state.return_to;
  if (state.nonce) payload.nonce = state.nonce;
  if (state.join) payload.join = true;
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

export function decodeOAuthState(state: string): OAuthState {
  if (!state) return { sessionId: "" };
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64url").toString("utf-8"));
    if (decoded && typeof decoded === "object" && decoded.sessionId !== undefined) {
      return {
        sessionId: String(decoded.sessionId ?? ""),
        return_to: typeof decoded.return_to === "string" ? decoded.return_to : undefined,
        nonce: typeof decoded.nonce === "string" ? decoded.nonce : undefined,
        ...(decoded.join === true ? { join: true } : {}),
      };
    }
  } catch {
    // Not base64url JSON - plain sessionId (backward compat)
  }
  return { sessionId: state };
}

/** Read a single cookie value from a Request's Cookie header. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() !== name) continue;
    const raw = part.slice(idx + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

/** True if the state's nonce matches the oauth_state cookie (constant time). */
export function verifyOAuthNonce(
  cookieNonce: string | undefined,
  stateNonce: string | undefined,
): boolean {
  if (!cookieNonce || !stateNonce) return false;
  const a = Buffer.from(cookieNonce);
  const b = Buffer.from(stateNonce);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
