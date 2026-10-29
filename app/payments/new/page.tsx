// app/payments/new/page.tsx — in-app payment request form (non-party events, reimbursements, work).
// Members only; closed until the `payments.requestFormEnabled` setting is on.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialPage } from "@/app/ui/shared/Editorial";
import { NewPaymentForm } from "./NewPaymentForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("payments");
    return { title: t("formMeta"), robots: { index: false, follow: false } };
}

export default function NewPaymentPage() {
    return (
        <EditorialPage width="max-w-[720px]">
            <NewPaymentForm />
        </EditorialPage>
    );
}
