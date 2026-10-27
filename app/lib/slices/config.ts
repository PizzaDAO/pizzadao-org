// Call Slices config: env parsing, chain selection and link builders.
// Env var NAMES (values live in Vercel, never in the repo):
//   SLICES_ENABLED            kill switch; minting only runs when exactly "true" (default off)
//   SLICES_CONTRACT_ADDRESS   deployed CallSlices contract
//   SLICES_MINTER_PRIVATE_KEY hot key holding MINTER_ROLE only (Sensitive, Production)
//   BASE_RPC_URL              Base JSON-RPC endpoint
//   SLICES_CHAIN_ID           8453 (Base, default) or 84532 (Base Sepolia, for Preview)
//   SLICES_DAILY_CAP          max mints per rolling 24h (default 1000)
//   SLICES_MAX_GAS_GWEI       skip a run while maxFeePerGas is above this (default 0.5)
//   SLICES_MIN_BALANCE_ETH    alert + pause below this minter balance (default 0.003)
import { base, baseSepolia } from "viem/chains";

export const SLICES_BATCH_SIZE = 50;
export const SLICES_MAX_ATTEMPTS = 5;

export function slicesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SLICES_ENABLED?.trim() === "true";
}

export function sliceChain(env: NodeJS.ProcessEnv = process.env) {
  return env.SLICES_CHAIN_ID?.trim() === "84532" ? baseSepolia : base;
}

export function explorerBase(env: NodeJS.ProcessEnv = process.env): string {
  return sliceChain(env).id === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org";
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
export const isEvmAddress = (s: unknown): s is string => typeof s === "string" && ADDRESS_RE.test(s);

export function contractAddress(env: NodeJS.ProcessEnv = process.env): `0x${string}` | null {
  const a = env.SLICES_CONTRACT_ADDRESS?.trim();
  return a && isEvmAddress(a) ? (a as `0x${string}`) : null;
}

function posNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const dailyCap = (env: NodeJS.ProcessEnv = process.env) => Math.floor(posNumber(env.SLICES_DAILY_CAP, 1000));
export const maxGasGwei = (env: NodeJS.ProcessEnv = process.env) => posNumber(env.SLICES_MAX_GAS_GWEI, 0.5);

/** Alert threshold in wei. */
export function minBalanceWei(env: NodeJS.ProcessEnv = process.env): bigint {
  return BigInt(Math.round(posNumber(env.SLICES_MIN_BALANCE_ETH, 0.003) * 1e9)) * BigInt(1_000_000_000);
}

export type SlicesStatus = { ok: true } | { ok: false; reason: "disabled" | "misconfigured" };

/** Whether the minter can run at all (kill switch + required env present). */
export function slicesReady(env: NodeJS.ProcessEnv = process.env): SlicesStatus {
  if (!slicesEnabled(env)) return { ok: false, reason: "disabled" };
  if (!contractAddress(env) || !env.SLICES_MINTER_PRIVATE_KEY?.trim() || !env.BASE_RPC_URL?.trim()) {
    return { ok: false, reason: "misconfigured" };
  }
  return { ok: true };
}

export const txUrl = (hash: string, env: NodeJS.ProcessEnv = process.env) => `${explorerBase(env)}/tx/${hash}`;
export const addressUrl = (addr: string, env: NodeJS.ProcessEnv = process.env) => `${explorerBase(env)}/address/${addr}`;

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.pizzadao.org").replace(/\/+$/, "");
}
