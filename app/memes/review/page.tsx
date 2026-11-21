import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialMasthead, EditorialPage } from "@/app/ui/shared/Editorial";
import ReviewQueue from "./ReviewQueue";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memes");
  return { title: t("reviewTitle"), robots: { index: false, follow: false } };
}

export default async function MemeReviewPage() {
  const t = await getTranslations("memes");
  return (
    <EditorialPage>
      <EditorialMasthead overline={t("overline")} title={t("reviewTitle")} dek={t("reviewDek")} />
      <ReviewQueue />
    </EditorialPage>
  );
}
