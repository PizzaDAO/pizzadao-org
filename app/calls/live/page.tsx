// app/calls/live/page.tsx
//
// The live call view. Everyone sees the title, crew, start time, stream link and head count; signed-in
// members also see who is present, the live action items (level-gated) and the Q&A and polls. Polling
// only (no SSE), no live transcript. Metadata is generic and noindex.

import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import LiveCallClient from "./LiveCallClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("callsPage.live");
    return { title: t("title"), robots: { index: false, follow: false } };
}

export default function LiveCallPage() {
    return <LiveCallClient />;
}
