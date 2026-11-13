/**
 * Moving the member app from app.pizzadao.org to the pizzadao.org apex (plans/pizzadao-org-to-vercel.md,
 * Phase 3). Everything is off or "temporary" until the cutover. This file imports only types from ./registry.
 */
import { z } from 'zod'
import type { SettingDef } from './registry'

const hostRedirectEnabled: SettingDef<boolean> = {
  key: 'site.hostRedirectEnabled',
  area: 'features',
  label: 'Redirect the old app host to the main site',
  help: 'Page requests to app.pizzadao.org are redirected to the same path on the main site (query string kept). /api/*, /_next/* and /.well-known/* are never redirected, so webhooks, unsubscribe links and the recorder keep working. Only acts on a build whose public site URL is already the main site; before the cutover it does nothing even when on. The SITE_HOST_REDIRECT_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Every page link on the old app host will redirect to the main site.' : null),
}

const hostRedirectPermanent: SettingDef<boolean> = {
  key: 'site.hostRedirectPermanent',
  area: 'features',
  label: 'Make the old-host redirect permanent (308)',
  help: 'Off: the redirect is temporary (307) and browsers do not cache it, so the move can be rolled back. Turn on after the move has run cleanly for a while.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
  confirm: (from, to) => (to && !from ? 'Browsers cache a permanent redirect, which makes rolling back the move slow for returning visitors.' : null),
}

const sessionBridgeEnabled: SettingDef<boolean> = {
  key: 'site.sessionBridgeEnabled',
  area: 'features',
  label: 'Keep members signed in across the host move',
  help: 'When the old-host redirect sends a signed-in member to the main site, hand their login over with a short-lived one-time token so they are not asked to sign in again. Does nothing unless the old-host redirect is on. The SITE_SESSION_BRIDGE_ENABLED env var set to off always wins; on preview deploys only the env var counts.',
  schema: z.boolean(),
  default: false,
  onReadFailure: { value: false },
  input: { type: 'bool' },
}

export const SITE_SETTINGS = {
  'site.hostRedirectEnabled': hostRedirectEnabled,
  'site.hostRedirectPermanent': hostRedirectPermanent,
  'site.sessionBridgeEnabled': sessionBridgeEnabled,
} as const satisfies Record<string, SettingDef>
