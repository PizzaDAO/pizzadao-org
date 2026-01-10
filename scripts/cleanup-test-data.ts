import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function cleanup() {
  console.log('Cleaning up test data...')

  // Find all test groups
  const testGroups = await prisma.semaphoreGroup.findMany({
    where: { name: 'Test Voting Group' }
  })

  for (const group of testGroups) {
    console.log('Cleaning group:', group.id)

    // Delete in order due to foreign keys
    await prisma.anonVoteNullifier.deleteMany({
      where: { poll: { groupId: group.id } }
    })
    await prisma.anonPollResult.deleteMany({
      where: { poll: { groupId: group.id } }
    })
    await prisma.anonPoll.deleteMany({
      where: { groupId: group.id }
    })
    await prisma.semaphoreGroupMember.deleteMany({
      where: { groupId: group.id }
    })
    await prisma.semaphoreGroup.delete({
      where: { id: group.id }
    })
  }

  console.log('Cleaned up', testGroups.length, 'test group(s)')
  await prisma.$disconnect()
}

cleanup().catch(console.error)
