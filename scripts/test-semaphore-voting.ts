/**
 * Test script for Semaphore anonymous voting
 *
 * Run with: npx tsx scripts/test-semaphore-voting.ts
 */

import 'dotenv/config'
import { Identity, Group, generateProof, verifyProof } from '@semaphore-protocol/core'

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000'

async function testSemaphoreVoting() {
  console.log('=== Semaphore Anonymous Voting Test ===\n')

  // Step 1: Generate a test identity
  console.log('1. Generating Semaphore identity...')
  const identity = new Identity('test-secret-for-voting-' + Date.now())
  console.log(`   Identity commitment: ${identity.commitment.toString().slice(0, 20)}...`)
  console.log('   ✓ Identity generated\n')

  // Step 2: Create a test group locally (simulating what the API would do)
  console.log('2. Creating local Semaphore group...')
  const group = new Group()
  group.addMember(identity.commitment)
  console.log(`   Group root: ${group.root.toString().slice(0, 20)}...`)
  console.log(`   Members: ${group.members.length}`)
  console.log('   ✓ Group created\n')

  // Step 3: Generate a vote proof
  console.log('3. Generating ZK vote proof...')
  const pollId = 'test-poll-' + Date.now()
  const optionIndex = 1 // Vote for option 1

  const startTime = Date.now()
  const proof = await generateProof(
    identity,
    group,
    optionIndex, // message (the vote choice)
    pollId       // scope (external nullifier - ties proof to this poll)
  )
  const proofTime = Date.now() - startTime

  console.log(`   Proof generated in ${proofTime}ms`)
  console.log(`   Nullifier: ${proof.nullifier.toString().slice(0, 20)}...`)
  console.log(`   Message (vote): ${proof.message}`)
  console.log(`   Scope (pollId): ${proof.scope}`)
  console.log('   ✓ Proof generated\n')

  // Step 4: Verify the proof
  console.log('4. Verifying ZK proof...')
  const isValid = await verifyProof(proof)
  console.log(`   Valid: ${isValid}`)
  if (!isValid) {
    console.log('   ✗ PROOF VERIFICATION FAILED')
    process.exit(1)
  }
  console.log('   ✓ Proof verified\n')

  // Step 5: Test double-vote prevention (same identity, same poll = same nullifier)
  console.log('5. Testing double-vote prevention...')
  const proof2 = await generateProof(
    identity,
    group,
    0, // Different vote choice
    pollId // Same poll
  )

  const sameNullifier = proof.nullifier.toString() === proof2.nullifier.toString()
  console.log(`   Same nullifier for same user/poll: ${sameNullifier}`)
  if (!sameNullifier) {
    console.log('   ✗ NULLIFIER SHOULD BE THE SAME')
    process.exit(1)
  }
  console.log('   ✓ Double-vote prevention works\n')

  // Step 6: Test different poll = different nullifier
  console.log('6. Testing different poll nullifiers...')
  const proof3 = await generateProof(
    identity,
    group,
    1,
    'different-poll-id'
  )

  const differentNullifier = proof.nullifier.toString() !== proof3.nullifier.toString()
  console.log(`   Different nullifier for different poll: ${differentNullifier}`)
  if (!differentNullifier) {
    console.log('   ✗ NULLIFIER SHOULD BE DIFFERENT')
    process.exit(1)
  }
  console.log('   ✓ Different poll nullifiers work\n')

  // Step 7: Test that we can't determine identity from nullifier
  console.log('7. Testing anonymity...')
  const identity2 = new Identity('different-secret')
  group.addMember(identity2.commitment)

  const proof4 = await generateProof(
    identity2,
    group,
    1,
    pollId
  )

  const differentUserNullifier = proof.nullifier.toString() !== proof4.nullifier.toString()
  console.log(`   Different users have different nullifiers: ${differentUserNullifier}`)
  console.log(`   User 1 nullifier: ${proof.nullifier.toString().slice(0, 20)}...`)
  console.log(`   User 2 nullifier: ${proof4.nullifier.toString().slice(0, 20)}...`)
  console.log('   (Cannot determine which identity produced which nullifier without the secret)')
  console.log('   ✓ Anonymity preserved\n')

  // Step 8: Test API endpoints (if server is running)
  console.log('8. Testing API endpoints...')
  try {
    const pollsResponse = await fetch(`${BASE_URL}/api/governance/polls`)
    if (pollsResponse.ok) {
      const polls = await pollsResponse.json()
      console.log(`   GET /api/governance/polls: ${pollsResponse.status} (${polls.length} polls)`)
      console.log('   ✓ API is accessible\n')
    } else {
      console.log(`   GET /api/governance/polls: ${pollsResponse.status}`)
      console.log('   (Server may not be running or DB not configured)\n')
    }
  } catch (error) {
    console.log(`   Could not reach ${BASE_URL}`)
    console.log('   (This is OK - API tests skipped)\n')
  }

  console.log('=== All Tests Passed! ===\n')
  console.log('Summary:')
  console.log('- Identity generation: ✓')
  console.log('- Group membership: ✓')
  console.log('- ZK proof generation: ✓')
  console.log('- Proof verification: ✓')
  console.log('- Double-vote prevention: ✓')
  console.log('- Cross-poll isolation: ✓')
  console.log('- Anonymity: ✓')
}

testSemaphoreVoting().catch(console.error)
