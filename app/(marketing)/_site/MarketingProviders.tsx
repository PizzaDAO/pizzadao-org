"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/app/(marketing)/_site/components/ui/tooltip";
import { Toaster } from "@/app/(marketing)/_site/components/ui/toaster";
import ScrollToTop from "@/app/(marketing)/_site/components/ScrollToTop";
import BennyPeek from "@/app/(marketing)/_site/components/BennyPeek";
import PostHogProvider from "@/app/(marketing)/_site/lib/analytics/PostHogProvider";

/** Client-side wrappers the marketing pages share (the app's own query client comes from the root layout). */
export default function MarketingProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <Toaster />
      <PostHogProvider>
        <ScrollToTop />
        <BennyPeek />
        {children}
      </PostHogProvider>
    </TooltipProvider>
  );
}
