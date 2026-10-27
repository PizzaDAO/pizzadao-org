// @vitest-environment node
import { describe, it, expect } from "vitest";
import { chainWhere, planFees, addressUrl, contractAddress, dailyCap, explorerBase, maxGasGwei, minBalanceWei, sliceChain, slicesEnabled, slicesReady, txUrl } from "./config";
import { claimKeyFor, scrubError } from "./minter";

const ADDR = "0x" + "ab".repeat(20);
const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("slices config", () => {
  it("is off unless SLICES_ENABLED is exactly true", () => {
    expect(slicesEnabled(env({}))).toBe(false);
    expect(slicesEnabled(env({ SLICES_ENABLED: "1" }))).toBe(false);
    expect(slicesEnabled(env({ SLICES_ENABLED: "true" }))).toBe(true);
  });

  it("slicesReady reports disabled, misconfigured, ok", () => {
    expect(slicesReady(env({}))).toEqual({ ok: false, reason: "disabled" });
    expect(slicesReady(env({ SLICES_ENABLED: "true", VERCEL_ENV: "production" }))).toEqual({ ok: false, reason: "misconfigured" });
    const full = { VERCEL_ENV: "production", SLICES_ENABLED: "true", SLICES_CONTRACT_ADDRESS: ADDR, SLICES_MINTER_PRIVATE_KEY: "k", BASE_RPC_URL: "https://rpc" };
    expect(slicesReady(env(full))).toEqual({ ok: true });
    expect(slicesReady(env({ ...full, SLICES_CONTRACT_ADDRESS: "nope" }))).toEqual({ ok: false, reason: "misconfigured" });
    // previews and local runs never mint unless explicitly overridden
    expect(slicesReady(env({ ...full, VERCEL_ENV: "preview" }))).toEqual({ ok: false, reason: "not_production" });
    expect(slicesReady(env({ ...full, VERCEL_ENV: "" }))).toEqual({ ok: false, reason: "not_production" });
    expect(slicesReady(env({ ...full, VERCEL_ENV: "preview", SLICES_ALLOW_NON_PROD: "true" }))).toEqual({ ok: true });
  });

  it("defaults and overrides for caps", () => {
    expect(dailyCap(env({}))).toBe(1000);
    expect(dailyCap(env({ SLICES_DAILY_CAP: "50" }))).toBe(50);
    expect(dailyCap(env({ SLICES_DAILY_CAP: "-3" }))).toBe(1000);
    expect(maxGasGwei(env({}))).toBe(0.5);
    expect(minBalanceWei(env({}))).toBe(BigInt("3000000000000000"));
    expect(minBalanceWei(env({ SLICES_MIN_BALANCE_ETH: "0.01" }))).toBe(BigInt("10000000000000000"));
  });

  it("picks Base by default and Base Sepolia on request, with matching explorer links", () => {
    expect(sliceChain(env({})).id).toBe(8453);
    expect(sliceChain(env({ SLICES_CHAIN_ID: "84532" })).id).toBe(8453); // ignored without the local override
    expect(sliceChain(env({ SLICES_CHAIN_ID: "84532", SLICES_ALLOW_NON_PROD: "true" })).id).toBe(84532);
    expect(explorerBase(env({}))).toBe("https://basescan.org");
    expect(txUrl("0x1", env({ SLICES_CHAIN_ID: "84532", SLICES_ALLOW_NON_PROD: "true" }))).toBe("https://sepolia.basescan.org/tx/0x1");
    expect(addressUrl(ADDR, env({}))).toBe(`https://basescan.org/address/${ADDR}`);
    expect(contractAddress(env({ SLICES_CONTRACT_ADDRESS: ADDR }))).toBe(ADDR);
  });
});

describe("claim key and error scrubbing", () => {
  it("claimKeyFor is deterministic, 32 bytes and unique per claim", () => {
    expect(claimKeyFor("abc")).toBe(claimKeyFor("abc"));
    expect(claimKeyFor("abc")).not.toBe(claimKeyFor("abd"));
    expect(claimKeyFor("abc")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("scrubError removes private keys and rpc urls", () => {
    const key = "0x" + "12".repeat(32);
    process.env.BASE_RPC_URL = "https://base.example.com/v2/SECRETKEY";
    const out = scrubError(new Error(`failed with ${key} at https://base.example.com/v2/SECRETKEY now`));
    delete process.env.BASE_RPC_URL;
    expect(out).not.toContain(key);
    expect(out).not.toContain("SECRETKEY");
  });
});

describe("planFees", () => {
  it("is 2x base + tip, capped at the ceiling, null when base + tip exceeds it", () => {
    expect(planFees(BigInt(6_000_000), BigInt(1_000_000), 0.5)).toEqual({ maxFee: BigInt(13_000_000), priority: BigInt(1_000_000) });
    // first sends are capped at ceiling/1.3 so a +30% replacement always fits
    expect(planFees(BigInt(300_000_000), BigInt(1_000_000), 0.5)?.maxFee).toBe(BigInt(384_615_384));
    expect(planFees(BigInt(400_000_000), BigInt(1_000_000), 0.5)).toBeNull();
  });
});

describe("chainWhere", () => {
  it("treats NULL chainId rows as the production chain only", () => {
    expect(chainWhere(env({}))).toEqual({ OR: [{ chainId: 8453 }, { chainId: null }] });
    expect(chainWhere(env({ SLICES_ALLOW_NON_PROD: "true", SLICES_CHAIN_ID: "84532" }))).toEqual({ OR: [{ chainId: 84532 }] });
  });
});
