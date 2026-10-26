import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireDisavowViewerPage } from "@/app/lib/disavow/access";
import { EditorialMasthead, EditorialPage, paperCard } from "@/app/ui/shared/Editorial";
import { NominateForm } from "../_components/NominateForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function NewDisavowPage() {
    await requireDisavowViewerPage();
    const t = await getTranslations("disavow");
    return (
        <EditorialPage width="max-w-[720px]">
            <EditorialMasthead overline={t("overline")} title={t("form.title")} dek={t("form.intro")} />
            <Link href="/disavow" className="mb-5 inline-flex min-h-11 items-center text-sm font-semibold text-tomato-readable underline underline-offset-4">
                {t("back")}
            </Link>
            <p role="note" className={`${paperCard} mb-6 p-4 text-sm`}>{t("banner")}</p>
            <NominateForm />
        </EditorialPage>
    );
}
