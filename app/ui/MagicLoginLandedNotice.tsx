// app/ui/MagicLoginLandedNotice.tsx
//
// The Discord DM login link adds ?magicLogin=elsewhere to its landing page when it was opened in a
// browser that did not ask for it (Discord's in-app browser on a phone, a different default browser,
// another device). The member is logged in HERE, while the page they asked from stays logged out,
// which otherwise reads as "the link didn't log me in". This says so once and strips the flag.
//
// Mounted once in app/layout.tsx; the link can land on any page (returnTo, dashboard, wizard).
"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { OPENED_ELSEWHERE_PARAM, OPENED_ELSEWHERE_VALUE } from "@/app/lib/magic-login-flags";
import { SITE_HOST } from "@/app/lib/site-url";

function Inner() {
  const t = useTranslations("onboarding.magicLogin");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The link always arrives as a full page load, so reading the flag once at mount is enough;
  // it then stays open after the flag is stripped from the address.
  const [open, setOpen] = useState(() => searchParams?.get(OPENED_ELSEWHERE_PARAM) === OPENED_ELSEWHERE_VALUE);

  useEffect(() => {
    if (searchParams?.get(OPENED_ELSEWHERE_PARAM) !== OPENED_ELSEWHERE_VALUE) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete(OPENED_ELSEWHERE_PARAM);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname || "/", { scroll: false });
  }, [searchParams, router, pathname]);

  if (!open) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-lg rounded-2xl border p-4 shadow-lg sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2"
      style={{ background: "hsl(var(--card))", borderColor: "hsl(var(--rule-warm) / 0.7)", color: "hsl(var(--foreground))" }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <p className="m-0 font-bold">{t("landedTitle")}</p>
          <p className="m-0 mt-1 text-sm text-foreground/75">{t("landedMessage", { site: SITE_HOST })}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("landedDismiss")}
          className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-foreground/70 hover:text-foreground"
        >
          <X size={18} aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function MagicLoginLandedNotice() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}
