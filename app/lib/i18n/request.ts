// app/lib/i18n/request.ts
// Wired into next-intl via next.config.ts → createNextIntlPlugin(...).
// Runs on every request (RSC). Resolves the active locale and loads the
// matching messages catalog.

import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./get-locale";
import { DEFAULT_LOCALE } from "./locales";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();

  // Dynamic import keeps each locale's catalog out of the others' bundle.
  // Fall back to English if the catalog is missing/broken (shouldn't happen
  // in practice but defends against partial deploys).
  let messages;
  try {
    messages = (await import(`../../../messages/${locale}.json`)).default;
  } catch {
    messages = (await import(`../../../messages/${DEFAULT_LOCALE}.json`))
      .default;
  }

  return { locale, messages };
});
