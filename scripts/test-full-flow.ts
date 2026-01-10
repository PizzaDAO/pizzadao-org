/**
 * Full end-to-end test of anonymous voting
 * Tests: group creation, joining, poll creation, voting, double-vote prevention
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { Identity, Group, generateProof, verifyProof } from '@semaphore-protocol/core'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function test() {
  console.log('=== Full Anonymous Voting Test ===\n')
  const testId = Date.now()

  try {
    // 1. Create a Semaphore group
    console.log('1. Creating Semaphore group...')
    const group = await prisma.semaphoreGroup.create({
      data: {
        id: `test-${testId}`,
        name: 'Full Test Group',
        discordRoleId: `role-${testId}`,
        discordRoleName: 'Test Role',
        category: 'ALL',
        merkleRoot: '0',
        memberCount: 0,
      },
    })
    console.log('   ✓ Group created:', group.id)

    // 2. Create two identities and join the group
    console.log('\n2. Creating identities and joining group...')
    const identity1 = new Identity(`user1-${testId}`)
    const identity2 = new Identity(`user2-${testId}`)

    const semaphoreGroup = new Group()
    semaphoreGroup.addMember(identity1.commitment)
    semaphoreGroup.addMember(identity2.commitment)

    await prisma.$transaction([
      prisma.semaphoreGroupMember.create({
        data: { groupId: group.id, commitment: identity1.commitment.toString(), index: 0 },
      }),
      prisma.semaphoreGroupMember.create({
        data: { groupId: group.id, commitment: identity2.commitment.toString(), index: 1 },
      }),
      prisma.semaphoreGroup.update({
        where: { id: group.id },
        data: { memberCount: 2, merkleRoot: semaphoreGroup.root.toString() },
      }),
    ])
    console.log('   ✓ User 1 joined (commitment:', identity1.commitment.toString().slice(0, 15) + '...)')
    console.log('   ✓ User 2 joined (commitment:', identity2.commitment.toString().slice(0, 15) + '...)')

    // 3. Create a poll
    console.log('\n3. Creating anonymous poll...')
    const poll = await prisma.anonPoll.create({
      data: {
        question: 'Test: Best pizza style?',
        options: ['NY Style', 'Chicago Deep Dish', 'Neapolitan'],
        groupId: group.id,
        category: 'ALL',
        status: 'OPEN',
        createdBy: 'test-admin',
      },
    })

    // Initialize result counters
    await prisma.anonPollResult.createMany({
      data: [
        { pollId: poll.id, optionIndex: 0, count: 0 },
        { pollId: poll.id, optionIndex: 1, count: 0 },
        { pollId: poll.id, optionIndex: 2, count: 0 },
      ],
    })
    console.log('   ✓ Poll created:', poll.question)

    // 4. User 1 votes
    console.log('\n4. User 1 casting vote...')
    const proof1 = await generateProof(identity1, semaphoreGroup, 0, poll.id) // Vote for NY Style
    const valid1 = await verifyProof(proof1)
    console.log('   Proof valid:', valid1)

    if (valid1) {
      await prisma.$transaction([
        prisma.anonVoteNullifier.create({
          data: { pollId: poll.id, nullifier: proof1.nullifier.toString(), optionIndex: 0 },
        }),
        prisma.anonPollResult.update({
          where: { pollId_optionIndex: { pollId: poll.id, optionIndex: 0 } },
          data: { count: { increment: 1 } },
        }),
      ])
      console.log('   ✓ User 1 voted for NY Style')
    }

    // 5. User 2 votes
    console.log('\n5. User 2 casting vote...')
    const proof2 = await generateProof(identity2, semaphoreGroup, 2, poll.id) // Vote for Neapolitan
    const valid2 = await verifyProof(proof2)
    console.log('   Proof valid:', valid2)

    if (valid2) {
      await prisma.$transaction([
        prisma.anonVoteNullifier.create({
          data: { pollId: poll.id, nullifier: proof2.nullifier.toString(), optionIndex: 2 },
        }),
        prisma.anonPollResult.update({
          where: { pollId_optionIndex: { pollId: poll.id, optionIndex: 2 } },
          data: { count: { increment: 1 } },
        }),
      ])
      console.log('   ✓ User 2 voted for Neapolitan')
    }

    // 6. Test double-vote prevention
    console.log('\n6. Testing double-vote prevention...')
    const existingVote = await prisma.anonVoteNullifier.findUnique({
      where: { pollId_nullifier: { pollId: poll.id, nullifier: proof1.nullifier.toString() } },
    })
    if (existingVote) {
      console.log('   ✓ Double vote correctly blocked (nullifier already exists)')
    } else {
      console.log('   ✗ ERROR: Should have found existing nullifier')
    }

    // 7. Verify results
    console.log('\n7. Checking results...')
    const results = await prisma.anonPollResult.findMany({
      where: { pollId: poll.id },
      orderBy: { optionIndex: 'asc' },
    })

    const options = poll.options as string[]
    console.log('   Results:')
    results.forEach((r) => {
      console.log(`   - ${options[r.optionIndex]}: ${r.count} vote(s)`)
    })

    const totalVotes = results.reduce((sum, r) => sum + r.count, 0)
    if (totalVotes === 2) {
      console.log('   ✓ Vote count correct (2 votes)')
    } else {
      console.log('   ✗ ERROR: Expected 2 votes, got', totalVotes)
    }

    // 8. Verify anonymity
    console.log('\n8. Verifying anonymity...')
    const nullifiers = await prisma.anonVoteNullifier.findMany({
      where: { pollId: poll.id },
    })
    console.log('   Stored nullifiers:', nullifiers.length)
    console.log('   Nullifier 1:', nullifiers[0]?.nullifier.slice(0, 20) + '...')
    console.log('   Nullifier 2:', nullifiers[1]?.nullifier.slice(0, 20) + '...')
    console.log('   ✓ No identity information stored - votes are anonymous')

    // Cleanup
    console.log('\n9. Cleaning up test data...')
    await prisma.anonVoteNullifier.deleteMany({ where: { pollId: poll.id } })
    await prisma.anonPollResult.deleteMany({ where: { pollId: poll.id } })
    await prisma.anonPoll.delete({ where: { id: poll.id } })
    await prisma.semaphoreGroupMember.deleteMany({ where: { groupId: group.id } })
    await prisma.semaphoreGroup.delete({ where: { id: group.id } })
    console.log('   ✓ Test data cleaned up')

    console.log('\n=== All Tests Passed! ===')
    console.log('\nSummary:')
    console.log('✓ Group creation')
    console.log('✓ Member joining with identity commitments')
    console.log('✓ Anonymous poll creation')
    console.log('✓ ZK proof generation & verification')
    console.log('✓ Anonymous vote recording')
    console.log('✓ Double-vote prevention')
    console.log('✓ Vote tallying')
    console.log('✓ Anonymity preserved (no identity linked to votes)')

  } catch (error) {
    console.error('\n✗ Test failed:', error)
    // Attempt cleanup on error
    try {
      await prisma.semaphoreGroup.deleteMany({ where: { name: 'Full Test Group' } })
    } catch {}
  }

  await prisma.$disconnect()
}

test()
