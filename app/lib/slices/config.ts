// Call Slices config: env parsing, chain selection and link builders.
// Env var NAMES (values live in Vercel, never in the repo):
//   SLICES_ENABLED            kill switch; minting only runs when exactly "true" (default off)
//   SLICES_CONTRACT_ADDRESS   deployed CallSlices contract
//   SLICES_MINTER_PRIVATE_KEY hot key holding MINTER_ROLE only (Sensitive, Production)
//   BASE_RPC_URL              Base JSON-RPC endpoint
//   SLICES_CHAIN_ID           84532 selects Base Sepolia, but ONLY together with SLICES_ALLOW_NON_PROD=true
//                             (local testnet QA). Otherwise the chain is always Base (8453).
//   SLICES_DAILY_CAP          max mints per rolling 24h (default 1000)
//   SLICES_MAX_GAS_GWEI       skip a run while maxFeePerGas is above this (default 0.5)
//   SLICES_MIN_BALANCE_ETH    alert + pause below this minter balance (default 0.003)
//   SLICES_ALLOW_NON_PROD     "true" lets a NON-production deploy (local dev only!) mint. Vercel
//                             previews share the production DB, so they must never mint.
import { base, baseSepolia } from "viem/chains";
import type { Settings } from "@/app/lib/settings";
import { effectiveInt, storedOverride } from "@/app/lib/settings/numbers";

export const SLICES_BATCH_SIZE = 50;
export const SLICES_MAX_ATTEMPTS = 5;

export function slicesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SLICES_ENABLED?.trim() === "true";
}

export function sliceChain(env: NodeJS.ProcessEnv = process.env) {
  // A stray SLICES_CHAIN_ID (e.g. on a preview) must never move claims off the production chain.
  return env.SLICES_ALLOW_NON_PROD?.trim() === "true" && env.SLICES_CHAIN_ID?.trim() === "84532" ? baseSepolia : base;
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

// The three spend limits below are env-or-default (the legacy value) tightened by the settings
// slices.dailyCap / slices.maxGasMilliGwei / slices.minBalanceMilliEth. A saved setting can only make a
// limit stricter (lower cap, lower gas ceiling, higher balance floor); see settings/numbers.ts.
const optNumber = (raw: string | undefined): number | undefined => {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export const dailyCap = (env: NodeJS.ProcessEnv = process.env, settings?: Settings) => {
  const legacy = optNumber(env.SLICES_DAILY_CAP);
  return effectiveInt("slices.dailyCap", settings, legacy === undefined ? undefined : Math.floor(legacy));
};

// Gas and balance are decimals in env but whole thousandths in settings. With no saved row the env
// value is used untouched (no rounding), so deploying changes nothing.
export const maxGasGwei = (env: NodeJS.ProcessEnv = process.env, settings?: Settings) => {
  const legacy = optNumber(env.SLICES_MAX_GAS_GWEI) ?? 0.5;
  if (!storedOverride("slices.maxGasMilliGwei", settings)) return legacy;
  return effectiveInt("slices.maxGasMilliGwei", settings, Math.round(legacy * 1000)) / 1000;
};

/** Alert threshold in wei. */
export function minBalanceWei(env: NodeJS.ProcessEnv = process.env, settings?: Settings): bigint {
  const legacy = optNumber(env.SLICES_MIN_BALANCE_ETH) ?? 0.003;
  const eth = storedOverride("slices.minBalanceMilliEth", settings)
    ? effectiveInt("slices.minBalanceMilliEth", settings, Math.round(legacy * 1000)) / 1000
    : legacy;
  return BigInt(Math.round(eth * 1e9)) * BigInt(1_000_000_000);
}

export type SlicesStatus = { ok: true } | { ok: false; reason: "disabled" | "misconfigured" | "not_production" };

/** Whether the minter can run at all (kill switch + required env present). */
export function slicesReady(env: NodeJS.ProcessEnv = process.env): SlicesStatus {
  if (!slicesEnabled(env)) return { ok: false, reason: "disabled" };
  // Previews share the production database: a preview minting would drain the real queue.
  if (env.VERCEL_ENV !== "production" && env.SLICES_ALLOW_NON_PROD?.trim() !== "true") {
    return { ok: false, reason: "not_production" };
  }
  if (!contractAddress(env) || !env.SLICES_MINTER_PRIVATE_KEY?.trim() || !env.BASE_RPC_URL?.trim()) {
    return { ok: false, reason: "misconfigured" };
  }
  return { ok: true };
}

/** Prisma filter for "claims on the current chain". Rows with a NULL chainId predate stamping and belong to Base. */
export function chainWhere(env: NodeJS.ProcessEnv = process.env): { OR: ({ chainId: number } | { chainId: null })[] } {
  const id = sliceChain(env).id;
  return { OR: id === base.id ? [{ chainId: id }, { chainId: null }] : [{ chainId: id }] };
}

/** Fee plan: 2x base fee + tip, never above ceiling/1.3. null when even base + tip exceeds that. */
export function planFees(baseFee: bigint, priority: bigint, ceilingGwei: number): { maxFee: bigint; priority: bigint } | null {
  // First sends stay at or below ceiling/1.3 so a +30% replacement bump always fits under the ceiling.
  const ceiling = (BigInt(Math.floor(ceilingGwei * 1e9)) * BigInt(100)) / BigInt(130);
  if (baseFee + priority > ceiling) return null;
  const want = baseFee * BigInt(2) + priority;
  return { maxFee: want > ceiling ? ceiling : want, priority };
}

export const txUrl = (hash: string, env: NodeJS.ProcessEnv = process.env) => `${explorerBase(env)}/tx/${hash}`;
export const addressUrl = (addr: string, env: NodeJS.ProcessEnv = process.env) => `${explorerBase(env)}/address/${addr}`;

export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.pizzadao.org").replace(/\/+$/, "");
}
