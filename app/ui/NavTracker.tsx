"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordInAppNavigation } from "@/app/lib/go-back";

// Counts client-side navigations (not the initial landing) so "← Back" buttons
// know whether router.back() stays inside the app. See app/lib/go-back.ts.
export default function NavTracker() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (prev.current !== null && prev.current !== pathname) recordInAppNavigation();
    prev.current = pathname;
  }, [pathname]);
  return null;
}
