import { vi } from 'vitest'

// Deep-mock factory: each Prisma model gets the standard CRUD methods
function createModelMock() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  }
}

export const prisma = {
  economy: createModelMock(),
  transaction: createModelMock(),
  user: createModelMock(),
  bounty: createModelMock(),
  shopItem: createModelMock(),
  inventory: createModelMock(),
  job: createModelMock(),
  jobAssignment: createModelMock(),
  jobCycle: createModelMock(),
  articleReaction: createModelMock(),
  $transaction: vi.fn(),
}
