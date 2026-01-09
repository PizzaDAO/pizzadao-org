# Vocdoni Implementation Plan

## Overview

Vocdoni is a decentralized, anonymous voting protocol. This document outlines how PizzaDAO could implement Vocdoni for anonymous voting with Discord role-based eligibility.

## What Vocdoni Provides

| Feature | Status |
|---------|--------|
| Anonymous voting | Yes (ZK proofs) |
| Verifiable results | Yes (blockchain) |
| Census management | Yes (flexible) |
| Multiple vote types | Yes |
| Encrypted votes | Yes (until close) |
| Self-hostable | Yes |
| SDKs | Yes (JS, Go) |
| No gas for voters | Yes |

## What Vocdoni Does NOT Provide

| Feature | Status |
|---------|--------|
| Anti-coercion (MACI-style) | No |
| Delegation | No |
| Liquid democracy | No |
| Private delegation | No |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  DISCORD                                                    │
│  - User has role (e.g., "Pizza Holder")                     │
│  - Role = voting eligibility                                │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  CENSUS BUILDER (Your Service)                              │
│  - Fetch all users with specific role                       │
│  - Generate Merkle tree of eligible voters                  │
│  - Each user gets a "census proof"                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  VOCDONI                                                    │
│  - Accepts census Merkle root                               │
│  - Voter proves membership via ZK                           │
│  - Vote recorded anonymously                                │
└─────────────────────────────────────────────────────────────┘
```

## User Experience

### 1. Connect Discord (One-Time)

```
┌─────────────────────────────────────────┐
│                                         │
│   Connect Discord to Vote               │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │   Continue with Discord    🔗   │   │
│   └─────────────────────────────────┘   │
│                                         │
│   We'll check your roles to determine   │
│   voting eligibility.                   │
│                                         │
└─────────────────────────────────────────┘
```

### 2. Eligibility Check

```
┌─────────────────────────────────────────┐
│                                         │
│   ✓ Connected: pizzaFan#1234            │
│                                         │
│   Your roles:                           │
│   ✓ Pizza Holder (eligible to vote)     │
│   ✓ OG Member                           │
│                                         │
│   You can vote on Pizza Holder polls.   │
│                                         │
└─────────────────────────────────────────┘
```

### 3. Vote Anonymously

```
┌─────────────────────────────────────────┐
│                                         │
│   Pizza Hackathon Funding               │
│   Required role: Pizza Holder ✓         │
│                                         │
│   ○ Yes, full amount                    │
│   ○ Yes, partial                        │
│   ○ No                                  │
│                                         │
│   ┌─────────────────────────────────┐   │
│   │          Cast Vote              │   │
│   └─────────────────────────────────┘   │
│                                         │
│   Your vote is anonymous.               │
│                                         │
└─────────────────────────────────────────┘
```

### 4. Vote Confirmation

```
┌─────────────────────────────────────────┐
│                                         │
│   ✓ Vote submitted                      │
│                                         │
│   Nullifier: 0x7f3a...8b2c              │
│   (Save this to verify your vote)       │
│                                         │
│   Your identity is not linked to        │
│   your vote.                            │
│                                         │
└─────────────────────────────────────────┘
```

## Technical Implementation

### Dependencies

```bash
npm install @vocdoni/sdk
```

### Environment Variables

```env
VOCDONI_ENV=prod  # or 'stg' for staging
VOCDONI_PRIVATE_KEY=your_organization_private_key
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_guild_id
CENSUS_SECRET=random_secret_for_hashing_user_ids
```

### Census Creation

```typescript
// lib/vocdoni/census.ts
import { VocdoniSDKClient, Census } from '@vocdoni/sdk'
import { hash } from './crypto'

const CENSUS_SECRET = process.env.CENSUS_SECRET!

export async function createDiscordCensus(
  client: VocdoniSDKClient,
  discordRoleId: string
): Promise<string> {
  // 1. Fetch members with role from Discord
  const response = await fetch(
    `https://discord.com/api/guilds/${process.env.DISCORD_GUILD_ID}/members?limit=1000`,
    {
      headers: {
        Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
      },
    }
  )
  const members = await response.json()

  // 2. Filter to members with the required role
  const eligible = members.filter((m: any) =>
    m.roles.includes(discordRoleId)
  )

  // 3. Generate census entries (hashed for privacy)
  const census = new Census()

  for (const member of eligible) {
    // Hash Discord ID with secret - deterministic but private
    const key = hash(member.user.id + CENSUS_SECRET)
    census.add(key)
  }

  // 4. Publish census to Vocdoni
  const censusId = await client.createCensus(census)

  return censusId
}

export function getUserCensusKey(discordId: string): string {
  return hash(discordId + CENSUS_SECRET)
}
```

### Election Creation

```typescript
// lib/vocdoni/election.ts
import { VocdoniSDKClient, Election, PlainCensus } from '@vocdoni/sdk'

interface CreatePollOptions {
  title: string
  description: string
  options: string[]
  endDate: Date
  censusId: string
  requiredRole: string
}

export async function createPoll(
  client: VocdoniSDKClient,
  options: CreatePollOptions
): Promise<string> {
  const election = Election.from({
    title: options.title,
    description: options.description,
    endDate: options.endDate,
    census: {
      censusId: options.censusId,
      type: 'weighted', // or 'plain' for 1 person = 1 vote
    },
    // Enable anonymous voting
    electionType: {
      anonymous: true,
      secretUntilTheEnd: true, // Votes encrypted until poll closes
    },
  })

  // Add the question with options
  election.addQuestion(options.title,
    options.options.map((opt, i) => ({
      title: opt,
      value: i,
    }))
  )

  const electionId = await client.createElection(election)

  return electionId
}
```

### Voting

```typescript
// lib/vocdoni/vote.ts
import { VocdoniSDKClient, Vote } from '@vocdoni/sdk'
import { getUserCensusKey } from './census'

export async function castVote(
  client: VocdoniSDKClient,
  electionId: string,
  discordId: string,
  optionIndex: number
): Promise<{ nullifier: string }> {
  // Get user's census key
  const censusKey = getUserCensusKey(discordId)

  // Create vote
  const vote = new Vote([optionIndex])

  // Submit vote (SDK handles ZK proof generation)
  const result = await client.submitVote(vote)

  return {
    nullifier: result.nullifier, // User can verify their vote with this
  }
}
```

### API Routes

```typescript
// app/api/vocdoni/polls/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { VocdoniSDKClient } from '@vocdoni/sdk'
import { createDiscordCensus, createPoll } from '@/lib/vocdoni'
import { getSession } from '@/lib/session'

const client = new VocdoniSDKClient({
  env: process.env.VOCDONI_ENV as 'prod' | 'stg',
})

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session?.isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, description, options, endDate, requiredRoleId } = await req.json()

  // Create census from Discord role
  const censusId = await createDiscordCensus(client, requiredRoleId)

  // Create election
  const electionId = await createPoll(client, {
    title,
    description,
    options,
    endDate: new Date(endDate),
    censusId,
    requiredRole: requiredRoleId,
  })

  return NextResponse.json({ electionId, censusId })
}
```

```typescript
// app/api/vocdoni/vote/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { VocdoniSDKClient } from '@vocdoni/sdk'
import { castVote } from '@/lib/vocdoni'
import { getSession } from '@/lib/session'

const client = new VocdoniSDKClient({
  env: process.env.VOCDONI_ENV as 'prod' | 'stg',
})

export async function POST(req: NextRequest) {
  const session = await getSession(req)
  if (!session?.discordId) {
    return NextResponse.json({ error: 'Not logged in' }, { status: 401 })
  }

  const { electionId, optionIndex } = await req.json()

  try {
    const result = await castVote(
      client,
      electionId,
      session.discordId,
      optionIndex
    )

    return NextResponse.json({
      success: true,
      nullifier: result.nullifier,
    })
  } catch (error: any) {
    if (error.message.includes('already voted')) {
      return NextResponse.json(
        { error: 'You have already voted' },
        { status: 400 }
      )
    }
    throw error
  }
}
```

### Frontend Component

```typescript
// components/VocdoniPoll.tsx
'use client'

import { useState } from 'react'

interface PollProps {
  electionId: string
  title: string
  options: string[]
  hasVoted: boolean
}

export function VocdoniPoll({ electionId, title, options, hasVoted }: PollProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [nullifier, setNullifier] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleVote = async () => {
    if (selected === null) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/vocdoni/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          electionId,
          optionIndex: selected,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error)
      }

      setNullifier(data.nullifier)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (nullifier) {
    return (
      <div className="p-4 border rounded">
        <h2 className="text-xl font-bold text-green-600">Vote Submitted!</h2>
        <p className="mt-2">Your vote is anonymous.</p>
        <p className="mt-2 text-sm text-gray-500">
          Nullifier (save to verify): {nullifier}
        </p>
      </div>
    )
  }

  if (hasVoted) {
    return (
      <div className="p-4 border rounded">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="mt-2 text-gray-500">You have already voted on this poll.</p>
      </div>
    )
  }

  return (
    <div className="p-4 border rounded">
      <h2 className="text-xl font-bold">{title}</h2>

      <div className="mt-4 space-y-2">
        {options.map((option, i) => (
          <label key={i} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="vote"
              checked={selected === i}
              onChange={() => setSelected(i)}
              disabled={submitting}
            />
            {option}
          </label>
        ))}
      </div>

      {error && (
        <p className="mt-2 text-red-600">{error}</p>
      )}

      <button
        onClick={handleVote}
        disabled={selected === null || submitting}
        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
      >
        {submitting ? 'Submitting...' : 'Cast Anonymous Vote'}
      </button>

      <p className="mt-2 text-sm text-gray-500">
        Your vote is anonymous. We verify eligibility without linking your identity to your vote.
      </p>
    </div>
  )
}
```

## Database Schema

Store poll metadata locally (Vocdoni handles votes):

```prisma
model VocdoniPoll {
  id              String   @id @default(cuid())
  electionId      String   @unique  // Vocdoni election ID
  censusId        String            // Vocdoni census ID
  title           String
  description     String?
  options         Json              // ["Option 1", "Option 2", ...]
  requiredRoleId  String            // Discord role ID
  requiredRole    String            // Discord role name
  status          PollStatus @default(OPEN)
  createdBy       String            // Discord ID of creator
  createdAt       DateTime @default(now())
  endDate         DateTime
}

enum PollStatus {
  OPEN
  CLOSED
}
```

## Census Strategies

### Option A: Snapshot Census (Simpler)

Census created at poll creation time. Members who join after can't vote.

```typescript
// Create census when poll is created
const censusId = await createDiscordCensus(client, roleId)
```

### Option B: Rolling Census (More Inclusive)

Update census periodically. New members can vote on open polls.

```typescript
// Cron job to refresh census
async function refreshCensus(pollId: string) {
  const poll = await db.vocdoniPoll.findUnique({ where: { id: pollId } })
  if (poll.status !== 'OPEN') return

  const newCensusId = await createDiscordCensus(client, poll.requiredRoleId)

  // Update election census (if Vocdoni supports this)
  await client.updateElectionCensus(poll.electionId, newCensusId)

  await db.vocdoniPoll.update({
    where: { id: pollId },
    data: { censusId: newCensusId }
  })
}
```

## Deployment Checklist

1. [ ] Sign up for Vocdoni and get API credentials
2. [ ] Set environment variables
3. [ ] Install @vocdoni/sdk
4. [ ] Create census service
5. [ ] Create API routes
6. [ ] Build frontend components
7. [ ] Test on Vocdoni staging environment
8. [ ] Deploy to production

## Costs

| Item | Cost |
|------|------|
| Vocdoni (free tier) | $0 |
| Vocdoni (paid tier) | ~$99/mo for higher volume |
| Infrastructure | Your existing Vercel |
| Gas | $0 (Vocdoni handles this) |

## Limitations

1. **No delegation** - Each person votes for themselves
2. **No anti-coercion** - Users can prove how they voted (after revealing)
3. **Census snapshots** - New members may miss votes
4. **No liquid democracy** - No vote chaining

## Future Enhancements

If PizzaDAO needs more features later, consider:

1. **Custom delegation layer** - Build on top of Vocdoni
2. **Migrate to full custom** - Semaphore + MACI for anti-coercion
3. **Hybrid system** - Vocdoni for simple votes, custom for complex governance

## Resources

- Vocdoni Documentation: https://developer.vocdoni.io
- Vocdoni SDK: https://github.com/vocdoni/vocdoni-sdk
- Vocdoni Explorer: https://explorer.vote
