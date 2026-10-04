// Validation for /admin/shop writes (app/lib/shop-admin.ts). The DB rules
// (hide vs delete, stock, grant / remove races, audit rows) run against real
// Postgres in shop-admin.concurrency.test.ts (npm run test:pep-concurrency).
import { describe, it, expect, vi } from 'vitest'

vi.mock('./db', () => ({ prisma: {} }))

import {
  SHOP_LIMITS,
  parseItemInput,
  validateImageUrl,
  validateItemId,
  validateItemName,
  validateQty,
  validateReason,
  validateRequestId,
  validateStockDelta,
} from './shop-admin'
import { ValidationError } from './errors/api-errors'

const base = { name: 'Pizza Box', description: 'A box', price: 50, quantity: -1, image: '', isAvailable: true, isCollectible: false }

describe('parseItemInput', () => {
  it('accepts a valid item and normalizes it', () => {
    expect(parseItemInput({ ...base, name: '  Pizza   Box ', description: '  A box  ' })).toEqual({
      name: 'Pizza Box',
      description: 'A box',
      price: 50,
      quantity: -1,
      image: null,
      isAvailable: true,
      isCollectible: false,
    })
  })

  it('accepts numeric strings for price and stock (form posts)', () => {
    const r = parseItemInput({ ...base, price: '25', quantity: '3' })
    expect(r.price).toBe(25)
    expect(r.quantity).toBe(3)
  })

  it('requires a positive whole-number price', () => {
    for (const price of [0, -5, 1.5, '1e3x', null, undefined, 'abc', SHOP_LIMITS.priceMax + 1]) {
      expect(() => parseItemInput({ ...base, price }), String(price)).toThrow(ValidationError)
    }
  })

  it('stock is -1 (unlimited) or a whole number >= 0', () => {
    expect(parseItemInput({ ...base, quantity: 0 }).quantity).toBe(0)
    expect(parseItemInput({ ...base, quantity: undefined }).quantity).toBe(-1)
    for (const quantity of [-2, 2.5, 'x', SHOP_LIMITS.stockMax + 1]) {
      expect(() => parseItemInput({ ...base, quantity }), String(quantity)).toThrow(ValidationError)
    }
  })

  it('a collectible is never purchasable: isAvailable is forced off', () => {
    const r = parseItemInput({ ...base, isCollectible: true, isAvailable: true })
    expect(r).toMatchObject({ isCollectible: true, isAvailable: false })
  })

  it('enforces length limits', () => {
    expect(() => parseItemInput({ ...base, name: 'x'.repeat(SHOP_LIMITS.nameMax + 1) })).toThrow(/at most/)
    expect(() => parseItemInput({ ...base, description: 'x'.repeat(SHOP_LIMITS.descriptionMax + 1) })).toThrow(/at most/)
    expect(parseItemInput({ ...base, description: 'line 1\nline 2' }).description).toBe('line 1\nline 2')
  })

  it('rejects bad types and non-objects', () => {
    expect(() => parseItemInput(null)).toThrow(ValidationError)
    expect(() => parseItemInput('x')).toThrow(ValidationError)
    expect(() => parseItemInput({ ...base, isAvailable: 'yes' })).toThrow(ValidationError)
    expect(() => parseItemInput({ ...base, name: 42 })).toThrow(ValidationError)
  })
})

describe('validateItemName', () => {
  it('rejects empty, control characters and over-long names', () => {
    expect(() => validateItemName('   ')).toThrow(/required/)
    expect(() => validateItemName('Bad\u0007Name')).toThrow(/invalid/)
    expect(validateItemName('Molto Benny Pin')).toBe('Molto Benny Pin')
  })
})

describe('validateImageUrl', () => {
  it('allows empty, https and site-relative paths', () => {
    expect(validateImageUrl('')).toBeNull()
    expect(validateImageUrl(undefined)).toBeNull()
    expect(validateImageUrl('https://abc.public.blob.vercel-storage.com/shop/1/x.png')).toBe(
      'https://abc.public.blob.vercel-storage.com/shop/1/x.png',
    )
    expect(validateImageUrl('/shop/pin.png')).toBe('/shop/pin.png')
  })

  it('rejects non-https schemes, credentials, protocol-relative, junk and over-long URLs', () => {
    for (const bad of [
      'http://example.com/a.png',
      'javascript:alert(1)',
      'data:image/png;base64,AAAA',
      'https://user:pw@example.com/a.png',
      '//evil.example/a.png',
      'not a url',
      'https://example.com/' + 'a'.repeat(SHOP_LIMITS.imageUrlMax),
    ]) {
      expect(() => validateImageUrl(bad), bad).toThrow(ValidationError)
    }
  })
})

describe('reason / quantity / delta / ids', () => {
  it('reason is required, 3-200 chars, collapsed to one line', () => {
    expect(validateReason('  event\n prize ')).toBe('event prize')
    expect(() => validateReason('')).toThrow(/Reason/)
    expect(() => validateReason('ab')).toThrow(/Reason/)
    expect(() => validateReason('x'.repeat(201))).toThrow(/Reason/)
    expect(() => validateReason(undefined)).toThrow(/Reason/)
  })

  it('quantity is 1..10,000', () => {
    expect(validateQty(1)).toBe(1)
    expect(validateQty('7')).toBe(7)
    for (const q of [0, -1, 1.5, 10_001, 'x']) expect(() => validateQty(q), String(q)).toThrow(ValidationError)
  })

  it('stock delta is a non-zero whole number within 10,000', () => {
    expect(validateStockDelta(5)).toBe(5)
    expect(validateStockDelta(-3)).toBe(-3)
    for (const d of [0, 0.5, 10_001, -10_001, 'x']) expect(() => validateStockDelta(d), String(d)).toThrow(ValidationError)
  })

  it('item id is a positive int (number or digit string)', () => {
    expect(validateItemId(3)).toBe(3)
    expect(validateItemId('42')).toBe(42)
    for (const id of [0, -1, 'abc', '1.5', null, 2_147_483_648]) expect(() => validateItemId(id), String(id)).toThrow(ValidationError)
  })

  it('request id: generated when absent, validated when given', () => {
    expect(validateRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/)
    expect(validateRequestId('abcDEF12-_x')).toBe('abcDEF12-_x')
    for (const r of ['short', 'has space in it', 'x'.repeat(65), 5]) expect(() => validateRequestId(r)).toThrow(ValidationError)
  })
})
