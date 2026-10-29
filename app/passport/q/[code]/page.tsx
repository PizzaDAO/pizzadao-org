import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CheckInClient } from "./CheckInClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("passport");
    return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function QrLandingPage({ params }: { params: Promise<{ code: string }> }) {
    const { code } = await params;
    let qr = code;
    try {
        qr = decodeURIComponent(code);
    } catch {
        /* malformed escape: the check-in will report an invalid code */
    }
    return <CheckInClient qr={qr} />;
}
