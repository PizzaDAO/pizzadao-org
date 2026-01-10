/**
 * End-to-end API test for anonymous voting
 *
 * Run with: npx tsx scripts/test-api-voting.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })
import { Identity, Group, generateProof } from '@semaphore-protocol/core'
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const connectionString = process.env.DATABASE_URL!
const adapter = new PrismaNeon({ connectionString })
const prisma = new PrismaClient({ adapter })

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000'

async function waitForServer(maxAttempts = 30): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/api/governance/polls`)
      if (res.status !== 502 && res.status !== 503) return true
    } catch {
      // Server not ready
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  return false
}

async function testAPIVoting() {
  console.log('=== End-to-End API Voting Test ===\n')

  // Wait for server
  console.log('0. Waiting for server...')
  const serverReady = await waitForServer()
  if (!serverReady) {
    console.log('   Server not available, skipping API tests')
    return
  }
  console.log('   ✓ Server ready\n')

  // Step 1: Create a test Semaphore group in the database
  console.log('1. Creating test Semaphore group...')
  const testGroupId = `test-group-${Date.now()}`

  const group = await prisma.semaphoreGroup.create({
    data: {
      id: testGroupId,
      name: 'Test Voting Group',
      discordRoleId: 'test-role-123',
      discordRoleName: 'Test Role',
      category: 'ALL',
      merkleRoot: '0', // Will be updated when members join
      memberCount: 0,
    },
  })
  console.log(`   Group ID: ${group.id}`)
  console.log('   ✓ Group created\n')

  // Step 2: Generate identity and join the group
  console.log('2. Generating identity and joining group...')
  const identity = new Identity('test-secret-' + Date.now())

  // Join via API
  const joinResponse = await fetch(`${BASE_URL}/api/governance/groups/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      groupId: testGroupId,
      commitment: identity.commitment.toString(),
      discordId: 'test-user-123',
    }),
  })

  if (!joinResponse.ok) {
    const error = await joinResponse.json()
    console.log(`   ✗ Failed to join: ${JSON.stringify(error)}`)
    await cleanup(testGroupId)
    process.exit(1)
  }

  const joinResult = await joinResponse.json()
  console.log(`   Member index: ${joinResult.index}`)
  console.log(`   New merkle root: ${joinResult.merkleRoot.slice(0, 20)}...`)
  console.log('   ✓ Joined group\n')

  // Step 3: Create a test poll
  console.log('3. Creating test poll...')
  const pollResponse = await fetch(`${BASE_URL}/api/governance/polls`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      question: 'Test Poll: What is your favorite pizza topping?',
      description: 'This is a test poll for anonymous voting',
      options: ['Pepperoni', 'Mushrooms', 'Pineapple'],
      groupId: testGroupId,
      category: 'ALL',
      createdBy: 'test-admin',
    }),
  })

  if (!pollResponse.ok) {
    const error = await pollResponse.json()
    console.log(`   ✗ Failed to create poll: ${JSON.stringify(error)}`)
    await cleanup(testGroupId)
    process.exit(1)
  }

  const poll = await pollResponse.json()
  console.log(`   Poll ID: ${poll.id}`)
  console.log(`   Question: ${poll.question}`)
  console.log('   ✓ Poll created\n')

  // Step 4: Open the poll for voting
  console.log('4. Opening poll for voting...')
  await prisma.anonPoll.update({
    where: { id: poll.id },
    data: { status: 'OPEN' },
  })
  console.log('   ✓ Poll opened\n')

  // Step 5: Get the updated group with member for proof generation
  console.log('5. Preparing to vote...')
  const updatedGroup = await prisma.semaphoreGroup.findUnique({
    where: { id: testGroupId },
    include: { members: { orderBy: { index: 'asc' } } },
  })

  // Reconstruct Semaphore group
  const semaphoreGroup = new Group()
  for (const member of updatedGroup!.members) {
    semaphoreGroup.addMember(BigInt(member.commitment))
  }
  console.log(`   Group has ${semaphoreGroup.members.length} member(s)`)
  console.log('   ✓ Ready to vote\n')

  // Step 6: Generate vote proof and cast vote
  console.log('6. Generating ZK proof and casting vote...')
  const optionIndex = 2 // Vote for "Pineapple"

  const proof = await generateProof(
    identity,
    semaphoreGroup,
    optionIndex,
    poll.id
  )
  console.log(`   Vote choice: ${optionIndex} (${poll.options[optionIndex]})`)
  console.log(`   Nullifier: ${proof.nullifier.toString().slice(0, 20)}...`)

  const voteResponse = await fetch(`${BASE_URL}/api/governance/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pollId: poll.id,
      proof: {
        merkleTreeDepth: proof.merkleTreeDepth,
        merkleTreeRoot: proof.merkleTreeRoot.toString(),
        nullifier: proof.nullifier.toString(),
        message: proof.message.toString(),
        scope: proof.scope.toString(),
        points: proof.points,
      },
    }),
  })

  if (!voteResponse.ok) {
    const error = await voteResponse.json()
    console.log(`   ✗ Failed to vote: ${JSON.stringify(error)}`)
    await cleanup(testGroupId)
    process.exit(1)
  }

  const voteResult = await voteResponse.json()
  console.log(`   Result: ${voteResult.message}`)
  console.log('   ✓ Vote cast anonymously\n')

  // Step 7: Try to vote again (should fail - double vote prevention)
  console.log('7. Testing double-vote prevention...')
  const doubleVoteResponse = await fetch(`${BASE_URL}/api/governance/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pollId: poll.id,
      proof: {
        merkleTreeDepth: proof.merkleTreeDepth,
        merkleTreeRoot: proof.merkleTreeRoot.toString(),
        nullifier: proof.nullifier.toString(),
        message: proof.message.toString(),
        scope: proof.scope.toString(),
        points: proof.points,
      },
    }),
  })

  if (doubleVoteResponse.ok) {
    console.log('   ✗ Double vote should have been rejected!')
    await cleanup(testGroupId)
    process.exit(1)
  }

  const doubleVoteError = await doubleVoteResponse.json()
  console.log(`   Rejected: ${doubleVoteError.error}`)
  console.log('   ✓ Double vote prevented\n')

  // Step 8: Verify vote was recorded
  console.log('8. Verifying vote in database...')
  const pollResults = await prisma.anonPollResult.findMany({
    where: { pollId: poll.id },
    orderBy: { optionIndex: 'asc' },
  })

  console.log('   Vote counts:')
  poll.options.forEach((option: string, index: number) => {
    const result = pollResults.find(r => r.optionIndex === index)
    console.log(`   - ${option}: ${result?.count || 0}`)
  })

  const pineappleVotes = pollResults.find(r => r.optionIndex === 2)?.count || 0
  if (pineappleVotes !== 1) {
    console.log('   ✗ Vote count incorrect!')
    await cleanup(testGroupId)
    process.exit(1)
  }
  console.log('   ✓ Vote recorded correctly\n')

  // Cleanup
  await cleanup(testGroupId)

  console.log('=== All API Tests Passed! ===\n')
  console.log('Summary:')
  console.log('- Group creation: ✓')
  console.log('- Group joining: ✓')
  console.log('- Poll creation: ✓')
  console.log('- Anonymous voting: ✓')
  console.log('- Double-vote prevention: ✓')
  console.log('- Vote recording: ✓')
}

async function cleanup(groupId: string) {
  console.log('Cleaning up test data...')
  try {
    // Delete in order due to foreign keys
    await prisma.anonVoteNullifier.deleteMany({
      where: { poll: { groupId } },
    })
    await prisma.anonPollResult.deleteMany({
      where: { poll: { groupId } },
    })
    await prisma.anonPoll.deleteMany({
      where: { groupId },
    })
    await prisma.semaphoreGroupMember.deleteMany({
      where: { groupId },
    })
    await prisma.semaphoreGroup.deleteMany({
      where: { id: groupId },
    })
    console.log('   ✓ Cleanup complete\n')
  } catch (error) {
    console.log('   Cleanup error:', error)
  }
  await prisma.$disconnect()
}

testAPIVoting().catch(async (error) => {
  console.error('Test failed:', error)
  await prisma.$disconnect()
  process.exit(1)
})
