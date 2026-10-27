# Call attendance NFTs (replace POAP mint links)

Status: plan. Follows PR #192 (POAP claims). Owner: Snax. Working name: **Pizza Stamps** (decision D5).

## Goal

Members who attended a crew call (a `CallAttendance` row) can claim an NFT for that call. It's PizzaDAO's own contract, because POAP stopped its protocol. Claiming stays **deliberate**: the member opens the app and clicks Claim. Then the server mints to the member's linked wallet, and PizzaDAO pays the gas. This replaces the admin-pasted `PoapMintLink` pool. The pool approach can't scale anyway: someone has to paste N links per call, per crew.

Non-goals: auto-minting to everyone (that's task `parmesan-10386`; Snax now wants claim-to-engage), mirroring Discord-channel attendance, Solana.

---

## What exists today (investigated)

**This repo (pizzadao-org)**
- `app/lib/poap-claims.ts`, `app/api/poap-claims/route.ts`, `app/api/admin/poaps/route.ts`, `app/admin/poaps/{page,AdminPoapsClient}.tsx`, `app/ui/poap/PoapClaims.tsx` (`PoapClaimsList` on `/poaps`, `PoapClaimsCard` on `app/dashboard/[id]/page.tsx:272`), and `app/calls/how-to-attend/page.tsx:87-90`. The i18n namespace is `poapClaims` plus `howToAttend.poap*` in `messages/{en,es,fr}.json`. There's also the `poap_claimed` activation event in `app/lib/activation.ts`, and tests in `app/lib/poap-claims.test.ts`.
- `PoapMintLink` (migration `20261029200000_poap_mint_links`) uses a `(crewId, callDay)` key, with callDay as a UTC `@db.Date`. Gating is `CallAttendance` (discordId, crewId, callDate). That table is synced daily by `/api/cron/attendance` (05:00 UTC), so a call becomes claimable the morning after.
- Wallets: `MemberWallet` (memberId, discordId?, walletAddress, chainType evm|solana, isPrimary) plus the members-sheet fallback in `app/lib/wallet-lookup.ts` (`getWalletForMember`, `getEvmWalletsReadOnly`). Linking happens in `/me/wallets` (RainbowKit connect **or a manually typed address, with no signature check**). Writes go through `app/api/wallet/route.ts`.
- Web3 deps: `viem ^2.44`, `wagmi`, `@rainbow-me/rainbowkit` (chains: mainnet, base, polygon, optimism, zora), `@vercel/blob`. **No server-side signing anywhere in this repo.** There is no minter key, no contract source, and no foundry/hardhat.
- Reading NFTs: `app/lib/nft.ts` + `app/lib/nft-config.ts` use the Alchemy NFT API v3 (`ALCHEMY_API_KEY`) on ethereum/base/polygon/zora/optimism. The contract list comes from the public "NFT contracts" Google Sheet (`NFT_CONTRACTS_SHEET_ID`), which feeds `/nfts`, profile `NFTCollection`, mafia points (`app/lib/mafia-points/config.ts`), and the Rare Pizza Box verifier.
- POAP display: `app/lib/poap.ts`, `/api/poaps/[memberId]` (POAP API), `POAPCollection`/`POAPCard`, and the `/poaps` whitelist page. `PoapFirstSeen` records first observation for the activity feed (`poap_received` in `app/api/activity/[memberId]/route.ts`).
- Existing env var names (no values read): `ALCHEMY_API_KEY`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `DATABASE_URL`, Upstash rate-limit vars (`app/lib/rate-limit.ts`), `GOOGLE_SHEETS_SHARED_SECRET`.

**Where PizzaDAO assets live** (from the contracts sheet)
- Ethereum: Rare Pizzas `0xe661…35f0`, Rare Pizza Box `0x4ae5…52c7`, Molto Benny Edition, Eric John pieces.
- Base: Pizza Board, Molto Benny Pizza, "Base Pizza" / Zora / partner rows.
- Optimism: Pizza Sticks. Polygon + Optimism: Pizza Pop.
- $PEP is an **off-chain** in-app ledger (`app/lib/economy.ts`), not a token.

**Sibling repo: rsv-pizza already mints attendance NFTs on Base**
- `rsv-pizza/contracts/RSVPizzaNFT.sol`: ERC721 + Ownable, `mintOrUpdate(to, eventId, uri)`, `hasToken`, on-chain dedupe per (address, eventId). Deployed through Remix.
- `rsv-pizza/supabase/functions/mint-nft/index.ts`: a viem `privateKeyToAccount(MINTER_PRIVATE_KEY)` server mint on Base (`BASE_NFT_CONTRACT_ADDRESS`, `BASE_RPC_URL`), with Monad as a second chain. It checks `hasToken` before minting. Metadata is served dynamically from `backend-pizza-dao.vercel.app/api/nft/metadata/:partyId/:address`.
- `rsv-pizza/plans/backfill-nft-mints.md` is a backfill script pattern.
- So PizzaDAO already runs a "server pays gas, mint on Base, dynamic metadata" setup. We copy the pattern, not the key.
- `zaave` targets Base. Foundry (`forge`/`cast`) is installed on Snax's machine (`~/.foundry/bin`).

---

## Recommended design

### 1. One ERC-1155 contract, one token id per call

- **Token id = DB id of an `AttendanceNftCall` row** (one per `(crewId, callDay)`), assigned sequentially: 1, 2, 3, …
  - Small readable ids, and no on-chain registry step is needed.
  - Rejected: `keccak(crewId|day)` gives unreadable ids. A Solidity-side `createCall()` costs an extra tx per call.
- `uri(id)` returns `baseURI + id` (decimal). The base is `https://app.pizzadao.org/api/stamps/metadata/` and is admin-settable, so it can later be re-pointed at an IPFS folder ("freeze").
- An `AttendanceNftCall` row is created lazily: on the first claim for that call, or when an admin sets art. The tokenId exists before the mint.

### 2. Claim flow = server mint, PizzaDAO pays gas, through a DB queue

```
Member clicks Claim ─▶ POST /api/stamps/claim {crewId, callDay}
   ├─ gate: session + CallAttendance row (same as today) + rate limit
   ├─ upsert AttendanceNftCall(crewId, callDay) → tokenId
   ├─ insert AttendanceNftClaim (unique discordId+callId) status=QUEUED | AWAITING_WALLET
   ├─ recordActivationLater("stamp_claimed")
   └─ after(() => processMintQueue())     ← usually mints within ~5 s
UI polls GET /api/stamps every 3 s (max ~45 s) → "Baking…" → "Minted ✓ (BaseScan / OpenSea)"
Cron /api/cron/stamps every 5 min → processMintQueue() + reconcile SUBMITTED + promote AWAITING_WALLET
```

**`processMintQueue()`** (new file `app/lib/stamps/mint-queue.ts`):
1. Take the single **minter lease** row, `MintLease` (`UPDATE … SET holder=$uuid, leaseUntil=now()+90s WHERE id=1 AND leaseUntil < now() RETURNING`). This works through Neon's pooled connection; session advisory locks would not. Exactly one sender per run means **no nonce races** from parallel serverless invocations.
2. Reconcile first. For each `SUBMITTED` row, check `getTransactionReceipt(txHash)`:
   - success → `MINTED`
   - reverted, or dropped after 10 min → check on-chain `claimUsed(claimKey)`: if true → `MINTED`; else → back to `QUEUED` and `attempts++`.
3. Check guards (see Spend cap): kill switch, balance, daily cap. If any fails, stop and alert.
4. Take up to 50 `QUEUED` rows (`FOR UPDATE SKIP LOCKED`). Send one `mintMany(to[], ids[], claimKeys[])` tx, set the rows to `SUBMITTED` with `txHash`, wait for the receipt (Base ~2 s blocks, 30 s timeout), then set `MINTED`, `mintedAt`, and `blockNumber`.
5. After 5 failed attempts → `FAILED` with `lastError`. The row is then shown on the admin page with a Retry button.
6. Release the lease.

**Idempotency (both layers)**
- DB: `@@unique([discordId, callId])` on `AttendanceNftClaim`, so there is one claim per member per call. The existing `isUniqueViolation` handling carries over from `poap-claims.ts`.
- On-chain: `claimKey = keccak256("pizzastamp:" + claim.id)` (claim row cuid). The contract stores `claimUsed[claimKey]`. `mintMany` **skips** (does not revert) any key that's already used, so one stale retry can't sink a batch, and resubmitting after a timeout can never double-mint, even if the member changed wallets in between.
- Also skip if `balanceOf(to, id) > 0`. This is the cheap guard for "same wallet, same call."

Alternatives considered:
- **Signature lazy-mint, member pays gas** (server signs a voucher, member submits `claim(voucher)` from their wallet). This needs a funded wallet on Base and a wallet popup. That's too much friction for the engagement goal, and many members hold no Base ETH. Not recommended. It could be a fallback if gas ever becomes material.
- **ERC-4337 + paymaster** (CDP Paymaster sponsoring a member's smart-wallet claim). It's "deliberate on-chain" but needs smart wallets for everyone. It's overkill when a server EOA mint costs about $0.002.
- **Reuse the RSV.Pizza `RSVPizzaNFT` contract** with `eventId = "call:ops:2026-10-27"`. This needs zero contract work, but the collection is branded "RSV.Pizza," it mixes party and call attendance, it's ERC721 (one token per attendee, so more storage), and it would share one Ownable key across two apps. Not recommended. It's still a valid "ship this week" fallback (D7).
- **Synchronous mint inside the POST.** This is simpler, but parallel claims race on the nonce and a slow RPC times out the request. The queue + `after()` gives near-synchronous UX without that.

### 3. Contract: `PizzaStamps.sol` (OpenZeppelin v5)

```solidity
contract PizzaStamps is ERC1155, ERC1155Supply, ERC1155Burnable, AccessControl {
  bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
  string public name = "Pizza Stamps"; string public symbol = "STAMP";
  string private _base; string private _contractURI;
  bool public transferable;                       // false = soulbound (default per D2)
  mapping(bytes32 => bool) public claimUsed;

  function mintMany(address[] calldata to, uint256[] calldata ids, bytes32[] calldata keys)
      external onlyRole(MINTER_ROLE);              // skips used keys / existing holders, emits StampMinted(to,id,key)
  function setBaseURI(string) / setContractURI(string) / setTransferable(bool)
      external onlyRole(DEFAULT_ADMIN_ROLE);
  function uri(uint256 id) public view override returns (string) { return string.concat(_base, id.toString()); }
  function _update(...) internal override {        // soulbound: allow mint (from==0) and burn (to==0) only
      if (!transferable && from != address(0) && to != address(0)) revert Soulbound();
      super._update(...);
  }
  function supportsInterface(...) ... // ERC1155 + AccessControl
}
```

- `DEFAULT_ADMIN_ROLE` goes to **Snax's own wallet** (hardware wallet, or a PizzaDAO Safe on Base if one exists). `MINTER_ROLE` goes only to the hot minter address. If the minter key leaks, the worst an attacker can do is mint junk stamps and burn the ~0.01 ETH float. Admin revokes the role and grants a new key with one tx. The admin can never be taken over through the hot key.
- Burnable by the holder, so people can remove stamps they don't want. This also satisfies the "soulbound but removable" norm.
- Soulbound is a global toggle (`transferable`), not per id, which is simpler. It emits ERC-5192-style `Locked` semantics only informally. Optional: implement `IERC5192.locked(id)` returning `!transferable` so wallets show the lock.
- `contractURI()` provides OpenSea collection metadata.
- Tooling: new top-level `contracts/` Foundry project in this repo (`contracts/src/PizzaStamps.sol`, `contracts/test/PizzaStamps.t.sol`, `contracts/script/Deploy.s.sol`, `foundry.toml`, OZ via `forge install` / `lib/` gitmodule or a vendored remapping). Exclude it from the Next build/tsconfig/eslint.
- Foundry tests: role gating, skip-on-used-key, skip-on-existing-holder, soulbound transfer revert, burn allowed, toggle transferable, `uri()`, and gas snapshot for `mintMany` with 1/10/50 recipients.

### 4. Metadata and artwork

- `GET /api/stamps/metadata/[id]` (public, `Cache-Control: public, s-maxage=3600`). It returns ERC-1155 JSON:
  - `name`: "Ops Crew Call · Oct 27, 2026"
  - `description`
  - `image`
  - `external_url`: `/crew/{crewId}`
  - `attributes`: Crew, Date, Call type, Season/Year
  - It 404s ids that don't exist. Also `GET /api/stamps/contract-metadata` serves `contractURI`.
- **Art = per-crew template, rendered per call.** An admin uploads one square background per crew (`StampArt` table: crewId → Blob URL, via the existing `app/lib/blob-image-upload.ts`, which handles magic-byte sniffing with no SVG). When a call's `AttendanceNftCall` row is created, render a 1000×1000 PNG with `next/og` `ImageResponse`: crew art + crew label + date + "Pizza Stamps #id" + a stamp border. Upload it once to Vercel Blob (`stamps/{id}.png`) and store `imageUrl` on the row. The image is then immutable and cheap to serve. If a crew has no art, use a default pizza-stamp template with the crew emoji from crew-mappings.
- Alternatives:
  - AI-generated art per call. The `app/lib/mafia-portrait/generate.ts` OpenAI pipeline exists, but this adds cost, review burden, and inconsistency. Possible later for special calls.
  - Pin to IPFS (Pinata/web3.storage) for permanence. Recommend an optional Phase 4 "freeze": pin past images + JSON and `setBaseURI(ipfs://…/)` once a season. Vercel Blob is fine to start because `setBaseURI` makes migration a single tx.

### 5. Chain choice: **Base** (recommended)

Gas prices sampled live 2026-10-27 with `cast gas-price` (ETH $2,344, POL $0.092). A first mint of a new id to a new holder with a claim-key write costs about 75-80k gas, single or amortised in a batch. Batches of 50 bring it to about 55k each.

| Chain | Gas price now | ≈ per mint | 300 claims/week | Notes |
|---|---|---|---|---|
| **Base** | 0.006 gwei (+ small L1 data fee) | **$0.001-0.003** | **< $1/week** (< $50/yr even at 10× spikes) | Newer PizzaDAO NFTs (Pizza Board, Molto Benny Pizza, Base Pizza) and RSV.Pizza attendance NFTs already live here. Alchemy NFT API is already wired in `nft-config.ts`. Coinbase Wallet/Smart Wallet onboarding; CDP Server Wallet/Paymaster available; OpenSea + Zora + Basescan support. |
| Optimism | 0.001 gwei | ~$0.001-0.002 | < $1/week | Pizza Sticks is here. Fine technically, but a smaller consumer/NFT audience than Base. |
| Zora | 0.001 gwei | ~$0.001 | < $1/week | NFT-native, but a thin ecosystem for anything else; Alchemy Zora support is less certain long-term. |
| Polygon PoS | 278 gwei POL | ~$0.002 | < $1/week | Pizza Pop. Requires a separate POL float. Members are less likely to look there. |
| Ethereum | 0.10 gwei today | ~$0.02 now; $0.20-5 when gas spikes | $6-1,500/week | Where Rare Pizzas live, but volatility makes this a bad fit for free mints. |

At 50-300 claims/week, every L2 is effectively free (a 0.02 ETH float, about $47, lasts more than a year on Base). So the choice is about ecosystem: **Base**. Backfill of all historical attendance (likely a few thousand rows) costs single-digit dollars.

Testnet: **Base Sepolia** (84532) for LOCAL QA only (never Vercel Preview: previews share the prod DB), with a separate contract and a separate testnet minter key.

### 6. Minter key custody, rate limits, spend cap

**Recommended v1: hot EOA key as a Vercel Sensitive env var, minter-role only, tiny float.**
- Env names (new):
  - `STAMPS_MINTER_PRIVATE_KEY` (Sensitive, Production only)
  - `STAMPS_CONTRACT_ADDRESS`
  - `STAMPS_CHAIN_ID` (8453 prod / 84532 preview)
  - `STAMPS_RPC_URL` (Alchemy Base RPC; reuse the `ALCHEMY_API_KEY` URL form `https://base-mainnet.g.alchemy.com/v2/<key>` if unset)
  - `STAMPS_MINTING_ENABLED` (kill switch, default off)
  - `STAMPS_DAILY_MINT_CAP` (default 1000)
  - `STAMPS_MIN_BALANCE_WEI` (alert threshold)
  - Do NOT set the minter key in Preview scope: previews share the prod DB and the code refuses to mint off production.
- Never log the key. Load it only in `app/lib/stamps/minter.ts` (server-only import guard `import "server-only"`).
- Alternatives:
  - **Coinbase CDP Server Wallet (v2)**: the key lives in Coinbase's TEE, with an API call to send txs, nonce management, and optional gas sponsorship on Base. This is the best upgrade path if Snax doesn't want a raw key in Vercel. It costs an API key + secret instead (same custody class, smaller blast radius), and adds a vendor dependency. Suggested as Phase 4 or as the v1 choice if Snax prefers (D3).
  - **thirdweb Engine** (cloud/self-host): a capable relayer with queues, but another paid service plus SDK for 300 txs/week. Not needed.
  - **OpenZeppelin Defender Relayer**: OZ has announced Defender's sunset (2026). Don't build on it. Verify the date if reconsidered.
- **Spend cap and abuse limits.** Guards run in the queue processor, so a bug or abuse can't drain more than the float:
  - The float itself is the hard cap. Snax funds about 0.01-0.02 ETH, and the minter holds nothing else.
  - The daily cap counts `MINTED+SUBMITTED` claims in the last 24 h (from `STAMPS_DAILY_MINT_CAP`). When it's hit, the queue pauses and an alert posts.
  - Per-tx `maxFeePerGas` ceiling (e.g. 0.5 gwei on Base). Above it, skip this run.
  - If the balance falls below `STAMPS_MIN_BALANCE_WEI`, post a Discord alert to the admin channel (reuse `app/lib/discord-webhook.ts`) and show a banner on `/admin/stamps`. The banner stays up until the balance recovers.
  - Claim route: per-user rate limit through `enforceRateLimit` (e.g. 30 claims / 10 min; "claim all" counts as one).
  - Nothing is claimable without a `CallAttendance` row, so abuse is bounded by real attendance.

### 7. Members without a wallet: claim now, mint later (recommended)

- Claiming always succeeds (that's the engagement event). If the member has no EVM wallet, the row is `AWAITING_WALLET` and the UI says "Claimed! Link a wallet to receive it." The CTA goes to `/me/wallets`.
- When a wallet is added or made primary (`app/api/wallet/route.ts` POST/PUT, after `saveWalletForMember`/`setPrimaryWallet`), promote that member's `AWAITING_WALLET` rows to `QUEUED`, setting `recipient` = the current primary EVM wallet, and kick `after(processMintQueue)`. The cron also sweeps, which covers the sheet-fallback wallets.
- Recipient = primary EVM wallet at queue time (`getWalletForMember` → first EVM; skip Solana). It is stored on the row and never changed after `SUBMITTED`.
- Note: wallets can be typed in without a signature. A member could direct a stamp to an address they don't control. That only hurts themselves, so it's acceptable for v1.
- Rejected:
  - Custodial mint to a PizzaDAO vault followed by a transfer. This conflicts with soulbound and costs 2 txs.
  - Requiring a wallet before claim. This loses the engagement moment for exactly the newest members.
  - Embedded wallets (Privy/CDP embedded): possible later.

### 8. Data model (new migration `2026xxxx_attendance_stamps`)

```prisma
model AttendanceNftCall {          // one per call = one token id
  id        Int      @id @default(autoincrement())   // == on-chain token id
  crewId    String
  crewLabel String
  callDay   DateTime @db.Date
  imageUrl  String?                // rendered PNG in Blob
  createdAt DateTime @default(now())
  claims    AttendanceNftClaim[]
  @@unique([crewId, callDay])
}

model AttendanceNftClaim {
  id          String   @id @default(cuid())   // claimKey = keccak256("pizzastamp:"+id)
  discordId   String
  memberId    String?
  callId      Int
  call        AttendanceNftCall @relation(fields: [callId], references: [id])
  status      String   // AWAITING_WALLET | QUEUED | SUBMITTED | MINTED | FAILED
  recipient   String?
  txHash      String?
  chainId     Int?
  attempts    Int      @default(0)
  lastError   String?
  claimedAt   DateTime @default(now())
  mintedAt    DateTime?
  updatedAt   DateTime @updatedAt
  @@unique([discordId, callId])
  @@index([status, claimedAt])
  @@index([memberId])
}

model StampArt  { crewId String @id; imageUrl String; updatedAt DateTime @updatedAt }
model MintLease { id Int @id; holder String?; leaseUntil DateTime @default(now()) }  // seed row id=1
```

Token ids must be stable once minted. Never delete `AttendanceNftCall` rows. Prod and preview DBs have separate sequences, which is fine because they use separate contracts.

`PoapMintLink`: PR #192 shipped it, so the table probably has zero or a few rows. Phase 2 migration: if rows exist, keep the table read-only and show existing claimed links as "legacy POAP" in the list for one release. Otherwise drop it in a follow-up migration. Snax confirms (D8).

---

## Migrating the merged POAP-claims code

| Today | Becomes |
|---|---|
| `app/lib/poap-claims.ts` | `app/lib/stamps/claims.ts`. Keeps `dayKey`, `isValidDayKey`, the attendance gate, the `listPoapClaims` grouping/dedupe logic (status now `claimable | queued | minting | minted | awaiting_wallet | failed`, plus `tokenId`, `txHash`, `imageUrl`), `isUniqueViolation`, and `claimActivationCode`. Drops `parseMintLinks`, `isAllowedMintLink`, `POAP_LINK_HOSTS`, and the SKIP LOCKED link pick. Every attended call is claimable; there is no pool to run out. |
| new | `app/lib/stamps/minter.ts` (viem wallet/public clients, ABI, `mintMany`, balance), `app/lib/stamps/mint-queue.ts` (lease, reconcile, batch, guards), `app/lib/stamps/art.ts` (`next/og` render + Blob put), `app/lib/stamps/config.ts` (env parsing, chain select, explorer/OpenSea URL builders) |
| `app/api/poap-claims/route.ts` | `app/api/stamps/route.ts` (GET list) + `app/api/stamps/claim/route.ts` (POST one, or `{all:true}` to claim every claimable call in one go). The old path can 308 to the new one for one release, or just be deleted, since the only consumer is our UI. |
| new | `app/api/stamps/metadata/[id]/route.ts`, `app/api/stamps/contract-metadata/route.ts`, `app/api/cron/stamps/route.ts` (+ `vercel.json` cron `*/5 * * * *`, guarded by `app/lib/cron-auth.ts`, and added to `app/api/cron/cron-routes.test.ts`) |
| `app/api/admin/poaps/route.ts` + `app/admin/poaps/*` | `app/api/admin/stamps/route.ts` + `app/admin/stamps/{page,AdminStampsClient}.tsx`. Shows per-crew art upload/preview, recent calls with claimed/minted counts, a queue view (FAILED rows with Retry, a stuck SUBMITTED list), minter address + balance + daily count, the kill-switch state, and a "re-render image" action per call. `/admin/poaps` redirects. |
| `app/ui/poap/PoapClaims.tsx` | `app/ui/stamps/StampClaims.tsx` (`StampClaimsList`, `StampClaimsCard`). Polling while any item is queued/minting, a "Claim all (N)" button, minted items showing the image thumbnail + Basescan/OpenSea links, and a wallet CTA for `awaiting_wallet`. Dashboard import at `app/dashboard/[id]/page.tsx:42,272` swaps over. |
| `/poaps` page | Rename to **`/stamps`** (claim list + "My stamps" grid read from DB `MINTED` rows, so no Alchemy call is needed). Keep the `/poaps` whitelist/legacy POAP section on that page under a "Legacy POAPs" heading. Update the `sitemap.ts` and `SiteHeader` entries. |
| `app/calls/how-to-attend/page.tsx` + `howToAttend.poap*` keys | Copy becomes "Claim your Pizza Stamp: after you attend, open Stamps and claim the NFT for that call." Link to `/stamps`. |
| i18n `poapClaims` ns (en/es/fr) | `stamps` namespace. Run the existing i18n parity test (`dashboard-i18n.test.tsx`-style key checks) for all three locales. |
| `poap_claimed` activation | Add `stamp_claimed` to the `ActivationEventName` union. Keep `poap_claimed` in the union for historical rows. |
| Activity feed (`PoapFirstSeen`/`poap_received`) | Add a `stamp_minted` item sourced from `AttendanceNftClaim` (status MINTED, `mintedAt`) in `app/api/activity/[memberId]/route.ts` + `activity-types.ts`. Leave `PoapFirstSeen` alone; it keeps working for real POAPs. |
| NFT display / mafia points | Add a "Pizza Stamps" row (Chain=Base, address) to the NFT contracts Google Sheet. `/nfts` and profile `NFTCollection` then pick it up through Alchemy with no code change. Optional: a mafia-points source per stamp count (D9, Phase 4). |
| `app/lib/poap-claims.test.ts` | `app/lib/stamps/claims.test.ts` + `mint-queue.test.ts` (viem mocked) |

**Backfill for past calls:** no special mint job is needed. Every historical `CallAttendance` row is claimable as soon as this ships ("You have 23 unclaimed stamps"), which is the engagement hook. "Claim all" queues them, and the queue batches them 50 per tx. `AttendanceNftCall` rows and their art renders are created lazily on first claim. Optional admin action "pre-create calls for last N days" warms the images. Decision D6: whether old calls get a claim window, e.g. claimable only for calls in the last 90 days, plus "anniversary" drops.

---

## Phases and files

**Phase 0: decisions + contract (Snax-involved)**
1. Snax answers D1-D9.
2. `contracts/` Foundry project: `src/PizzaStamps.sol`, `test/PizzaStamps.t.sol`, `script/Deploy.s.sol` (constructor args: admin, minter, baseURI, contractURI, transferable), `foundry.toml`, `README.md` (deploy and verify steps). Exclude it in `tsconfig.json`/`eslint.config.mjs`/`vitest.config.ts`.
3. Deploy to **Base Sepolia** with a throwaway deployer, then `forge verify-contract` (Basescan/Etherscan v2 API key).

**Phase 1: backend on Sepolia (local DB, not Preview)**
4. Prisma migration + schema (models above, seed `MintLease` id=1).
5. `app/lib/stamps/{config,minter,mint-queue,claims,art}.ts`
6. Routes: `api/stamps`, `api/stamps/claim`, `api/stamps/metadata/[id]`, `api/stamps/contract-metadata`, `api/cron/stamps`, `api/admin/stamps` (+ art upload, retry, re-render)
7. Hook in `app/api/wallet/route.ts`: promote `AWAITING_WALLET` rows.
8. Unit tests: claim gating/idempotency, the queue state machine (lease contention, receipt success/revert/timeout, `claimUsed` reconcile), guards (cap, balance, gas ceiling, kill switch), metadata shape.

**Phase 2: UI swap + cleanup**
9. `app/ui/stamps/*`, `/stamps` page, dashboard card, `/admin/stamps`, how-to-attend copy, i18n en/es/fr, `sitemap.ts`, `SiteHeader`, redirects `/poaps`→`/stamps` (if D5 renames) and `/admin/poaps`→`/admin/stamps`.
10. Remove `poap-claims.ts`, the `api/poap-claims` and `api/admin/poaps` routes, and the old UI. Migration to drop `PoapMintLink` (per D8).
11. Activity feed `stamp_minted`. `activation.ts` union.

**Phase 3: mainnet launch (Snax-involved)**
12. Snax deploys to Base mainnet (or approves the deploy), funds the minter, and sets the Vercel env vars. Add the contract to the NFT contracts sheet. Set `contractURI`.
13. Flip `STAMPS_MINTING_ENABLED=true` in Production. Watch the first 20 claims.

**Phase 4 (optional)**: IPFS freeze, CDP Server Wallet migration, mafia points for stamps, streak/milestone special stamps (e.g. "10 calls"), Discord post "stamps are ready" after the attendance cron.

## What Snax must do himself

1. **Pick decisions D1-D9** (below).
2. **Admin wallet:** decide which wallet holds `DEFAULT_ADMIN_ROLE`: his hardware wallet or a PizzaDAO Safe on Base. Its address goes into the deploy script.
3. **Create the minter wallet** (`cast wallet new`, run by him or with him present). Store the key in the login keychain (`security add-generic-password -l stamps-minter -a stamps-minter -w`) and in Vercel as a **Sensitive, Production-only** env var. Never paste it into chat or a file. A separate Sepolia key goes to Preview.
4. **Fund the minter** with about 0.01-0.02 ETH on Base (bridge or a Coinbase withdrawal to Base). Fund a deployer with about 0.002 ETH if he deploys from a hot key. Get Sepolia ETH from a faucet.
5. **Approve or run the mainnet deploy.** The Foundry script runs `forge script … --rpc-url base --ledger` if he uses a Ledger as deployer, or a one-off hot key. Then `forge verify-contract`. The deploy costs well under $1 on Base.
6. **Add the Vercel env vars** (names in §6). The agent can run `vercel env add` through `vercel-token` with the sandbox disabled, but the private key value must be entered by Snax.
7. **Upload crew art** on `/admin/stamps`, or approve the default template.
8. Add the "Pizza Stamps" row to the NFT contracts sheet.

## Risks

- **Hot key compromise:** bounded by the minter-only role + tiny float + admin revoke. Mitigations: Sensitive env, Production-only, no logging, `server-only` import. Upgrade path is CDP Server Wallet.
- **Nonce or stuck tx:** single-lease sender. Reconcile via receipt + `claimUsed`. If a tx is stuck for more than 10 min, replace it with the same nonce and a bumped fee (viem `nonce` override), or let the next batch re-include the keys (skipped if already used).
- **Serverless timeouts:** batch ≤50, receipt wait ≤30 s, `maxDuration` 60 on the cron route. `after()` work is best-effort, and the cron is the safety net.
- **Dynamic metadata on app.pizzadao.org:** if the app domain changes or goes down, images and JSON break. Mitigated by `setBaseURI` + optional IPFS freeze. Images are already immutable Blob URLs.
- **Token id ↔ DB coupling:** losing the DB sequence would remap ids. Mitigation: never delete call rows. Emit `StampMinted(to, id, key)` events so the mapping can be rebuilt from chain, and include crew/date in the metadata.
- **Soulbound + wallet loss:** a member who loses a wallet can't move stamps. They can burn, and an admin can re-queue a claim to the new wallet: delete the DB claim row, and the new row gets a new claimKey. Document this as an admin action. The old token remains.
- **Unverified wallets:** see §7. Acceptable.
- **Attendance data quality:** stamps inherit whatever `CallAttendance` says. Wrong `crewId` or day means a wrong stamp, and it can't be un-minted (only burned by the holder). The admin view should show attendance counts per call before Snax promotes.
- **Legal/tax:** free, non-financial collectibles with no sale. Low risk. Avoid the "POAP" trademark in copy.
- **Vercel Hobby/Pro cron limits:** the project already runs a `*/10` cron, so a `*/5` should be allowed on the current plan. Fall back to `*/10` if not.

## How to verify

- `forge test -vv` + `forge snapshot` (gas for `mintMany` 1/10/50) in `contracts/`.
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run app/lib/stamps app/api/stamps app/api/cron` (+ existing activation, dashboard, and i18n tests).
- **Local / forked DB on Base Sepolia (NEVER a Vercel preview):** Vercel previews share the production database and the code refuses to mint unless `VERCEL_ENV=production`. For testnet QA run `npm run dev` locally against a throwaway/forked Postgres (not the prod `DATABASE_URL`), with `SLICES_ENABLED=true`, `SLICES_ALLOW_NON_PROD=true`, `SLICES_CHAIN_ID=84532`, a Sepolia contract, a separate Sepolia minter key and a Sepolia RPC in `BASE_RPC_URL`. Claims are stamped with their chain id and queue/lease/daily-cap queries are per chain, so even a stray testnet claim cannot be picked up by the mainnet minter. Then:
  1. Sign in as a test member who has a `CallAttendance` row in that local DB (seed one with a script if needed).
  2. `/stamps` shows "Claim". Click it. The item goes through "Baking…" to "Minted" within about 10 s, and the Sepolia Basescan link shows the `StampMinted` event.
  3. Double-click and parallel claims (two tabs) produce one DB row and one token. `balanceOf` = 1.
  4. "Claim all" with 5+ calls produces one tx containing all ids.
  5. A member with no wallet sees `AWAITING_WALLET`. Linking a wallet in `/me/wallets` leads to a mint within one cron tick or immediately.
  6. Soulbound: `cast send safeTransferFrom` from the test wallet reverts `Soulbound()`. Burn works.
  7. `/api/stamps/metadata/1` returns valid JSON. The image renders. The token shows on testnets.opensea.io.
  8. Kill switch off: claims queue but nothing mints. The admin page shows paused.
  9. Drain the Sepolia minter below the threshold: an alert posts and the queue pauses.
  10. Dashboard card, how-to-attend copy, and en/es/fr strings render. Mobile check (`/mobile-check`) on `/stamps` and dashboard.
- **Prod smoke test after Phase 3:** Snax claims his own stamp first, then confirm on Basescan + OpenSea + `/nfts` (sheet row).

## Decisions for Snax

1. **D1 Chain:** Base (recommended; ~$0.002/mint, where newer PizzaDAO NFTs and RSV.Pizza attendance NFTs live) vs Optimism, Zora, or Polygon.
2. **D2 Soulbound?** Recommended: non-transferable by default, holder can burn, admin can flip `transferable` later.
3. **D3 Gas and custody:** PizzaDAO pays through a server mint (recommended). Key in a Vercel env var with a minter-only role and a ~0.02 ETH float (simplest), or Coinbase CDP Server Wallet (no raw key, a vendor account). Member-pays lazy mint is not recommended.
4. **D4 Art style:** per-crew template art uploaded once, with date and crew stamped on automatically (recommended). Alternatives are a single generic stamp for all calls, or AI-generated art per call.
5. **D5 Name:** "Pizza Stamps" (`STAMP`, page `/stamps`) vs "Call Slices" vs other. This drives copy, route names, and the contract `name`.
6. **D6 Backfill/claim window:** all past attendance claimable forever (recommended for launch hype), vs only the last N days.
7. **D7 Contract:** new ERC-1155 `PizzaStamps` (recommended), or reuse RSV.Pizza's deployed ERC721 for a faster, messier launch.
8. **D8 `PoapMintLink`:** drop it (if no real links were uploaded) or keep the legacy links visible for one release.
9. **D9 Admin wallet:** which wallet or Safe holds the admin role, and whether stamps should count toward mafia points.

## Decisions (Snax, 2026-10-27)
- Name: **Call Slices** (page `/slices`, symbol `SLICE`).
- **Non-transferable** (burn allowed; admin can enable transfers later).
- Art: **per-crew template** with the date and crew name stamped on automatically; crews without art yet use a default template.
- Minter key: **key in Vercel** (mint-only role, small float, daily cap), same pattern as rsv-pizza.
- Defaults taken (not yet confirmed by Snax): Base; new ERC-1155; all past attendance claimable; `PoapMintLink` dropped (no links were ever loaded); slices do not count toward mafia points; admin role = a wallet Snax names at deploy time.

## Implementation notes (branch task/call-slices)
- Built as **Call Slices** (`/slices`, `SLICE`), not "Pizza Stamps". Names in this plan map: stamps -> slices, `PizzaStamps` -> `CallSlices`, `StampArt` -> `SliceCrewArt`, `MintLease` -> `SliceMintLease`, env `STAMPS_*` -> `SLICES_*` (+ `BASE_RPC_URL`).
- Migration `20261030000000_call_slices` is additive. `PoapMintLink` is left in place (unused, harmless).
- Contract, tests and the exact launch runbook (minter wallet, funding, deploy, verify, env, sheet row): `contracts/README.md`.
- Env var names: `SLICES_ENABLED`, `SLICES_CONTRACT_ADDRESS`, `SLICES_MINTER_PRIVATE_KEY`, `BASE_RPC_URL`, `SLICES_CHAIN_ID`, `SLICES_DAILY_CAP`, `SLICES_MAX_GAS_GWEI`, `SLICES_MIN_BALANCE_ETH` (documented in `.env.example`).
- Review fixes: minting requires `VERCEL_ENV=production` (or local `SLICES_ALLOW_NON_PROD=true`); claims carry a chain id and the lease row is per chain; `mintMany` skips the ERC-1155 receiver callback; failed batches bisect; stuck txs are replaced at the same nonce.
