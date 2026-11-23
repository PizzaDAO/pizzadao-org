/**
 * Proof of Pizza redemption codes (plans/proof-of-pizza-codes.md). Everything is off by default:
 * itemId 0 means no code is minted, so deploying changes nothing. This file imports only types from
 * ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const itemId: SettingDef<number> = {
  key: 'proofOfPizza.itemId',
  area: 'features',
  label: 'Proof of Pizza shop item',
  help: 'The id of the shop item whose units each carry a one-time 4-character code (find the id in /admin/shop). 0 = off: no codes are issued. The id, not the name, so renaming the item changes nothing.',
  schema: z.number().int().min(0).max(2_147_483_647),
  default: 0,
  onReadFailure: 'lastKnownGood',
  input: { type: 'int', min: 0, max: 2_147_483_647 },
  confirm: (from, to) => (to !== from && to > 0 ? 'Codes will be issued for the new item: every member who holds it gets one per unit the next time they open their codes.' : null),
}

const dmOnPurchase: SettingDef<boolean> = {
  key: 'proofOfPizza.dmOnPurchase',
  area: 'features',
  label: 'DM the code when it is bought',
  help: 'Send the buyer a Discord DM with their new code and the steps to use it. The PROOF_OF_PIZZA_DM_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Members who buy the Proof of Pizza item will get their code by Discord DM.' : null),
}

const siteUrl: SettingDef<string> = {
  key: 'proofOfPizza.siteUrl',
  area: 'features',
  label: 'Proof of Pizza site address',
  help: 'Where members redeem a code. Shown in the steps on their inventory and in the DM.',
  schema: z
    .string()
    .trim()
    .max(300)
    .refine((v) => {
      if (v === '') return true
      try {
        const u = new URL(v)
        return u.protocol === 'https:' && !u.username && !u.password && !!u.hostname
      } catch {
        return false
      }
    }, 'Use a full https:// address, or leave empty')
    .transform((v) => (v === '' ? '' : new URL(v).href)),
  default: 'https://proofof.pizza',
  onReadFailure: { value: 'https://proofof.pizza' },
  input: { type: 'url', maxLength: 300 },
}

export const PROOF_OF_PIZZA_SETTINGS = {
  'proofOfPizza.itemId': itemId,
  'proofOfPizza.dmOnPurchase': dmOnPurchase,
  'proofOfPizza.siteUrl': siteUrl,
} as const satisfies Record<string, SettingDef>
