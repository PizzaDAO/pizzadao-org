// app/payments/page.tsx — the signed-in member's own payment requests (status only; reviewers' flags
// and notes are never shown here).

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialPage } from "@/app/ui/shared/Editorial";
import { MyPayments } from "./MyPayments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("payments");
    return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

export default function PaymentsPage() {
    return (
        <EditorialPage width="max-w-[820px]">
            <MyPayments />
        </EditorialPage>
    );
}
