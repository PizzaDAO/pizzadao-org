// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/db', () => {
  const prisma = {
    paymentRequest: { findUnique: vi.fn(), update: vi.fn() },
    paymentAttachment: { count: vi.fn(), create: vi.fn() },
    $transaction: vi.fn(),
  }
  prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(prisma))
  return { prisma }
})
vi.mock('@/app/lib/private-blob-upload', () => ({
  PrivateUploadError: class extends Error {},
  uploadPrivate: vi.fn(async () => ({ pathname: 'payments/req1/x.png', sha256: 'h', sizeBytes: 4, mime: 'image/png' })),
}))
vi.mock('./checks', () => ({ evaluateRequest: vi.fn(async () => null) }))

import { prisma } from '@/app/lib/db'
import { addAttachment } from './attachments'
import { evaluateRequest } from './checks'

const m = (f: unknown) => f as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  m(prisma.paymentRequest.findUnique).mockResolvedValue({ id: 'req1', status: 'RECEIVED' })
  m(prisma.paymentAttachment.count).mockResolvedValue(0)
  m(prisma.paymentAttachment.create).mockResolvedValue({ id: 'att1' })
})

describe('addAttachment', () => {
  it('stores the file and clears the request\'s check in ONE transaction, then re-checks', async () => {
    const order: string[] = []
    m(prisma.$transaction).mockImplementationOnce(async (fn: (t: unknown) => unknown) => {
      order.push('begin')
      const r = await fn(prisma)
      order.push('commit')
      return r
    })
    m(prisma.paymentAttachment.create).mockImplementation(async () => (order.push('attachment'), { id: 'att1' }))
    m(prisma.paymentRequest.update).mockImplementation(async () => (order.push('clear'), {}))
    m(evaluateRequest).mockImplementation(async () => (order.push('check'), null))

    const r = await addAttachment({ requestId: 'req1', bytes: new Uint8Array([1, 2, 3, 4]), kind: 'RECEIPT', uploadedBy: '100000000000000001' })
    expect(r).toMatchObject({ ok: true, id: 'att1' })
    // The update bumps updatedAt, so a check that is running right now conflicts and repeats; approval stays
    // blocked (checkedAt null) until a check has run that saw the file.
    expect(order).toEqual(['begin', 'attachment', 'clear', 'commit', 'check'])
    expect(m(prisma.paymentRequest.update).mock.calls[0][0]).toEqual({ where: { id: 'req1' }, data: { checkedAt: null } })
  })

  it('refuses files on a closed request without touching anything', async () => {
    m(prisma.paymentRequest.findUnique).mockResolvedValue({ id: 'req1', status: 'PAID' })
    const r = await addAttachment({ requestId: 'req1', bytes: new Uint8Array([1]), kind: 'RECEIPT', uploadedBy: 'x' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(prisma.paymentAttachment.create).not.toHaveBeenCalled()
  })
})
