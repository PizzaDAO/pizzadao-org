/**
 * Create a test poll for UI testing
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Creating test data for UI testing...\n')

  // Create a Semaphore group
  const group = await prisma.semaphoreGroup.create({
    data: {
      id: 'ui-test-group',
      name: 'PizzaDAO Members',
      discordRoleId: 'pizzadao-member',
      discordRoleName: 'PizzaDAO Member',
      category: 'ALL',
      merkleRoot: '0',
      memberCount: 0,
    },
  })
  console.log('Created group:', group.name)

  // Create an open poll
  const poll1 = await prisma.anonPoll.create({
    data: {
      question: 'Should PizzaDAO sponsor the 2026 Pizza Hackathon?',
      description: 'This proposal allocates funds from the treasury to sponsor a community hackathon focused on pizza-related blockchain projects.',
      options: ['Yes - Full sponsorship ($5,000)', 'Yes - Partial ($2,500)', 'No - Save for other initiatives'],
      groupId: group.id,
      category: 'TREASURY',
      status: 'OPEN',
      createdBy: 'admin',
      closesAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  })

  await prisma.anonPollResult.createMany({
    data: [
      { pollId: poll1.id, optionIndex: 0, count: 0 },
      { pollId: poll1.id, optionIndex: 1, count: 0 },
      { pollId: poll1.id, optionIndex: 2, count: 0 },
    ],
  })
  console.log('Created open poll:', poll1.question)

  // Create another open poll
  const poll2 = await prisma.anonPoll.create({
    data: {
      question: 'What should be the theme for Pizza Week 2026?',
      description: 'Vote on the theme for our annual celebration.',
      options: ['Global Pizza Styles', 'Pizza & Technology', 'Sustainable Pizza', 'Pizza History'],
      groupId: group.id,
      category: 'SOCIAL',
      status: 'OPEN',
      createdBy: 'admin',
      closesAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
    },
  })

  await prisma.anonPollResult.createMany({
    data: [
      { pollId: poll2.id, optionIndex: 0, count: 0 },
      { pollId: poll2.id, optionIndex: 1, count: 0 },
      { pollId: poll2.id, optionIndex: 2, count: 0 },
      { pollId: poll2.id, optionIndex: 3, count: 0 },
    ],
  })
  console.log('Created open poll:', poll2.question)

  // Create a closed poll with results
  const poll3 = await prisma.anonPoll.create({
    data: {
      question: 'Should we migrate to a new Discord server?',
      description: 'Previous governance vote - completed.',
      options: ['Yes, migrate now', 'Yes, but wait 3 months', 'No, keep current server'],
      groupId: group.id,
      category: 'GOVERNANCE',
      status: 'CLOSED',
      createdBy: 'admin',
    },
  })

  await prisma.anonPollResult.createMany({
    data: [
      { pollId: poll3.id, optionIndex: 0, count: 12 },
      { pollId: poll3.id, optionIndex: 1, count: 8 },
      { pollId: poll3.id, optionIndex: 2, count: 25 },
    ],
  })
  console.log('Created closed poll:', poll3.question)

  console.log('\nTest data created successfully!')
  console.log('Open http://localhost:3001/governance to see the UI')

  await prisma.$disconnect()
}

main().catch(console.error)
