# PizzaDAO Governance System

## Overview

A custom anonymous voting system with:
- **Anonymous voting** (Semaphore) - Can't see who voted
- **Anti-coercion** (MACI) - Can't prove how you voted
- **Embedded wallets** (Privy) - Discord login, no crypto UX
- **Public delegate votes** - Accountability for delegates
- **Private delegation** - Delegates don't know who delegated to them
- **Category-based delegation** - Treasury, Technical, Social, All
- **Liquid democracy** - Transitive chains (A → B → C)
- **Override** - Anyone in chain can vote directly

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  VOTER LAYER                                                │
│  • Login with Discord (Privy embedded wallet)               │
│  • Anonymous identity (Semaphore)                           │
│  • Can't prove how you voted (MACI)                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  DELEGATION LAYER                                           │
│  • Category-based: Treasury, Technical, Social, All         │
│  • Liquid: Chains of delegation (A → B → C)                 │
│  • Private: Delegates don't know who delegated              │
│  • Override: Anyone in chain can vote directly              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  DELEGATE LAYER                                             │
│  • Public votes (accountability)                            │
│  • Can delegate further (liquid)                            │
│  • See voting power, not who delegated                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  VOTING LAYER                                               │
│  • On-chain (immutable, verifiable)                         │
│  • ZK tallying                                              │
│  • Public results                                           │
└─────────────────────────────────────────────────────────────┘
```

## Phased Implementation

### Phase 1: Foundation (2-3 weeks)
- [ ] Privy SDK integration
- [ ] Discord OAuth → Privy embedded wallet
- [ ] User can login, wallet created invisibly
- [ ] Basic dashboard showing connection status

### Phase 2: Anonymous Voting (3-4 weeks)
- [ ] Semaphore group per Discord role
- [ ] User joins group on login (ZK identity)
- [ ] Simple polls with anonymous voting
- [ ] Results displayed after close
- [ ] Deploy voting contract to testnet

### Phase 3: Anti-Coercion (3-4 weeks)
- [ ] MACI integration with Semaphore
- [ ] Coordinator service setup
- [ ] Vote changing enabled
- [ ] ZK tally generation
- [ ] Results verified on-chain

### Phase 4: Delegation (4-6 weeks)
- [ ] Delegate registration (public identity)
- [ ] Delegate voting (public votes, visible power)
- [ ] Private delegation (ZK commitment)
- [ ] Override mechanism
- [ ] Delegate dashboard

### Phase 5: Liquid Democracy + Categories (4-6 weeks)
- [ ] Category system (Treasury, Technical, Social, All)
- [ ] Liquid delegation chains (A → B → C)
- [ ] Chain resolution logic
- [ ] Override at any chain point
- [ ] Delegation UI

### Phase 6: Production (2-4 weeks)
- [ ] Deploy to L2 mainnet (Base or Arbitrum)
- [ ] Gas sponsorship setup
- [ ] Community testing
- [ ] Documentation
- [ ] Bug bounty program
- [ ] Launch

## Tech Stack

### Phase 1
- `@privy-io/react-auth` - React SDK
- `@privy-io/server-auth` - Server verification
- Next.js 14

### Phase 2
- `@semaphore-protocol/core`
- `@semaphore-protocol/identity`
- `@semaphore-protocol/proof`
- Solidity smart contracts
- Base Sepolia (testnet)

### Phase 3
- `maci-contracts`
- `maci-circuits`
- `maci-core`
- Coordinator server (Node.js)

### Phase 4-5
- Custom Circom circuits
- snarkjs
- Extended smart contracts

## Cost Estimates

| Phase | Cost |
|-------|------|
| Phase 1 | $0 |
| Phase 2 | ~$50 |
| Phase 3 | ~$100 |
| Phase 4 | ~$200 |
| Phase 5 | ~$300 |
| Phase 6 | ~$500-1000 |
| **Total** | **~$1,200-1,700** |

Ongoing:
- Privy: $0-500/mo
- Coordinator hosting: ~$20-50/mo
- L2 gas sponsorship: ~$50-200/mo

## User Flows

### Regular Voter

```
1. Login with Discord
2. (Behind scenes: Privy wallet + Semaphore identity created)
3. See available polls
4. Optionally set up delegation
5. Vote on polls (or let delegate vote)
6. Can override delegate on any poll
```

### Delegate

```
1. Login with Discord
2. Register as delegate (public)
3. Set up own delegations (liquid)
4. See incoming voting power by category
5. Vote on polls (public, with delegated power)
6. Delegators can override
```

### Admin

```
1. Create polls with category
2. Set required Discord role
3. Monitor participation
4. Close polls
5. Verify results on-chain
```

## File Structure

```
onboarding-governance/
├── app/
│   ├── governance/
│   │   ├── page.tsx           # Main governance dashboard
│   │   ├── polls/
│   │   │   ├── page.tsx       # List polls
│   │   │   ├── [id]/page.tsx  # Poll detail + voting
│   │   │   └── create/page.tsx# Create poll (admin)
│   │   ├── delegate/
│   │   │   ├── page.tsx       # Delegate dashboard
│   │   │   └── register/page.tsx
│   │   └── delegation/
│   │       └── page.tsx       # Set up your delegations
│   └── api/
│       └── governance/
│           ├── polls/
│           ├── vote/
│           ├── delegate/
│           └── delegation/
├── contracts/
│   ├── Voting.sol
│   ├── Delegation.sol
│   └── test/
├── circuits/
│   ├── delegation.circom
│   └── chain.circom
├── lib/
│   ├── privy/
│   ├── semaphore/
│   ├── maci/
│   └── delegation/
└── GOVERNANCE.md              # This file
```

## UI Design Decisions

### During Voting (Before Poll Closes)

| Information | Show? | Reason |
|-------------|-------|--------|
| "You have voted" | Yes | Safe with MACI (can change vote) |
| Your vote choice | No | Could be used for coercion |
| Total vote count | No | Reveals participation, timing attacks |
| Vote breakdown | No | Influences voters, timing attacks |
| "Change my vote" button | Yes | MACI's anti-coercion feature |

### After Poll Closes

| Information | Show? |
|-------------|-------|
| Final results | Yes |
| Total participation | Yes |
| Individual votes | No (anonymous) |
| Delegate votes (public) | Yes |

### Voter Confirmation UI

```
┌─────────────────────────────────────────┐
│   ✓ Vote recorded                       │
│                                         │
│   Your vote is private.                 │
│   You can change it anytime before      │
│   the poll closes.                      │
│                                         │
│   [Change My Vote]                      │
└─────────────────────────────────────────┘
```

## Security Considerations

### What's Protected

| Attack | Protection |
|--------|------------|
| See who voted | Semaphore ZK proofs |
| Prove how you voted | MACI (can change vote) |
| DB breach during voting | No identity stored |
| Admin sees delegators | ZK commitments |
| Vote manipulation | On-chain + ZK proofs |

### Trust Assumptions

| Component | Trust |
|-----------|-------|
| Privy | Wallet management |
| MACI Coordinator | Can censor (detectable), can't see votes |
| Smart contracts | Audited Semaphore/MACI |
| Custom ZK circuits | Need review |

## Resources

- Privy: https://docs.privy.io
- Semaphore: https://docs.semaphore.pse.dev
- MACI: https://maci.pse.dev
- Circom: https://docs.circom.io
- Base: https://docs.base.org
