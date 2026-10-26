/**
 * The disavow strings live in their own catalogs (messages/disavow/*.json), NOT
 * in the root messages, so logged-out and ineligible users never receive any
 * disavow text. They are loaded only by /disavow's layout and handed to the
 * few surfaces an eligible viewer sees elsewhere (nav label, profile chip,
 * vouch dialog) as already-translated strings.
 */
import { createTranslator } from 'next-intl'
import { resolveLocale } from '@/app/lib/i18n/get-locale'
import { DEFAULT_LOCALE, type SupportedLocale } from '@/app/lib/i18n/locales'

export type DisavowCatalog = Record<string, unknown>

export async function loadDisavowCatalog(locale: SupportedLocale): Promise<DisavowCatalog> {
  try {
    return (await import(`../../../messages/disavow/${locale}.json`)).default
  } catch {
    return (await import(`../../../messages/disavow/${DEFAULT_LOCALE}.json`)).default
  }
}

/** Server-side translator for the `disavow` namespace in the request's locale. */
export async function getDisavowTranslator() {
  const locale = await resolveLocale()
  const catalog = await loadDisavowCatalog(locale)
  return createTranslator({ locale, messages: { disavow: catalog } as never, namespace: 'disavow' as never }) as unknown as (
    key: string,
    values?: Record<string, string | number | Date>,
  ) => string
}

/** Strings for the vouch warning dialog, already translated. */
export async function vouchWarningStrings() {
  const t = await getDisavowTranslator()
  return {
    title: t('vouch.title'), body: t('vouch.body'), confirm: t('vouch.confirm'), cancel: t('vouch.cancel'), view: t('vouch.view'),
  }
}
