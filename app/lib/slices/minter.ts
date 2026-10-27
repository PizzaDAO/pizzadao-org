// Server-side viem minter for Call Slices. SERVER ONLY: this is the only module
// that touches SLICES_MINTER_PRIVATE_KEY. It never logs the key, and errors are
// scrubbed (scrubError) before they are stored or posted anywhere.
import { createPublicClient, createWalletClient, http, keccak256, parseAbi, stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { contractAddress, sliceChain } from "./config";

export const CALL_SLICES_ABI = parseAbi([
  "function mintMany(address[] to, uint256[] ids, bytes32[] claimKeys) returns (uint256 minted)",
  "function claimUsed(bytes32) view returns (bool)",
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

/** Current max fee per gas (wei) the network wants. */
export async function getMaxFeePerGas(): Promise<bigint> {
  const fees = await publicClient().estimateFeesPerGas();
  return fees.maxFeePerGas ?? (await publicClient().getGasPrice());
}

export async function sendMintMany(
  batch: { to: `0x${string}`; id: number; key: Hex }[],
  maxFeePerGas: bigint,
): Promise<Hex> {
  const acct = account();
  const chain = sliceChain();
  const wallet = createWalletClient({ account: acct, chain, transport: http(rpcUrl()) });
  return wallet.writeContract({
    address: contract(),
    abi: CALL_SLICES_ABI,
    functionName: "mintMany",
    args: [batch.map((b) => b.to), batch.map((b) => BigInt(b.id)), batch.map((b) => b.key)],
    maxFeePerGas,
    maxPriorityFeePerGas: maxFeePerGas < PRIORITY_FEE ? maxFeePerGas : PRIORITY_FEE,
  });
}

export async function getReceiptState(hash: Hex): Promise<ReceiptState> {
  try {
    const r = await publicClient().getTransactionReceipt({ hash });
    return r.status === "success" ? "success" : "reverted";
  } catch {
    return "pending"; // TransactionReceiptNotFoundError
  }
}

/** Wait up to `timeoutMs` for the receipt; "pending" if it did not land in time. */
export async function waitForReceipt(hash: Hex, timeoutMs = 30_000): Promise<{ state: ReceiptState; blockNumber?: bigint }> {
  try {
    const r = await publicClient().waitForTransactionReceipt({ hash, timeout: timeoutMs });
    return { state: r.status === "success" ? "success" : "reverted", blockNumber: r.blockNumber };
  } catch {
    return { state: "pending" };
  }
}

export async function isClaimUsed(key: Hex): Promise<boolean> {
  return publicClient().readContract({ address: contract(), abi: CALL_SLICES_ABI, functionName: "claimUsed", args: [key] });
}
