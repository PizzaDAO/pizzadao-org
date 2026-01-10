/**
 * Direct vote test - bypasses API for faster testing
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { Identity, Group, generateProof, verifyProof } from '@semaphore-protocol/core'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('=== Direct Vote Test ===\n')

  // Get the existing test poll
  const poll = await prisma.anonPoll.findFirst({
    where: { question: { contains: 'pizza topping' } },
    include: { group: { include: { members: true } } }
  })

  if (!poll) {
    console.log('No test poll found. Run test-api-voting.ts first.')
    return
  }

  console.log('Found poll:', poll.id)
  console.log('Group merkle root:', poll.group.merkleRoot)
  console.log('Members:', poll.group.members.length)

  // Create a new identity for this test
  const identity = new Identity('direct-test-' + Date.now())
  console.log('\nIdentity commitment:', identity.commitment.toString().slice(0, 20) + '...')

  // Add identity to group
  console.log('\nAdding identity to group...')
  const semaphoreGroup = new Group()
  for (const m of poll.group.members) {
    semaphoreGroup.addMember(BigInt(m.commitment))
  }
  semaphoreGroup.addMember(identity.commitment)

  // Update database
  const nextIndex = poll.group.memberCount
  await prisma.$transaction([
    prisma.semaphoreGroupMember.create({
      data: {
        groupId: poll.groupId,
        commitment: identity.commitment.toString(),
        index: nextIndex,
      },
    }),
    prisma.semaphoreGroup.update({
      where: { id: poll.groupId },
      data: {
        memberCount: nextIndex + 1,
        merkleRoot: semaphoreGroup.root.toString(),
      },
    }),
  ])
  console.log('Member added, new merkle root:', semaphoreGroup.root.toString().slice(0, 20) + '...')

  // Generate proof
  console.log('\nGenerating proof...')
  const optionIndex = 0 // Vote for Pepperoni
  const startTime = Date.now()

  const proof = await generateProof(
    identity,
    semaphoreGroup,
    optionIndex,
    poll.id
  )
  console.log('Proof generated in', (Date.now() - startTime) / 1000, 'seconds')
  console.log('Nullifier:', proof.nullifier.toString().slice(0, 20) + '...')
  console.log('Message:', proof.message)
  console.log('Scope:', proof.scope.toString().slice(0, 20) + '...')
  console.log('Merkle root:', proof.merkleTreeRoot.toString().slice(0, 20) + '...')

  // Verify proof
  console.log('\nVerifying proof...')
  const valid = await verifyProof(proof)
  console.log('Proof valid:', valid)

  if (!valid) {
    console.log('PROOF INVALID - cannot record vote')
    await prisma.$disconnect()
    return
  }

  // Check merkle root matches
  const updatedGroup = await prisma.semaphoreGroup.findUnique({
    where: { id: poll.groupId }
  })
  console.log('\nDB merkle root:', updatedGroup?.merkleRoot.slice(0, 20) + '...')
  console.log('Proof merkle root:', proof.merkleTreeRoot.toString().slice(0, 20) + '...')
  console.log('Match:', updatedGroup?.merkleRoot === proof.merkleTreeRoot.toString())

  // Record the vote directly
  console.log('\nRecording vote...')
  const nullifier = proof.nullifier.toString()

  await prisma.$transaction([
    prisma.anonVoteNullifier.create({
      data: {
        pollId: poll.id,
        nullifier,
        optionIndex,
      },
    }),
    prisma.anonPollResult.upsert({
      where: {
        pollId_optionIndex: {
          pollId: poll.id,
          optionIndex,
        },
      },
      create: {
        pollId: poll.id,
        optionIndex,
        count: 1,
      },
      update: {
        count: { increment: 1 },
      },
    }),
  ])
  console.log('Vote recorded!')

  // Verify
  const results = await prisma.anonPollResult.findMany({
    where: { pollId: poll.id }
  })
  console.log('\nResults:', results)

  const nullifiers = await prisma.anonVoteNullifier.findMany({
    where: { pollId: poll.id }
  })
  console.log('Nullifiers:', nullifiers.length)

  await prisma.$disconnect()
  console.log('\n=== Test Complete ===')
}

main().catch(console.error)
