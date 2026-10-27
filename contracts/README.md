# Call Slices contract

`CallSlices` is an ERC-1155 (OpenZeppelin v5 + AccessControl) on **Base**. One token id per crew call
(id = `AttendanceNftCall.id` in the app DB). Non-transferable by default; holders can burn; the admin can
enable transfers. The server holds only `MINTER_ROLE` (mint only). `DEFAULT_ADMIN_ROLE` is a separate address
you pass at deploy time (hardware wallet or a Safe) and it can rotate minters, change URIs and toggle transfers.

- `mintMany(to[], ids[], claimKeys[])` is idempotent: used claim keys and existing holders are skipped, never reverted. It does not call the ERC-1155 receiver hook, so a contract recipient can never revert a batch. `setApprovalForAll` reverts while non-transferable.
- Name `Call Slices`, symbol `SLICE`, `uri(id) = <base>/<id>`, `contractURI()` for OpenSea.

## Layout and dependencies

Foundry project, no git submodules. OpenZeppelin 5.1.0 (only `access`, `interfaces`, `token/ERC1155`, `utils`)
and forge-std 1.9.7 are **vendored** under `lib/` and remapped in `foundry.toml`, so `forge build` works on a fresh
clone with no network. To bump OpenZeppelin: `npm pack @openzeppelin/contracts@<ver>` and replace those folders.

```bash
cd contracts
forge test            # 27 tests incl. fuzz
forge test --gas-report
```

Gas for `mintMany` (first mint of an id, new holders): about 120k for 1, 625k for 10, 2.9M for 50 (~57k each).

## Launch steps (Snax)

Never paste a private key into chat or a file. Everything below runs on your machine.

1. **Admin address.** `DEFAULT_ADMIN_ROLE` **must be a Safe or Snax's hardware wallet**, never a hot key or an app/server wallet: it can grant minters, set URIs and enable transfers.
   Only the public address is needed: `ADMIN_ADDRESS=0x...`.
2. **Create the minter wallet.** The key goes straight into the keychain, never to the screen:
   ```bash
   cast wallet new          # shows address + key ONCE. Copy the key to the clipboard, not the address.
   security add-generic-password -l slices-minter -a slices-minter -w   # paste the key at the prompt
   ```
   Note the public address as `MINTER_ADDRESS=0x...`. Clear your clipboard afterwards.
   Add the key to Vercel as **Production only, Sensitive** (see step 6).
3. **Fund the minter** with about 0.02 ETH on Base (a Coinbase withdrawal to Base, or bridge). That lasts well over a year at
   a few hundred claims a week. The minter should hold nothing else. A one-off deployer wallet (can be the admin if it
   is a normal wallet) needs about 0.002 ETH on Base.
4. **Dry run, then deploy.** The script only broadcasts with `--broadcast`:
   ```bash
   cd contracts
   export BASE_RPC_URL=...            # Alchemy Base RPC url
   export ADMIN_ADDRESS=0x...  MINTER_ADDRESS=0x...
   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL                    # simulation only
   forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --ledger   # real deploy (or --account <keystore>)
   ```
   Optional overrides: `SLICES_BASE_URI`, `SLICES_CONTRACT_URI` (default to `https://app.pizzadao.org/api/slices/...`).
   Test first on Base Sepolia locally (`--rpc-url https://sepolia.base.org`, separate minter key, `SLICES_CHAIN_ID=84532`, `SLICES_ALLOW_NON_PROD=true`, a throwaway local DB). Never use a Vercel preview: previews share the production DB, and minting refuses to run unless `VERCEL_ENV=production`.
5. **Verify on Basescan** (Etherscan v2 API key):
   ```bash
   forge verify-contract <CONTRACT_ADDRESS> src/CallSlices.sol:CallSlices --chain base \
     --constructor-args $(cast abi-encode "constructor(address,address,string,string)" $ADMIN_ADDRESS $MINTER_ADDRESS \
       "https://app.pizzadao.org/api/slices/metadata/" "https://app.pizzadao.org/api/slices/contract-metadata") \
     --etherscan-api-key $ETHERSCAN_API_KEY
   ```
6. **Set env vars in Vercel** (names only here; `vercel env add <NAME> production`):
   `SLICES_CONTRACT_ADDRESS`, `SLICES_MINTER_PRIVATE_KEY` (Sensitive), `BASE_RPC_URL`, and optionally
   `SLICES_DAILY_CAP`, `SLICES_MAX_GAS_GWEI`, `SLICES_MIN_BALANCE_ETH`, `SLICES_CHAIN_ID`.
   Leave `SLICES_ENABLED` unset. `CRON_SECRET`, `PEP_ADMIN_LOG_CHANNEL_ID` and `DISCORD_BOT_TOKEN` already exist.
7. **Apply the migration** `20261030000000_call_slices` (merging to main does this if migrations auto-apply; it is additive).
8. **Upload crew template art** on `/admin/slices` (optional; crews without art use the default pizza template).
9. **Flip on:** set `SLICES_ENABLED=true` in Production and redeploy. Claim your own slice first, check the tx on Basescan and the
   image at `/api/slices/metadata/1`. Watch the first 20 claims on `/admin/slices`.
10. **Add the contract to the NFT contracts Google Sheet** (row: Call Slices, Chain Base, the contract address) so `/nfts` and
    profile collections show it. Slices do not count toward mafia points.

Emergency: set `SLICES_ENABLED` to anything but `true` (claims keep queuing, nothing mints). If the minter key leaks, the admin
revokes the role (`revokeRole(MINTER_ROLE, old)`) and grants a new key; the attacker can only mint junk slices and drain the float.
