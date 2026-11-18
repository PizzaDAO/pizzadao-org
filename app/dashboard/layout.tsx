import type { ReactNode } from "react";
import { RouteMessages } from "@/app/lib/i18n/RouteMessages";

// Sends this segment's client message namespaces (see app/lib/i18n/route-namespaces.ts).
export default function Layout({ children }: { children: ReactNode }) {
  return <RouteMessages route="dashboard">{children}</RouteMessages>;
}
