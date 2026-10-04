// /admin/shop server gate: Access Denied unless the viewer may manage the shop.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/app/lib/session', () => ({ getSession: vi.fn() }))
vi.mock('@/app/lib/shop-admin-auth', () => ({ canManageShop: vi.fn() }))
vi.mock('@/app/lib/shop-admin', () => ({ getShopAdminOverview: vi.fn() }))
vi.mock('@/app/lib/shop-admin-people', () => ({ labelPeople: vi.fn().mockResolvedValue({}), eventPeople: () => [] }))

import AdminShopPage from './page'
import { getSession } from '@/app/lib/session'
import { canManageShop } from '@/app/lib/shop-admin-auth'
import { getShopAdminOverview } from '@/app/lib/shop-admin'

const item = {
  id: 1,
  name: 'Rare Pizza Box',
  description: 'Limited run',
  price: 500,
  quantity: -1,
  image: null,
  isAvailable: true,
  isCollectible: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  sold: 12,
  held: 9,
  pending: 2,
  canDelete: false,
}
const pin = { ...item, id: 2, name: 'Molto Benny Pin', isAvailable: false, isCollectible: true, sold: 0, held: 3, pending: 0 }

beforeEach(() => vi.clearAllMocks())

describe('/admin/shop gate', () => {
  it('shows Access Denied to members who are not shop admins, without loading shop data', async () => {
    vi.mocked(getSession).mockResolvedValue({ discordId: '811111111111111111', createdAt: Date.now() })
    vi.mocked(canManageShop).mockResolvedValue(false)
    render(await AdminShopPage())
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
    expect(getShopAdminOverview).not.toHaveBeenCalled()
  })

  it('asks logged-out visitors to log in', async () => {
    vi.mocked(getSession).mockResolvedValue(null)
    vi.mocked(canManageShop).mockResolvedValue(false)
    render(await AdminShopPage())
    expect(screen.getByText('Access Denied')).toBeInTheDocument()
    expect(screen.getByText(/log in with Discord/i)).toBeInTheDocument()
  })

  it('renders the item list for shop admins (∞ stock, sold, held, badges)', async () => {
    vi.mocked(getSession).mockResolvedValue({ discordId: '811111111111111111', createdAt: Date.now() })
    vi.mocked(canManageShop).mockResolvedValue(true)
    vi.mocked(getShopAdminOverview).mockResolvedValue({ items: [item, pin], events: [] } as never)
    render(await AdminShopPage())
    expect(screen.getByRole('heading', { name: 'Shop admin' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rare Pizza Box' })).toBeInTheDocument()
    expect(screen.getAllByText('∞')).toHaveLength(2)
    expect(screen.getByText('On sale')).toBeInTheDocument()
    expect(screen.getByText('Collectible')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('+2 pending')).toBeInTheDocument()
    // Items with history can't be deleted (no Delete button), only hidden.
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Hide/ })).toBeInTheDocument()
  })
})
