import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { getSession } from "@/app/lib/session";
import { disavowEnabled } from "@/app/lib/disavow/constants";
import { disavowViewer, findSubjectDisavowals } from "@/app/lib/disavow/access";
import { loadDisavowCatalog } from "@/app/lib/disavow/messages";
import type { SupportedLocale } from "@/app/lib/i18n/locales";

// Private area: never cached, never indexed. The route 404s for everyone who
// may not use it (that, not robots.txt, is what keeps it quiet; robots.txt
// would advertise the path). It is absent from the sitemap and every public nav.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    title: "Disavow list",
    robots: { index: false, follow: false, nocache: true },
};

/**
 * The disavow strings are not part of the root messages. They are added here,
 * only for viewers who may use the list (or a listed member who may answer),
 * so nobody else ever receives any disavow text.
 */
export default async function DisavowLayout({ children }: { children: ReactNode }) {
    let eligible = false;
    if (disavowEnabled()) {
        const session = await getSession().catch(() => null);
        if (session?.discordId) {
            eligible =
                (await disavowViewer(session.discordId)).allowed ||
                (await findSubjectDisavowals(session.discordId)).length > 0;
        }
    }
    if (!eligible) return children;

    const locale = await getLocale();
    const [root, disavow] = await Promise.all([getMessages(), loadDisavowCatalog(locale as SupportedLocale)]);
    return (
        <NextIntlClientProvider locale={locale} messages={{ ...root, disavow } as never}>
            {children}
        </NextIntlClientProvider>
    );
}
