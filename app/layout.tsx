import type { Metadata } from "next";
import { Suspense } from "react";
import { Asap, Asap_Condensed, Geist_Mono, Rock_Salt } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import CornerLinks from "@/app/ui/CornerLinks";
import SiteHeader from "@/app/ui/SiteHeader";
import { XConnectNotice } from "@/app/ui/XConnectNotice";
import { SITE_URL } from "@/app/lib/site-url";

// Body / UI sans — matches pizzadao.org marketing site.
const asapSans = Asap({
  variable: "--font-sans-asap",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Display / headings — Asap Condensed.
const asapDisplay = Asap_Condensed({
  variable: "--font-display-asap-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  display: "swap",
});

// anchovy-28942: Rock Salt — handwritten editorial accent. Used by the
// `.handwritten` utility in globals.css and the restyled NameStep margin
// annotations. Single weight, swap display so we never block render.
const rockSalt = Rock_Salt({
  variable: "--font-handwritten-rock-salt",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Kept for `font-mono` consumers (app/tech/projects/[slug]/page.tsx).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PizzaDAO",
    template: "%s · PizzaDAO",
  },
  description: "The world's largest pizza co-op.",
  openGraph: {
    siteName: "PizzaDAO",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolved by app/lib/i18n/request.ts (cookie → Accept-Language → default).
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${asapSans.variable} ${asapDisplay.variable} ${rockSalt.variable} ${geistMono.variable} antialiased`}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>
            <XConnectNotice />
            <Suspense fallback={null}><SiteHeader /></Suspense>
            <div id="main-content">{children}</div>
          </Providers>
        </NextIntlClientProvider>
        {/* Suggestion + GitHub links - Fixed Bottom Right */}
        <CornerLinks />
      </body>
    </html>
  );
}

