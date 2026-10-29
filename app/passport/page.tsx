import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PassportClient } from "./PassportClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("passport");
    return { title: t("title"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default function PassportPage() {
    return <PassportClient />;
}
