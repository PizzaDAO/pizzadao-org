// app/ui/XConnectNotice.tsx
//
// X (Twitter) OAuth success/error from /api/x/callback is communicated via
// `?x_connected=1` / `?x_error=<code>` query params on redirect, but nothing
// in the app ever read them — the user just landed back on the page with no
// feedback. This reads those params once, surfaces a toast via the existing
// <ToastProvider/> (see app/ui/shared/Toast.tsx), and strips them from the
// URL so a refresh/share doesn't re-trigger the toast.
//
// Mounted once in app/layout.tsx (wrapped in <Suspense/> since it uses
// useSearchParams) so it covers both `/` and `/dashboard/[id]` — the two
// possible redirect targets from the callback route.
"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/app/ui/shared/Toast";

export type XConnectMessage = { kind: "success" | "error"; text: string };

const SESSION_EXPIRED_TEXT =
  "Your X connection session expired or was opened in a different browser/app. Please try again in this browser — on mobile, open the link in your browser rather than the X app.";

/**
 * Pure mapping from the callback's query params to a user-facing message.
 * Exported (and kept side-effect-free) so it can be unit tested without
 * mounting the component / toast provider.
 */
export function xConnectMessage(params: {
  xError?: string | null;
  xConnected?: string | null;
}): XConnectMessage | null {
  const { xError, xConnected } = params;

  if (xConnected) {
    return { kind: "success", text: "X account connected!" };
  }

  if (xError) {
    switch (xError) {
      case "cancelled":
        return { kind: "error", text: "X connection cancelled." };
      case "invalid_state":
      case "missing_verifier":
        return { kind: "error", text: SESSION_EXPIRED_TEXT };
      case "failed":
      case "no_code":
      default:
        return { kind: "error", text: "Couldn't connect your X account. Please try again." };
    }
  }

  return null;
}

function XConnectNoticeInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;

    const xError = searchParams?.get("x_error");
    const xConnected = searchParams?.get("x_connected");
    const message = xConnectMessage({ xError, xConnected });
    if (!message) return;

    handledRef.current = true;
    if (message.kind === "success") {
      toast.success(message.text);
    } else {
      toast.error(message.text);
    }

    const next = new URLSearchParams(searchParams?.toString());
    next.delete("x_error");
    next.delete("x_connected");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, toast, router, pathname]);

  return null;
}

export function XConnectNotice() {
  return (
    <Suspense fallback={null}>
      <XConnectNoticeInner />
    </Suspense>
  );
}
