// Member page: claim and view Call Slices (attendance NFTs on Base).
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialMasthead, EditorialPage } from "@/app/ui/shared/Editorial";
import { SliceClaimsList } from "@/app/ui/slices/SliceClaims";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("slices");
  return { title: t("metaTitle"), description: t("metaDescription") };
}

export default async function SlicesPage() {
  const t = await getTranslations("slices");
  return (
    <EditorialPage width="max-w-3xl">
      <EditorialMasthead overline={t("overline")} title={t("mastheadTitle")} dek={t("dek")} />
      <SliceClaimsList />
    </EditorialPage>
  );
}
