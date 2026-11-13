// app/tax-form/page.tsx: public, token-authed W-9 / W-8 page for payee requests.
// The token is only ever read client-side by TaxFormClient (the API GET marks the request
// "opened", so it must not fire for crawlers or link unfurlers).

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EditorialPage } from "@/app/ui/shared/Editorial";
import { TaxFormClient } from "./TaxFormClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("taxForm");
  return {
    title: t("meta"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

export default async function TaxFormPage({
  searchParams,
}: {
  searchParams: Promise<{ payee?: string | string[] }>;
}) {
  const { payee } = await searchParams;
  const token = (Array.isArray(payee) ? payee[0] : payee) ?? "";
  return (
    <EditorialPage width="max-w-[720px]">
      <TaxFormClient token={token} />
    </EditorialPage>
  );
}
