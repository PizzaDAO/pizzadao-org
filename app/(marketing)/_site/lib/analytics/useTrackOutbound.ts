"use client";

import { useCallback } from "react";
import { track } from "./posthog";
import { EVT } from "./events";

/**
 * Returns an onClick handler that emits `comms.outbound_link_clicked`
 * just before the browser follows the link.
 */
export function useTrackOutbound(location: string) {
  return useCallback(
    (
      label: string,
      href: string,
      extra: Record<string, unknown> = {},
    ) => {
      let host = "";
      try {
        host = new URL(href, window.location.origin).host;
      } catch {
        host = "";
      }
      track(EVT.OUTBOUND_LINK, {
        href,
        host,
        label,
        location,
        ...extra,
      });
    },
    [location],
  );
}
