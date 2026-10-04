// Shop admin limits, shared by the server (app/lib/shop-admin.ts) and the
// /admin/shop client form (no server imports here).

export const SHOP_LIMITS = {
  nameMax: 60,
  descriptionMax: 500,
  imageUrlMax: 500,
  priceMax: 1_000_000,
  stockMax: 1_000_000,
  /** Largest single grant / removal / stock adjustment. */
  qtyMax: 10_000,
  /** Same bounds as /add-money reasons (ADMIN_REASON_MIN / MAX in pep-admin.ts). */
  reasonMin: 3,
  reasonMax: 200,
} as const
