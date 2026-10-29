/** Admin guard for the passport partner admin routes (guild admins). */
import { requireAdmin } from '@/app/lib/auth-guards'

export const requireAdminAuth = requireAdmin
export { parsePartner } from './partner-input'
