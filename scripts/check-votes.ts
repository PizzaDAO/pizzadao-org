import { config } from 'dotenv'
config({ path: '.env.local' })
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

async function main() {
  const results = await prisma.anonPollResult.findMany({
    where: { poll: { question: { contains: 'pizza topping' } } }
  })
  console.log('Vote Results:', results)

  const nullifiers = await prisma.anonVoteNullifier.findMany({
    where: { poll: { question: { contains: 'pizza topping' } } }
  })
  console.log('Votes Cast:', nullifiers.length)

  await prisma.$disconnect()
}

main()
