// app/lib/i18n/test-utils.tsx
// Test-only helper: render a component inside NextIntlClientProvider with the
// real message catalog for the given locale (default "en"), mirroring what
// app/layout.tsx does at runtime.

import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import type { SupportedLocale } from "./locales";

export const CATALOGS: Record<SupportedLocale, typeof en> = { en, es, fr };

export function IntlWrapper({
  locale = "en",
  children,
}: {
  locale?: SupportedLocale;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider locale={locale} messages={CATALOGS[locale]} timeZone="UTC">
      {children}
    </NextIntlClientProvider>
  );
}

export function renderWithIntl(
  ui: ReactElement,
  { locale = "en", ...options }: { locale?: SupportedLocale } & Omit<RenderOptions, "wrapper"> = {},
) {
  return render(ui, {
    wrapper: ({ children }) => <IntlWrapper locale={locale}>{children}</IntlWrapper>,
    ...options,
  });
}
