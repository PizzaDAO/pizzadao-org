"use client";

/**
 * The few react-router APIs the ported marketing components use, on top of the App Router, so the
 * components keep their original shape. `Link` takes `to`; `useLocation` returns pathname/search.
 */
import { forwardRef, type ComponentProps } from "react";
import NextLink from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { marketingHomeAtRoot } from "@/app/lib/marketing-site";

type LinkProps = Omit<ComponentProps<typeof NextLink>, "href"> & { to: string };

export const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link({ to, ...rest }, ref) {
  return <NextLink ref={ref} href={to} {...rest} />;
});

export function useLocation() {
  const pathname = usePathname() || "/";
  const qs = useSearchParams()?.toString() ?? "";
  return { pathname, search: qs ? `?${qs}` : "", hash: "" };
}

/** Where the marketing home page lives: /home until it takes over "/" (see next.config.ts). */
export const HOME_PATH = marketingHomeAtRoot() ? "/" : "/home";
