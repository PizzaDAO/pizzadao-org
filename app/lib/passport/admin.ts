/** Admin guard and input parsing for the passport partner admin routes. */
import { requireAnyRole, type GuardResult } from '@/app/lib/auth-guards'
import { ADMIN_ROLE_IDS } from '@/app/ui/constants'

export function requireAdminAuth(): Promise<GuardResult> {
  return requireAnyRole(ADMIN_ROLE_IDS, 'Admin access required')
}

export { parsePartner } from './partner-input'
