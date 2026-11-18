import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { pickMessages, routeMessagePaths } from "./route-namespaces";

/**
 * Sends the client messages a route segment needs (ROUTE_NAMESPACES[route] plus the root picks).
 * Use it in the segment's layout.tsx. A nested provider replaces its parent's messages, which is
 * why the root namespaces are included again here.
 */
export async function RouteMessages({ route, children }: { route: string; children: ReactNode }) {
  const [locale, messages] = await Promise.all([getLocale(), getMessages()]);
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, routeMessagePaths(route)) as never}>
      {children}
    </NextIntlClientProvider>
  );
}
