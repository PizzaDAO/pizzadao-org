import { vi } from 'vitest'

// Deep-mock factory: each Prisma model gets the standard CRUD methods
function createModelMock() {
  return {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
  }
}

export const prisma = {
  economy: createModelMock(),
  transaction: createModelMock(),
  user: createModelMock(),
  bounty: createModelMock(),
  bountyComment: createModelMock(),
  notification: createModelMock(),
  shopItem: createModelMock(),
  inventory: createModelMock(),
  itemGrant: createModelMock(),
  job: createModelMock(),
  jobAssignment: createModelMock(),
  jobCycle: createModelMock(),
  articleReaction: createModelMock(),
  mission: createModelMock(),
  missionCompletion: createModelMock(),
  missionReviewEvent: createModelMock(),
  xAccount: createModelMock(),
  callAttendance: createModelMock(),
  memberWallet: createModelMock(),
  vouch: createModelMock(),
  callRecording: createModelMock(),
  callAgendaPost: createModelMock(),
  callSpeaker: createModelMock(),
  recordingOptOut: createModelMock(),
  crewDraft: createModelMock(),
  appSetting: createModelMock(),
  appSettingChange: createModelMock(),
  followUp: createModelMock(),
  followUpEvent: createModelMock(),
  messagingOptOut: createModelMock(),
  telegramAccount: createModelMock(),
  telegramReach: createModelMock(),
  memberProfileExtras: createModelMock(),
  $queryRaw: vi.fn(),
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}

// Default: run an interactive transaction callback against the same mock; array form resolves each op.
prisma.$transaction.mockImplementation((async (arg: unknown) =>
  typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(prisma) : Promise.all(arg as unknown[])) as never)
