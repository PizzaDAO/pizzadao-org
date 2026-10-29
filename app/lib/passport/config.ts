/**
 * Pizza Passport configuration. The on/off switch is the DB setting `passport.enabled` (default off);
 * the env var PASSPORT_ENABLED is only a kill switch: "off" (or 0/false) wins over the setting.
 */
import { loadSettings } from '@/app/lib/settings'

export interface PassportConfig {
  enabled: boolean
  radiusM: number
  maxAccuracyM: number
  maxNewStampsPerDay: number
  revisitCooldownHours: number
  publicDelayHours: number
  maxTravelKmPerHour: number
  newAccountDays: number
}

export function killSwitchOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.PASSPORT_ENABLED?.trim().toLowerCase()
  return v === 'off' || v === '0' || v === 'false'
}

export async function loadPassportConfig(env: NodeJS.ProcessEnv = process.env): Promise<PassportConfig> {
  const s = await loadSettings()
  return {
    enabled: !killSwitchOn(env) && !s.readFailed && s.get('passport.enabled') === 1,
    radiusM: s.get('passport.checkInRadiusM'),
    maxAccuracyM: s.get('passport.maxAccuracyM'),
    maxNewStampsPerDay: s.get('passport.maxNewStampsPerDay'),
    revisitCooldownHours: s.get('passport.revisitCooldownHours'),
    publicDelayHours: s.get('passport.publicDelayHours'),
    maxTravelKmPerHour: s.get('passport.maxTravelKmPerHour'),
    newAccountDays: s.get('missions.newAccountDays'),
  }
}
