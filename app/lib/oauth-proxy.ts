import { createHmac } from "crypto";

const PRODUCTION_ORIGIN = "https://pizzadao.org";

const ALLOWED_RETURN_PATTERNS = [
  /^https:\/\/[\w.-]+-pizza-dao\.vercel\.app$/,
  /^https:\/\/[\w.-]+\.vercel\.app$/,
  /^http:\/\/localhost:\d+$/,
];

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
    const origin = parsed.origin;
    return ALLOWED_RETURN_PATTERNS.some((pattern) => pattern.test(origin));
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

export function encodeOAuthState(sessionId: string, returnTo?: string): string {
  if (!returnTo) return sessionId;
  return Buffer.from(
    JSON.stringify({ sessionId, return_to: returnTo })
  ).toString("base64url");
}

export function decodeOAuthState(state: string): { sessionId: string; return_to?: string } {
  if (!state) return { sessionId: "" };
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf-8")
    );
    if (decoded.sessionId !== undefined) return decoded;
  } catch {
    // Not base64url JSON - plain sessionId (backward compat)
  }
  return { sessionId: state };
}
