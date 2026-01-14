# PizzaDAO Onboarding Platform - Architecture

## Overview

This is a Next.js 16 application serving as the onboarding and community management platform for PizzaDAO. It integrates Discord authentication, a custom economy system ($PEP), job/bounty management, NFT tracking across multiple chains, and anonymous governance voting.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16.1.1 (App Router) |
| Language | TypeScript 5 |
| Database | PostgreSQL (Neon serverless) |
| ORM | Prisma 7.2 with Neon adapter |
| Cache | Vercel KV (Redis) |
| Auth | Discord OAuth2 + HMAC-SHA256 sessions |
| Web3 | Wagmi 2.x + RainbowKit 2.x + Viem |
| NFT API | Alchemy (multi-chain) |
| External Data | Google Sheets API |
| Styling | Tailwind CSS 4 + inline styles |

## Directory Structure

```
├── app/
│   ├── api/                    # 55+ API routes
│   │   ├── discord/            # OAuth login/callback
│   │   ├── economy/            # Balance, transfers, leaderboard
│   │   ├── jobs/               # Daily jobs system
│   │   ├── bounties/           # Bounty lifecycle
│   │   ├── nfts/               # NFT fetching & leaderboard
│   │   ├── polls/              # Anonymous voting
│   │   ├── inventory/          # Item management
│   │   ├── shop/               # $PEP shop
│   │   ├── crew/               # Crew management
│   │   ├── profile/            # User profiles
│   │   └── lib/                # Shared API utilities
│   ├── lib/                    # Core business logic
│   │   ├── session.ts          # Auth & cookie handling
│   │   ├── economy.ts          # $PEP wallet operations
│   │   ├── jobs.ts             # Job assignment logic
│   │   ├── bounties.ts         # Bounty lifecycle
│   │   ├── nft.ts              # Alchemy NFT fetching
│   │   ├── nft-config.ts       # Contract configuration
│   │   └── discord-roles.ts    # Role management
│   ├── ui/                     # React components
│   │   ├── economy/            # Leaderboard, wallet, transfers
│   │   ├── jobs/               # Job board, job cards
│   │   ├── bounties/           # Bounty board
│   │   ├── nft/                # NFT display components
│   │   ├── shop/               # Shop grid
│   │   └── onboarding/         # Claim flow wizard
│   ├── pep/                    # Economy dashboard page
│   ├── nfts/                   # NFT leaderboard page
│   ├── crews/                  # Crew listing
│   ├── crew/[crewId]/          # Individual crew
│   ├── dashboard/[id]/         # User dashboard
│   ├── profile/[id]/           # User profile
│   ├── vote/[pollId]/          # Anonymous voting
│   ├── admin/polls/            # Poll administration
│   ├── layout.tsx              # Root layout
│   └── providers.tsx           # Web3 providers
├── prisma/
│   └── schema.prisma           # 11 data models
└── public/
    └── turtles/                # Role badge images
```

## Data Models (Prisma)

```
User              # Core user record (discordId, memberId, balance)
Job               # Available jobs from Google Sheets
ActiveJob         # User's current job assignment
CompletedJob      # Historical job completions
Bounty            # User-created bounties with escrow
Item              # Shop items
Inventory         # User's owned items
Poll              # Governance polls
Vote              # Anonymous vote records
VotingIdentity    # Blind signature identities
```

## Key Features

### 1. Authentication
- Discord OAuth2 flow with automatic guild joining
- HMAC-SHA256 signed session cookies (30-day expiry)
- Session verification on protected routes

### 2. $PEP Economy
- Virtual currency with database-backed balances
- Atomic transfers with transaction safety
- Leaderboard rankings
- Shop system for purchasing items
- Inventory management and item transfers

### 3. Jobs System
- 3 random daily jobs (seeded by UTC date)
- Round-robin assignment for fair distribution
- Synced from Google Sheets via webhook
- Configurable $PEP rewards

### 4. Bounties
- User-created tasks with escrowed rewards
- Lifecycle: OPEN → CLAIMED → COMPLETED/CANCELLED
- Automatic fund escrow and release

### 5. NFT Integration
- Multi-chain support: Ethereum, Base, Polygon, Zora, Optimism
- Contract addresses configured in Google Sheets
- Paginated fetching (handles 1000+ NFTs)
- Holder leaderboard with 1-hour cache

### 6. Anonymous Voting
- Blind RSA signatures for voter privacy
- Role-based poll eligibility
- Token consumption prevents double-voting

### 7. Crew Management
- Join/leave crews with Discord role sync
- Crew rosters and member listings

## External Integrations

### Discord
- OAuth2 authentication
- Bot adds users to guild on login
- Role fetching for permissions
- Webhook notifications

### Google Sheets
- Jobs, crews, NFT contracts sourced from sheets
- Apps Script webhooks for real-time sync
- GViz API for read-only queries

### Alchemy
- NFT fetching across 5 chains
- Paginated API handling
- 5-minute cache per wallet

## Caching Strategy

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `nfts:{wallet}` | 5 min | User's NFT collection |
| `nft-leaderboard:v1` | 1 hour | Aggregated holder rankings |
| `crew-mappings:*` | 5 min | Crew ID → label mappings |
| `task-links:*` | 30 min | Google Sheets hyperlinks |

Uses Vercel KV in production with in-memory fallback for local development.

## Authentication Flow

```
1. User clicks "Login with Discord"
2. GET /api/discord/login → redirect to Discord
3. Discord redirects to /api/discord/callback with code
4. Backend exchanges code for access token
5. Fetches user info, adds to guild
6. Creates signed session cookie
7. Redirects to dashboard
```

## Data Flow Patterns

### Economy Transaction
```
User Request → Session Check → requireOnboarded() →
DB Transaction (atomic) → Update Balances → Response
```

### NFT Fetching
```
Request → Check Cache → Miss? → Alchemy API (paginated) →
Transform → Cache 5min → Response
```

### Jobs Sync
```
Google Sheets Change → Apps Script Webhook →
POST /api/jobs/sync → Parse CSV → Upsert DB → Invalidate Cache
```

## Environment Variables

```env
# Database
DATABASE_URL=                    # Neon PostgreSQL connection

# Discord
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=

# Session
SESSION_SECRET=                  # HMAC signing key

# Google
GOOGLE_SHEETS_WEBAPP_URL=        # Apps Script endpoint
GOOGLE_SHEETS_SHARED_SECRET=
GOOGLE_SHEETS_API_KEY=

# Caching
KV_REST_API_URL=                 # Vercel KV
KV_REST_API_TOKEN=

# Web3
ALCHEMY_API_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=

# Optional
OPENAI_API_KEY=                  # Name generation
CLAIM_PASSWORD=                  # Member claiming
```

## API Route Categories

| Path | Purpose |
|------|---------|
| `/api/discord/*` | OAuth login/callback/logout |
| `/api/economy/*` | Balance, transfers, leaderboard |
| `/api/jobs/*` | Job listing, assignment, completion |
| `/api/bounties/*` | Bounty CRUD and lifecycle |
| `/api/nfts/*` | NFT fetching and leaderboard |
| `/api/polls/*` | Poll management and voting |
| `/api/inventory/*` | Item ownership |
| `/api/shop/*` | Item purchasing |
| `/api/crew/*` | Crew membership |
| `/api/profile/*` | User data management |

## Security Considerations

- Session cookies: HttpOnly, Secure, SameSite=Lax
- HMAC-SHA256 with constant-time comparison
- Blind signatures for vote anonymity
- Atomic database transactions for economy
- Role-based access control via Discord roles
