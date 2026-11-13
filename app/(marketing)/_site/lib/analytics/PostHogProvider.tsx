"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  captureAttribution,
  initPostHog,
  trackPageView,
} from "./posthog";

/**
 * Mounts PostHog and tracks client-side route changes as $pageview events. Rendered only by the
 * marketing layout, so the app's own pages never load it.
 */
const PostHogProvider = ({ children }: { children: ReactNode }) => {
  const pathname = usePathname() || "/";
  const search = useSearchParams()?.toString() ?? "";

  // Init once on mount.
  useEffect(() => {
    initPostHog();
    captureAttribution();
  }, []);

  // Capture pageview on every route change.
  useEffect(() => {
    trackPageView(pathname, search ? `?${search}` : "");
  }, [pathname, search]);

  return <>{children}</>;
};

export default PostHogProvider;
