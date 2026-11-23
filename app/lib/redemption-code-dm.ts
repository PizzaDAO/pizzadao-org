/**
 * DM a member their new Proof of Pizza code(s) right after the purchase (plans/proof-of-pizza-codes.md).
 * Off unless the setting proofOfPizza.dmOnPurchase is on (env PROOF_OF_PIZZA_DM_ENABLED set to off
 * always wins). Best effort and never throws: a closed DM is logged and not retried; dmSentAt is set
 * only on success so a later run never double-sends.
 */
import { prisma } from './db'
import { getSetting } from './settings'
import { toggleEnabled } from './settings/toggles'
import { isDmClosed, sendDiscordDm } from './followups/discord-dm'
import { loadOwnerContext } from './followups/store'
import { DEFAULT_LOCALE, isSupportedLocale } from './i18n/locales'
import { SITE_HOST } from './site-url'

type DmMessages = Record<'intro' | 'codes' | 'codesMany' | 'steps' | 'outro', string>

const fill = (tpl: string, vars: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)

async function dmMessages(locale: string): Promise<DmMessages> {
  const l = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE
  try {
    return (await import(`../../messages/${l}.json`)).default.proofOfPizza.dm
  } catch {
    return (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default.proofOfPizza.dm
  }
}

/** The DM text. Codes are bold; no pings. */
export async function renderCodeDm(codes: string[], locale: string | null | undefined, siteUrl: string): Promise<string> {
  const m = await dmMessages((locale ?? DEFAULT_LOCALE).slice(0, 2).toLowerCase())
  const list = codes.map((c) => `**${c}**`).join(', ')
  const site = siteUrl.replace(/\/$/, '') || 'proofof.pizza'
  return [
    m.intro,
    '',
    fill(codes.length === 1 ? m.codes : m.codesMany, { codes: list }),
    '',
    fill(m.steps, { site }),
    '',
    fill(m.outro, { home: `${SITE_HOST}/pep` }),
  ].join('\n')
}

export async function redemptionCodeDmEnabled(): Promise<boolean> {
  try {
    return await toggleEnabled('proofOfPizza.dmOnPurchase')
  } catch {
    return false
  }
}

/** Send the DM for codes that have not been DMed yet. Returns whether one was sent. */
export async function notifyRedemptionCodes(userId: string, codes: string[]): Promise<boolean> {
  if (!userId || codes.length === 0) return false
  try {
    if (!(await redemptionCodeDmEnabled())) return false
    const pending = await prisma.redemptionCode.findMany({
      where: { code: { in: codes }, discordId: userId, status: 'ACTIVE', dmSentAt: null },
      select: { code: true },
    })
    if (pending.length === 0) return false
    const [ctx, siteUrl] = await Promise.all([loadOwnerContext(userId).catch(() => null), getSetting('proofOfPizza.siteUrl')])
    const text = await renderCodeDm(pending.map((p: { code: string }) => p.code), ctx?.locale, String(siteUrl || ''))
    await sendDiscordDm(userId, text)
    await prisma.redemptionCode.updateMany({ where: { code: { in: pending.map((p: { code: string }) => p.code) } }, data: { dmSentAt: new Date() } })
    return true
  } catch (err) {
    // Never log the code or message body.
    console.warn(isDmClosed(err) ? '[proof-of-pizza] DM closed, not retrying' : '[proof-of-pizza] DM failed', err instanceof Error ? err.message : '')
    return false
  }
}
