// app/lib/x-oauth.ts
// PKCE, token encryption, and state signing utilities for X (Twitter) OAuth 2.0

import { createHash, randomBytes, createCipheriv, createDecipheriv, createHmac } from "crypto";

// ===== PKCE =====

export function generateCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ===== Token Encryption (AES-256-GCM) =====

function getEncryptionKey(): Buffer {
  const secret = process.env.SESSION_SECRET!;
  return createHash("sha256").update(secret).digest();
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64url");
}

export function decryptToken(ciphertext: string): string {
  const key = getEncryptionKey();
  const data = Buffer.from(ciphertext, "base64url");
  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

// ===== State Signing for CSRF Protection =====

export function signXState(payload: { discordId: string; memberId?: string }): string {
  const secret = process.env.SESSION_SECRET!;
  const data = JSON.stringify({ ...payload, ts: Date.now() });
  const encoded = Buffer.from(data).toString("base64url");
  const sig = createHmac("sha256", secret).update("x-oauth:" + encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyXState(state: string): { discordId: string; memberId?: string } | null {
  const secret = process.env.SESSION_SECRET!;
  const dotIdx = state.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const encoded = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = createHmac("sha256", secret).update("x-oauth:" + encoded).digest("base64url");

  if (sig.length !== expected.length) return null;
  let mismatch = 0;
  for (let i = 0; i < sig.length; i++) {
    mismatch |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const data = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    // Expire after 10 minutes
    if (Date.now() - data.ts > 10 * 60 * 1000) return null;
    return { discordId: data.discordId, memberId: data.memberId };
  } catch {
    return null;
  }
}
