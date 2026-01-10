# Anonymous Voting Setup Guide

This document explains how to set up the anonymous voting feature for PizzaDAO.

## Overview

The voting system uses **blind RSA signatures** to ensure votes are:
- **Anonymous**: No one (including admins) can see who voted for what
- **Verifiable**: Only eligible members can vote
- **Single-vote**: Each member can only vote once per poll

## Prerequisites

1. A Vercel Postgres database
2. RSA keypair for signing
3. Existing Discord OAuth setup (already configured in main app)

## Setup Steps

### 1. Set up Vercel Postgres

1. Go to your Vercel project dashboard
2. Navigate to Storage → Create Database → Postgres
3. Copy the `DATABASE_URL` connection string
4. Add it to your environment variables

### 2. Generate RSA Keys

Run these commands to generate a 2048-bit RSA keypair:

```bash
# Generate private key
openssl genpkey -algorithm RSA -out private_key.pem -pkeyopt rsa_keygen_bits:2048

# Extract public key
openssl rsa -pubout -in private_key.pem -out public_key.pem
```

### 3. Configure Environment Variables

Add these to your Vercel project (Settings → Environment Variables):

```
DATABASE_URL=postgres://...your-vercel-postgres-url...

RSA_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

RSA_PUBLIC_KEY_PEM="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
```

**Important**: When adding multi-line keys to Vercel:
- Replace actual newlines with `\n`
- Wrap the entire value in double quotes

### 4. Run Database Migrations

```bash
npx prisma migrate dev --name init
```

Or for production:
```bash
npx prisma migrate deploy
```

### 5. Deploy

Push to your main branch or run `vercel deploy`.

## Usage

### Admin Dashboard

Admins (Leonardo role) can access `/admin/polls` to:
- Create new polls
- Open/close voting
- View results (after poll closes)

### Voting

Members access polls at `/vote/[pollId]`:
1. If eligible, they see the poll options
2. Select an option and click "Vote Anonymously"
3. The system handles all cryptography in the background
4. Their vote is recorded without any link to their identity

## How Anonymity Works

1. **Token Request**: When voting, the client generates a random token and "blinds" it
2. **Blind Signing**: The server signs the blinded token without seeing the actual value
3. **Unblinding**: The client unblinds the signature to get a valid token
4. **Anonymous Vote**: The client submits the token + signature + vote choice
5. **Verification**: The server verifies the signature is valid (proves eligibility) without knowing who submitted it

The server only knows:
- User X claimed a token for Poll Y (but not which token)
- Token Z was used to vote for Option A (but not who owns Token Z)

These two facts cannot be linked together.

## Database Schema

- `User`: Discord users who have authenticated
- `Poll`: Poll definitions (question, options, required role)
- `PendingSignature`: Tracks which users have claimed tokens (but not the tokens themselves)
- `PollResult`: Anonymous vote tallies
- `ConsumedToken`: Hashes of used tokens to prevent double-voting

## API Endpoints

- `GET /api/polls` - List all polls
- `POST /api/polls` - Create poll (admin only)
- `GET /api/polls/[pollId]` - Get poll details
- `PATCH /api/polls/[pollId]` - Update poll status (admin only)
- `DELETE /api/polls/[pollId]` - Delete draft poll (admin only)
- `GET /api/polls/[pollId]/status` - Get user's status for a poll
- `POST /api/polls/[pollId]/sign` - Request blind signature for voting
- `POST /api/vote/anonymous` - Submit anonymous vote
- `GET /api/voting-pubkey` - Get public key for client-side blinding
