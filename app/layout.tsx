import type { Metadata } from "next";
import { Asap, Asap_Condensed, Geist_Mono, Rock_Salt } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { Providers } from "./providers";
import CornerLinks from "@/app/ui/CornerLinks";

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
  title: "Join PizzaDAO",
  description: "The world's largest pizza co-op.",
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
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
        {/* Suggestion + GitHub links - Fixed Bottom Right */}
        <CornerLinks />
      </body>
    </html>
  );
}

