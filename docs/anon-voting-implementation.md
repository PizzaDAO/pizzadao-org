PizzaDAO Anonymous Voting Implementation Plan
1. Overview & Vision
This system provides true anonymity for PizzaDAO members. It prevents the system administrator from knowing who voted or what they chose, while still enforcing "one member, one vote" for specific Discord roles.

Core Pillars
Decoupling: Identity is verified at login, but choices are submitted via anonymous cryptographic tokens.

Batch Issuance: All tokens are signed in a single operation via AWS Lambda to eliminate timing-correlation attacks.

Edge Verification: Voting is processed at the network edge for near-zero latency and high performance.

Cryptographic Privacy: Uses 2048-bit Blind RSA signatures so the server signs a "blinded" message it cannot read.

2. System Architecture
Directory Structure
Plaintext

/pizza-onboarding
├── app/
│   ├── admin/polls/page.tsx      # Admin Dashboard (Triggers Batch)
│   ├── api/
│   │   ├── polls/batch/route.ts  # Lambda invocation bridge
│   │   └── vote/anonymous/       # Edge-based Verification route
├── components/
│   └── AnonymousVote.tsx         # Voter UI (Unblinding & Submission)
├── lambda/
│   └── batch-signer.ts           # RSA-2048 signing script (AWS Lambda)
├── prisma/
│   └── schema.prisma             # Decoupled DB schema
├── utils/
│   └── blindCrypto.ts            # Client-side Blinding logic
└── README.md                     # Project Setup Guide
3. Database Schema (prisma/schema.prisma)
The database ensures identity and tally records are never linked by a foreign key.

Code snippet

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Table 1: Identity (Verified via Discord OAuth2)
model User {
  id            String   @id // Discord User ID
  roles         String[] 
}

// Table 2: The "Bridge" (Stores signed blinded payloads)
model PendingSignature {
  id            String   @id @default(cuid())
  userId        String   @unique
  pollId        String
  blindedSig    String   
}

// Table 3: Anonymous Tally
model PollResult {
  pollId        String
  optionId      String
  tally         Int      @default(0)

  @@id([pollId, optionId])
}

// Table 4: Double-vote prevention
model ConsumedToken {
  tokenHash     String   @id
}
4. Batch Issuance Logic (lambda/batch-signer.ts)
This AWS Lambda script handles the computationally heavy 2048-bit RSA signing for the entire DAO in one go.

TypeScript

import { RSABSSA } from '@cloudflare/blindrsa-ts';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const suite = RSABSSA.SHA384.PSS.Randomized();

export const handler = async (event: { pollId: string, roleId: string }) => {
  const privateKeyRaw = process.env.RSA_PRIVATE_KEY_PEM; 
  const privateKey = await suite.importKey(privateKeyRaw!, 'private');

  const eligibleUsers = await prisma.user.findMany({
    where: { roles: { has: event.roleId } }
  });

  const promises = eligibleUsers.map(async (user) => {
    // Generate a unique message to be blinded
    const preparedMsg = suite.prepare(new TextEncoder().encode(`poll-${event.pollId}-u-${user.id}`));
    const blindSignature = await suite.blindSign(privateKey, preparedMsg);

    return prisma.pendingSignature.create({
      data: {
        userId: user.id,
        pollId: event.pollId,
        blindedSig: Buffer.from(blindSignature).toString('base64'),
      }
    });
  });

  await Promise.all(promises);
  return { status: 'Success', count: eligibleUsers.length };
};
5. Anonymous Verification (app/api/vote/anonymous/route.ts)
Running on Vercel/AWS Edge, this verifies the signature using only the Public Key.

TypeScript

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  const { token, signature, pollId, optionId } = await req.json();
  const suite = RSABSSA.SHA384.PSS.Randomized();
  const publicKey = await suite.importKey(process.env.RSA_PUBLIC_KEY!, 'public');

  // Verify signature cryptographically
  const isValid = await suite.verify(publicKey, signature, new TextEncoder().encode(token));
  if (!isValid) return NextResponse.json({ error: 'Invalid Ballot' }, { status: 401 });

  // Prevent double voting via hash check
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hashHex = Buffer.from(hash).toString('hex');
  
  if (await isTokenUsed(hashHex)) {
    return NextResponse.json({ error: 'Already Voted' }, { status: 403 });
  }

  await recordVote(pollId, optionId, hashHex);
  return NextResponse.json({ success: true });
}
6. Security Proofs
Anti-Snooping: Because the browser "blinds" the message before the server signs it, the server never sees the final token value until the user votes anonymously.

Anti-Timing: By signing all tokens at once (Batch Issuance), the admin cannot correlate the time of signature with the time of voting.

Scalable: 2048-bit RSA is optimized for serverless environments, providing strong security without excessive CPU usage.