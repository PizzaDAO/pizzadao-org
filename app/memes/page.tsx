import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialMasthead, EditorialPage } from "@/app/ui/shared/Editorial";
import MemeFolder from "./MemeFolder";

// Static shell: everything member-specific is fetched by the client from /api/memes (session required;
// the API answers { enabled: false } while the feature is off).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("memes");
  return { title: t("metaTitle"), description: t("metaDescription"), robots: { index: false, follow: false } };
}

export default async function MemesPage() {
  const t = await getTranslations("memes");
  return (
    <EditorialPage>
      <EditorialMasthead overline={t("overline")} title={t("title")} dek={t("dek")} />
      <MemeFolder />
    </EditorialPage>
  );
}
