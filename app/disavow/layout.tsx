import type { Metadata } from "next";
import type { ReactNode } from "react";

// Private area: never cached, never indexed. /disavow is also in robots.ts and
// deliberately absent from the sitemap and every public nav.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
    title: "Disavow list",
    robots: { index: false, follow: false, nocache: true },
};

export default function DisavowLayout({ children }: { children: ReactNode }) {
    return children;
}
