// Server-side viem minter for Call Slices. SERVER ONLY: this is the only module
// that touches SLICES_MINTER_PRIVATE_KEY. It never logs the key, and errors are
// scrubbed (scrubError) before they are stored or posted anywhere.
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, parseEventLogs, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contractAddress, sliceChain } from "./config";

export const CALL_SLICES_ABI = parseAbi([
  "function mintMany(address[] to, uint256[] ids, bytes32[] claimKeys) returns (uint256 minted)",
  "function claimUsed(bytes32) view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "event SliceMinted(address indexed to, uint256 indexed id, bytes32 indexed claimKey)",
]);

/** On-chain idempotency key for a claim row. */
export function claimKeyFor(claimId: string): Hex {
  return keccak256(stringToHex(`callslice:${claimId}`));
}

const PRIORITY_FEE = BigInt(1_000_000); // 0.001 gwei tip is plenty on Base

export type ReceiptState = "success" | "reverted" | "pending";

function rpcUrl(): string {
  const url = process.env.BASE_RPC_URL?.trim();
  if (!url) throw new Error("BASE_RPC_URL is not set");
  return url;
}

function publicClient() {
  return createPublicClient({ chain: sliceChain(), transport: http(rpcUrl()) });
}

function account() {
  const raw = process.env.SLICES_MINTER_PRIVATE_KEY?.trim();
  if (!raw) throw new Error("SLICES_MINTER_PRIVATE_KEY is not set");
  return privateKeyToAccount((raw.startsWith("0x") ? raw : `0x${raw}`) as Hex);
}

function contract(): `0x${string}` {
  const a = contractAddress();
  if (!a) throw new Error("SLICES_CONTRACT_ADDRESS is not set");
  return a;
}

/** Remove anything that looks like a private key or the RPC url from an error message. */
export function scrubError(e: unknown): string {
  let msg = e instanceof Error ? e.message : String(e);
  msg = msg.replace(/0x[0-9a-fA-F]{64}/g, "[redacted]");
  const rpc = process.env.BASE_RPC_URL?.trim();
  if (rpc) msg = msg.split(rpc).join("[rpc]");
  return msg.replace(/https?:\/\/[^\s)]*(alchemy|infura|quiknode|ankr)[^\s)]*/gi, "[rpc]").slice(0, 500);
}

export function minterAddress(): `0x${string}` {
  return account().address;
}

export async function getMinterBalance(): Promise<bigint> {
  return publicClient().getBalance({ address: account().address });
}

/** Latest block base fee and the tip we pay (wei). */
export async function getFeeQuote(): Promise<{ baseFee: bigint; priority: bigint }> {
  const block = await publicClient().getBlock();
  return { baseFee: block.baseFeePerGas ?? (await publicClient().getGasPrice()), priority: PRIORITY_FEE };
}

export async function sendMintMany(
  batch: { to: `0x${string}`; id: number; key: Hex }[],
  fees: { maxFee: bigint; priority: bigint },
): Promise<Hex> {
  const wallet = createWalletClient({ account: account(), chain: sliceChain(), transport: http(rpcUrl()) });
  return wallet.writeContract({
    address: contract(),
    abi: CALL_SLICES_ABI,
    functionName: "mintMany",
    args: [batch.map((b) => b.to), batch.map((b) => BigInt(b.id)), batch.map((b) => b.key)],
    maxFeePerGas: fees.maxFee,
    maxPriorityFeePerGas: fees.priority < fees.maxFee ? fees.priority : fees.maxFee,
  });
}

export type ReplaceResult = { kind: "replaced"; hash: Hex } | { kind: "still_pending" } | { kind: "gone" };

/**
 * Deal with a tx that has no receipt after the stuck window.
 * - replaced: it is pending in the mempool; the identical call data was resent at the SAME nonce with a
 *   bumped fee (+30%, never above `ceilingMaxFee`).
 * - still_pending: we cannot tell it is gone (still pending but a bump would exceed the ceiling, or the
 *   node simply does not know it while other minter txs are pending). Leave it alone.
 * - gone: clearly dropped (the node does not know it and the minter has nothing pending, or its nonce was
 *   already used by another tx). Safe to requeue.
 */
export async function replaceStuckTx(hash: Hex, ceilingMaxFee: bigint): Promise<ReplaceResult> {
  const pc = publicClient();
  const me = account().address;
  const tx = await pc.getTransaction({ hash }).catch(() => null);
  const [latest, pending] = await Promise.all([
    pc.getTransactionCount({ address: me, blockTag: "latest" }),
    pc.getTransactionCount({ address: me, blockTag: "pending" }),
  ]);
  if (!tx) return pending <= latest ? { kind: "gone" } : { kind: "still_pending" };
  if (tx.blockNumber) return { kind: "still_pending" }; // mined: the receipt shows up on the next run
  if (tx.nonce < latest) return { kind: "gone" }; // the nonce was consumed by a different tx
  if (!(pending > latest)) return { kind: "still_pending" };
  const oldMax = tx.maxFeePerGas ?? tx.gasPrice ?? BigInt(0);
  const bumped = (oldMax * BigInt(130)) / BigInt(100) + BigInt(1);
  if (bumped > ceilingMaxFee) return { kind: "still_pending" };
  const oldTip = tx.maxPriorityFeePerGas ?? PRIORITY_FEE;
  const tip = (oldTip * BigInt(130)) / BigInt(100) + BigInt(1);
  const wallet = createWalletClient({ account: account(), chain: sliceChain(), transport: http(rpcUrl()) });
  const newHash = await wallet.sendTransaction({
    to: tx.to!,
    data: tx.input,
    nonce: tx.nonce,
    maxFeePerGas: bumped,
    maxPriorityFeePerGas: tip < bumped ? tip : bumped,
    gas: tx.gas,
  });
  return { kind: "replaced", hash: newHash };
}

const MINTER_ROLE = keccak256(stringToHex("MINTER_ROLE"));

/** Shared failure causes (as opposed to a bad row): contract missing at the address, or minter lost its role. */
export async function checkMinterSetup(): Promise<{ ok: true } | { ok: false; problem: string }> {
  try {
    const pc = publicClient();
    const code = await pc.getCode({ address: contract() });
    if (!code || code === "0x") return { ok: false, problem: "no contract code at SLICES_CONTRACT_ADDRESS" };
    const has = await pc.readContract({ address: contract(), abi: CALL_SLICES_ABI, functionName: "hasRole", args: [MINTER_ROLE, account().address] });
    if (!has) return { ok: false, problem: "minter address does not hold MINTER_ROLE" };
    return { ok: true };
  } catch (e) {
    return { ok: false, problem: `setup check failed: ${scrubError(e)}` };
  }
}

export async function getBalanceOf(owner: `0x${string}`, id: number): Promise<bigint> {
  return publicClient().readContract({ address: contract(), abi: CALL_SLICES_ABI, functionName: "balanceOf", args: [owner, BigInt(id)] });
}

export type ReceiptInfo = { state: ReceiptState; blockNumber?: bigint; mintedKeys?: Set<string> };

function toInfo(r: { status: string; blockNumber: bigint; logs: readonly { data: Hex; topics: readonly Hex[]; address: string }[] }): ReceiptInfo {
  const keys = new Set<string>();
  const target = contractAddress()?.toLowerCase();
  for (const log of r.logs) {
    if (log.address.toLowerCase() !== target) continue;
    try {
      const ev = parseEventLogs({ abi: CALL_SLICES_ABI, eventName: "SliceMinted", logs: [log as never] });
      for (const e of ev) keys.add(String((e as { args: { claimKey: string } }).args.claimKey).toLowerCase());
    } catch {
      // not a SliceMinted log
    }
  }
  return { state: r.status === "success" ? "success" : "reverted", blockNumber: r.blockNumber, mintedKeys: keys };
}

export async function getReceiptInfo(hash: Hex): Promise<ReceiptInfo> {
  try {
    return toInfo(await publicClient().getTransactionReceipt({ hash }));
  } catch {
    return { state: "pending" }; // TransactionReceiptNotFoundError
  }
}

/** Wait up to `timeoutMs` for the receipt; "pending" if it did not land in time. */
export async function waitForReceipt(hash: Hex, timeoutMs = 30_000): Promise<ReceiptInfo> {
  try {
    return toInfo(await publicClient().waitForTransactionReceipt({ hash, timeout: timeoutMs }));
  } catch {
    return { state: "pending" };
  }
}

export async function isClaimUsed(key: Hex): Promise<boolean> {
  return publicClient().readContract({ address: contract(), abi: CALL_SLICES_ABI, functionName: "claimUsed", args: [key] });
}
