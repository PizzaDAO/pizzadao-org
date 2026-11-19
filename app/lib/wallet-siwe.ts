// Wallet ownership verification (Sign-In With Ethereum, EIP-4361) for new EVM wallets.
//
// The nonce is stateless: memberId + discordId + random + expiry under an HMAC (SESSION_SECRET), so
// it can only be redeemed by the member it was issued to, and no database table is needed. Single
// use is enforced with a set-if-absent key in the shared KV store (cacheLock).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { createPublicClient, http, recoverMessageAddress, type Hex } from "viem";
import { mainnet, base, polygon, optimism, zora } from "viem/chains";
import { parseSiweMessage, verifySiweMessage } from "viem/siwe";
import { cacheLock } from "@/app/api/lib/cache";
import { ALLOWED_RETURN_PATTERNS } from "@/app/lib/oauth-proxy";
import { LEGACY_APP_HOST, SITE_HOST } from "@/app/lib/site-url";

export const NONCE_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
const NONCE_KEY_PREFIX = "wallet-nonce:";

/** Same chains the wallet connector offers (app/lib/wagmi-config.ts). */
export const SIWE_CHAINS = [mainnet, base, polygon, optimism, zora];

export type SiweFailure =
  | "bad_message"
  | "bad_domain"
  | "bad_uri"
  | "bad_chain"
  | "bad_address"
  | "bad_nonce"
  | "expired"
  | "bad_statement"
  | "bad_signature"
  | "nonce_used";

export class SiweError extends Error {
  constructor(public code: SiweFailure) {
    super(code);
  }
}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function mac(memberId: string, discordId: string, rand: string, exp: string): string {
  return createHmac("sha256", secret())
    .update(`wallet-nonce|${memberId}|${discordId}|${rand}|${exp}`)
    .digest("hex")
    .slice(0, 32);
}

/** 60 lowercase hex chars (a valid EIP-4361 nonce): 16 random + 12 expiry (hex ms) + 32 mac. */
export function issueWalletNonce(memberId: string, discordId: string, now = Date.now()): { nonce: string; expiresAt: number } {
  const rand = randomBytes(8).toString("hex");
  const expiresAt = now + NONCE_TTL_MS;
  const exp = expiresAt.toString(16).padStart(12, "0");
  return { nonce: rand + exp + mac(memberId, discordId, rand, exp), expiresAt };
}

/** Whether the nonce was issued to this member and is unexpired (does not consume it). */
export function checkWalletNonce(nonce: string, memberId: string, discordId: string, now = Date.now()): "ok" | "bad" | "expired" {
  if (!/^[0-9a-f]{60}$/.test(nonce)) return "bad";
  const rand = nonce.slice(0, 16);
  const exp = nonce.slice(16, 28);
  const given = Buffer.from(nonce.slice(28));
  const want = Buffer.from(mac(memberId, discordId, rand, exp));
  if (given.length !== want.length || !timingSafeEqual(given, want)) return "bad";
  return now >= parseInt(exp, 16) ? "expired" : "ok";
}

/** Spend a nonce. False when it was already used. */
export async function consumeNonce(nonce: string): Promise<boolean> {
  return (await cacheLock(NONCE_KEY_PREFIX + nonce, Math.ceil(NONCE_TTL_MS / 1000) + 120)) !== null;
}

/** Hosts a SIWE message may name: the production app hosts, plus this app's previews / localhost off production. */
export function isAllowedSiweDomain(domain: string, env: Record<string, string | undefined> = process.env): boolean {
  if (domain === SITE_HOST || domain === LEGACY_APP_HOST) return true;
  if (env.VERCEL_ENV !== "production") {
    if (ALLOWED_RETURN_PATTERNS.some((p) => p.test(`https://${domain}`))) return true;
    if (env.NODE_ENV !== "production" && /^localhost:\d+$/.test(domain)) return true;
  }
  return false;
}

export function walletStatement(memberId: string): string {
  return `Link this wallet to PizzaDAO member ${memberId}. This is free and sends no transaction.`;
}

type SiweClient = Parameters<typeof verifySiweMessage>[0];

function defaultClient(chainId: number): SiweClient {
  const chain = SIWE_CHAINS.find((c) => c.id === chainId);
  if (!chain) throw new SiweError("bad_chain");
  return createPublicClient({ chain, transport: http() }) as SiweClient;
}

export interface VerifyWalletSiweInput {
  message: string;
  signature: string;
  /** The address in the request body. */
  address: string;
  memberId: string;
  discordId: string;
  /** Host the request was made to (x-forwarded-host / host). */
  host: string;
  now?: number;
  /** Test seam: the viem client used for signature (EOA, EIP-1271, EIP-6492) verification. */
  getClient?: (chainId: number) => SiweClient;
}

/** Throws SiweError on any failure; resolves when the wallet proved ownership. Spends the nonce. */
export async function verifyWalletSiwe(input: VerifyWalletSiweInput): Promise<void> {
  const now = input.now ?? Date.now();
  const msg = parseSiweMessage(input.message);
  if (!msg.address || !msg.domain || !msg.uri || !msg.nonce || !msg.chainId || !msg.issuedAt) throw new SiweError("bad_message");
  if (msg.version !== "1") throw new SiweError("bad_message");
  for (const d of [msg.issuedAt, msg.expirationTime, msg.notBefore]) {
    if (d !== undefined && !Number.isFinite(d.getTime())) throw new SiweError("bad_message");
  }

  if (msg.domain !== input.host || !isAllowedSiweDomain(msg.domain)) throw new SiweError("bad_domain");
  let uriHost = "";
  try {
    uriHost = new URL(msg.uri).host;
  } catch {
    throw new SiweError("bad_uri");
  }
  if (uriHost !== msg.domain) throw new SiweError("bad_uri");

  if (!SIWE_CHAINS.some((c) => c.id === msg.chainId)) throw new SiweError("bad_chain");
  if (msg.address.toLowerCase() !== input.address.toLowerCase()) throw new SiweError("bad_address");
  if (!msg.statement || !msg.statement.includes(`member ${input.memberId}.`)) throw new SiweError("bad_statement");

  const issued = msg.issuedAt.getTime();
  if (issued > now + CLOCK_SKEW_MS || now - issued > NONCE_TTL_MS + CLOCK_SKEW_MS) throw new SiweError("expired");
  if (!msg.expirationTime || msg.expirationTime.getTime() <= now) throw new SiweError("expired");

  const nonceState = checkWalletNonce(msg.nonce, input.memberId, input.discordId, now);
  if (nonceState === "bad") throw new SiweError("bad_nonce");
  if (nonceState === "expired") throw new SiweError("expired");

  // The nonce is spent before any signature check: one nonce, one attempt, pass or fail.
  if (!(await consumeNonce(msg.nonce))) throw new SiweError("nonce_used");

  // EOA fast path: plain signature recovery, no RPC. Only contract wallets (EIP-1271 / 6492) need the
  // chain; viem's verifySiweMessage asks the RPC first even for EOAs, so it is only the fallback.
  let ok = false;
  try {
    const signer = await recoverMessageAddress({ message: input.message, signature: input.signature as Hex });
    ok = signer.toLowerCase() === input.address.toLowerCase();
  } catch {
    ok = false;
  }
  if (!ok) try {
    const client = (input.getClient ?? defaultClient)(msg.chainId);
    ok = await verifySiweMessage(client, {
      message: input.message,
      signature: input.signature as Hex,
      address: input.address as Hex,
      domain: msg.domain,
      nonce: msg.nonce,
      time: new Date(now),
    });
  } catch {
    ok = false;
  }
  if (!ok) throw new SiweError("bad_signature");
}

const MESSAGES: Record<SiweFailure, string> = {
  bad_message: "Invalid wallet signature message",
  bad_domain: "Signature was made for a different site",
  bad_uri: "Signature was made for a different site",
  bad_chain: "Unsupported network for this signature",
  bad_address: "Signature does not match this wallet address",
  bad_nonce: "Signature request is not valid; try again",
  expired: "Signature request expired; try again",
  bad_statement: "Signature was made for a different member",
  bad_signature: "Could not verify the wallet signature",
  nonce_used: "Signature request was already used; try again",
};

export function siweErrorMessage(code: SiweFailure): string {
  return MESSAGES[code];
}

/** Host the request was made to (the proxy's forwarded host first, as the admin guard does). */
export function requestHost(request: Request): string {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
}
