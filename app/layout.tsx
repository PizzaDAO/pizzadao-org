import type { Metadata } from "next";
import { Suspense } from "react";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import CornerLinks from "@/app/ui/CornerLinks";
import SiteHeader from "@/app/ui/SiteHeader";
import { XConnectNotice } from "@/app/ui/XConnectNotice";
import { GlobalBallotPreparer } from "@/app/proposals/_components/GlobalBallotPreparer";
import { SITE_URL } from "@/app/lib/site-url";

// Fonts are self-hosted (app/fonts, latin subset; licenses alongside) so the
// build never has to fetch from Google Fonts.

// Body / UI sans — matches pizzadao.org marketing site. Asap (variable wght).
const asapSans = localFont({
  variable: "--font-sans-asap",
  src: [{ path: "./fonts/Asap-latin-variable.woff2", weight: "400 700", style: "normal" }],
  display: "swap",
});

// Display / headings — Asap Condensed.
const asapDisplay = localFont({
  variable: "--font-display-asap-condensed",
  src: [
    { path: "./fonts/AsapCondensed-500-latin.woff2", weight: "500", style: "normal" },
    { path: "./fonts/AsapCondensed-600-latin.woff2", weight: "600", style: "normal" },
    { path: "./fonts/AsapCondensed-700-latin.woff2", weight: "700", style: "normal" },
    { path: "./fonts/AsapCondensed-800-latin.woff2", weight: "800", style: "normal" },
  ],
  display: "swap",
});

// anchovy-28942: Rock Salt — handwritten editorial accent. Used by the
// `.handwritten` utility in globals.css and the restyled NameStep margin
// annotations. Single weight, swap display so we never block render.
const rockSalt = localFont({
  variable: "--font-handwritten-rock-salt",
  src: [{ path: "./fonts/RockSalt-400-latin.woff2", weight: "400", style: "normal" }],
  display: "swap",
});

// Kept for `font-mono` consumers (app/tech/projects/[slug]/page.tsx).
const geistMono = localFont({
  variable: "--font-geist-mono",
  src: [{ path: "./fonts/GeistMono-latin-variable.woff2", weight: "100 900", style: "normal" }],
  display: "swap",
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
            <GlobalBallotPreparer />
            <Suspense fallback={null}><SiteHeader /></Suspense>
            <Suspense fallback={null}><div id="main-content">{children}</div></Suspense>
          </Providers>
        </NextIntlClientProvider>
        {/* Suggestion + GitHub links - Fixed Bottom Right */}
        <CornerLinks />
      </body>
    </html>
  );
}

