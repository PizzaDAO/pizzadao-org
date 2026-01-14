# PizzaDAO Onboarding Platform - Context Summary

## Project Overview
Next.js 16 app for PizzaDAO member onboarding, economy ($PEP), jobs, bounties, NFT tracking, and anonymous voting. See `architecture.md` for full details.

## Recent Changes (Latest First)

### Fixed Discord role assignment for Splinter & Foot Clan
**Commit:** `dcc5058`
- Added `SPLINTER` and `FOOT_CLAN` to `TURTLE_ROLE_IDS` in `app/ui/constants.ts`
- Fixed `resolveTurtleRoleId()` in `app/api/profile/route.ts` to handle "Foot Clan" → "FOOT_CLAN" (space to underscore conversion)

### Added architecture.md
**Commit:** `599ce37`
- Comprehensive documentation of tech stack, data models, features, API routes

### Reverted favicon to PizzaDAO logo
**Commit:** `dd4404d`
- Changed from diamond emoji back to PizzaDAO SVG logo

### Fixed NFT pagination
**Commit:** `4066c62`
- `app/lib/nft.ts` now paginates through Alchemy API results (was only getting first 100)

### Made NFT Collection headers link to /nfts
**Commit:** `7d6a532`
- Updated `app/ui/nft/NFTCollection.tsx`

### Added NFT Collections page
**Commit:** `3ac6336`
- New `/nfts` page with holder leaderboards per collection
- New API: `/api/nfts/leaderboard` (1-hour cache)
- New API: `/api/nfts/leaderboard/refresh`
- New components: `CollectionCard`, `HolderLeaderboard`, `HolderRow`
- Extended `NFTContract` type with `description` field
- Parses "Details" column from NFT contracts sheet

## Pending Investigation

**Member 146** completed onboarding with Leonardo, Foot Clan, biz_dev, and tech selected, but Discord roles weren't assigned. The Foot Clan issue is now fixed, but Leonardo and crew roles should have worked. Need to check Vercel logs for Discord API errors (possible bot permission issue - bot role needs to be above roles it assigns).

## Key Files

| File | Purpose |
|------|---------|
| `app/ui/constants.ts` | TURTLE_ROLE_IDS, CREWS constants |
| `app/api/profile/route.ts` | Main onboarding/profile update endpoint, Discord role sync |
| `app/lib/nft.ts` | Alchemy NFT fetching with pagination |
| `app/api/nfts/leaderboard/route.ts` | NFT holder aggregation |
| `architecture.md` | Full system documentation |

## Tech Stack
- Next.js 16.1.1, TypeScript, Prisma 7.2 (Neon PostgreSQL)
- Discord OAuth2, Wagmi/RainbowKit for Web3
- Vercel KV caching, Google Sheets integration, Alchemy NFT API

## External Integrations

### Discord
- OAuth2 authentication via `/api/discord/login` and `/api/discord/callback`
- Bot token for role management (DISCORD_BOT_TOKEN)
- Guild ID for member management (DISCORD_GUILD_ID)

### Google Sheets
- Crew data: Sheet ID `16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM`
- Crew mappings: Sheet ID `19itGq86BRQTVehKhtRFKwK8gZqjsUQ_bG5cuVmem9HU`
- NFT contracts: Sheet ID `1I9Sjj5kNQOushVbYGSnG668tMOAz0SJ3L8StaCG5r0I`
- Apps Script webhook for writes (GOOGLE_SHEETS_WEBAPP_URL)

### Alchemy
- Multi-chain NFT fetching (Ethereum, Base, Polygon, Zora, Optimism)
- API key: ALCHEMY_API_KEY

## Environment
- Windows
- Working directory: `C:\Users\samgo\OneDrive\Documents\PizzaDAO\Code\onboarding`
- Main branch, deploys to Vercel on push

## Turtle Role IDs (Discord)
```
RAPHAEL: 815277786012975134
LEONARDO: 815269418305191946
MICHELANGELO: 815277933622591531
DONATELLO: 815277900492046356
APRIL: 815976204900499537
SPLINTER: 815278060206424085
FOOT_CLAN: 815976604710469692
```

## Crew Role Mappings (from Google Sheet)
```
Tech → <@&1252815502473166969>
Biz Dev → <@&1252602070163390484>
```
