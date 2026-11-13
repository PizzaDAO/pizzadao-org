import "./marketing.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import MarketingProviders from "@/app/(marketing)/_site/MarketingProviders";
import { marketingRobots } from "@/app/lib/marketing-site";

// The marketing pages (plans/pizzadao-org-to-vercel.md, Phase 2). They stay noindex until
// NEXT_PUBLIC_MARKETING_INDEXABLE is on. The app header hides itself on these paths and each page
// renders its own marketing nav and footer. PostHog loads here only, never on the app's pages.
export const metadata: Metadata = {
  robots: marketingRobots(),
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mk">
      <Suspense fallback={null}>
        <MarketingProviders>{children}</MarketingProviders>
      </Suspense>
    </div>
  );
}
