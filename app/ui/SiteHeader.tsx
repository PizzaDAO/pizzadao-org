"use client";

// Global app shell header — editorial masthead + responsive nav.
//
// Rendered once from app/layout.tsx. Hidden on the full-screen onboarding
// wizard routes (/, /join, /login) where the wizard owns the viewport and a
// sticky bottom dock (NameStep). The header is sticky at the *top* so it
// never collides with CornerLinks (fixed bottom-right) or bottom docks.
//
// Route naming note: /crews is the list of working crews and /crew is the
// member directory. The URLs stay as-is (shared links); the nav labels them
// "Crews" and "Members".

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { useSession } from "@/app/lib/hooks/use-session";

type NavItem = {
  href: string;
  label: string;
  /** Custom active-state matcher; defaults to exact-or-prefix match. */
  match?: (pathname: string) => boolean;
  membersOnly?: boolean;
};

const PRIMARY: NavItem[] = [
  {
    href: "/crews",
    label: "Crews",
    // /crew/[crewId] is an individual crew page — it belongs under Crews.
    match: (p) => p === "/crews" || p.startsWith("/crew/"),
  },
  { href: "/crew", label: "Members", match: (p) => p === "/crew" },
  { href: "/missions", label: "Missions" },
  { href: "/pep", label: "PEP" },
  { href: "/articles", label: "Articles" },
  { href: "/calls", label: "Calls" },
  { href: "/chats", label: "Chats", membersOnly: true },
];

const MORE: NavItem[] = [
  { href: "/manuals", label: "Manuals" },
  { href: "/turtles", label: "Turtles" },
  { href: "/tech/projects", label: "Tech Projects" },
  { href: "/nfts", label: "NFTs" },
  { href: "/poaps", label: "POAPs" },
];

/** Routes where the onboarding wizard is full-screen and owns the chrome. */
const HIDDEN_ON = new Set(["/", "/join", "/login"]);

function isActive(item: NavItem, pathname: string) {
  if (item.match) return item.match(pathname);
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

const DISPLAY_FONT = "var(--font-display), var(--font-sans), system-ui, sans-serif";

export default function SiteHeader() {
  const pathname = usePathname() || "/";
  const { data: session } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLLIElement>(null);

  // Close menus on navigation (derived-state pattern; no effect needed).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setMobileOpen(false);
    setMoreOpen(false);
  }

  // Escape closes; outside-click closes the desktop "More" popover.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileOpen(false);
        setMoreOpen(false);
      }
    }
    function onClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  if (HIDDEN_ON.has(pathname)) return null;

  const loggedIn = !!session?.authenticated;
  const dashboardHref = session?.memberId ? `/dashboard/${session.memberId}` : "/";
  const primary = PRIMARY.filter((i) => !i.membersOnly || loggedIn);
  const moreActive = MORE.some((i) => isActive(i, pathname));
  const dashboardActive = pathname.startsWith("/dashboard/");

  const linkClass = (active: boolean) =>
    `site-nav-link relative inline-flex items-center min-h-[44px] px-2.5 text-[13px] font-semibold tracking-[0.02em] no-underline transition-colors ${
      active ? "text-tomato" : "text-foreground/70 hover:text-foreground"
    }`;

  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-md print:hidden"
      style={{
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        background: "hsl(var(--background) / 0.88)",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-[1200px] items-center gap-2 px-4 sm:px-6"
      >
        {/* Masthead */}
        <Link
          href={loggedIn ? dashboardHref : "/"}
          className="mr-2 inline-flex items-baseline gap-1.5 no-underline text-foreground"
          aria-label="PizzaDAO home"
        >
          <span aria-hidden className="text-tomato" style={{ fontFamily: DISPLAY_FONT, fontWeight: 800 }}>
            §
          </span>
          <span
            style={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: "-0.015em",
              lineHeight: 1,
            }}
          >
            PizzaDAO
          </span>
        </Link>

        {/* Desktop links */}
        <ul className="m-0 hidden list-none items-center p-0 lg:flex">
          {primary.map((item) => {
            const active = isActive(item, pathname);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={linkClass(active)}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li className="relative" ref={moreRef}>
            <button
              type="button"
              className={linkClass(moreActive) + " gap-1 border-0 bg-transparent cursor-pointer"}
              aria-expanded={moreOpen}
              aria-haspopup="true"
              aria-controls="site-nav-more"
              onClick={() => setMoreOpen((o) => !o)}
            >
              More
              <ChevronDown size={14} aria-hidden className={moreOpen ? "rotate-180 transition-transform" : "transition-transform"} />
            </button>
            {moreOpen && (
              <ul
                id="site-nav-more"
                className="paper-soft absolute right-0 top-full m-0 mt-1 min-w-[200px] list-none overflow-hidden rounded-2xl border p-2"
                style={{
                  borderColor: "hsl(var(--rule-warm) / 0.55)",
                  background: "hsl(var(--card))",
                  boxShadow: "var(--shadow-lifted)",
                }}
              >
                {MORE.map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-h-[40px] items-center rounded-xl px-3 text-sm no-underline transition-colors hover:bg-foreground/5 ${
                          active ? "text-tomato font-semibold" : "text-foreground"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        </ul>

        <div className="ml-auto flex items-center gap-2">
          {/* Account CTAs (desktop + tablet) */}
          <div className="hidden items-center gap-2 sm:flex">
            {loggedIn ? (
              <Link
                href={dashboardHref}
                aria-current={dashboardActive ? "page" : undefined}
                className="btn-pill no-underline"
                style={{
                  padding: "0.5rem 1.1rem",
                  background: dashboardActive ? "hsl(var(--tomato))" : "hsl(var(--foreground))",
                  color: dashboardActive ? "hsl(var(--cream))" : "hsl(var(--background))",
                }}
              >
                Dashboard
              </Link>
            ) : session ? (
              <>
                <Link href="/login" className={linkClass(false)}>
                  Log in
                </Link>
                <Link
                  href="/join"
                  className="btn-pill no-underline"
                  style={{
                    padding: "0.5rem 1.1rem",
                    background: "hsl(var(--tomato))",
                    color: "hsl(var(--cream))",
                  }}
                >
                  Join
                </Link>
              </>
            ) : null}
          </div>

          {/* Mobile menu toggle */}
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border bg-transparent text-foreground lg:hidden"
            style={{ borderColor: "hsl(var(--rule-warm) / 0.55)", cursor: "pointer" }}
            aria-expanded={mobileOpen}
            aria-controls="site-nav-mobile"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
          </button>
        </div>
      </nav>

      {/* Mobile panel */}
      {mobileOpen && (
        <div
          id="site-nav-mobile"
          className="paper-soft fade-up max-h-[calc(100svh-3.5rem)] overflow-y-auto border-t lg:hidden"
          style={{
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            background: "hsl(var(--card))",
            animationDuration: "0.3s",
          }}
        >
          <div className="mx-auto max-w-[1200px] px-4 pb-6 pt-4 sm:px-6">
            <div className="mb-4 flex gap-2 sm:hidden">
              {loggedIn ? (
                <Link
                  href={dashboardHref}
                  className="btn-pill flex-1 no-underline"
                  style={{ background: "hsl(var(--foreground))", color: "hsl(var(--background))" }}
                >
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="btn-pill flex-1 border no-underline"
                    style={{ borderColor: "hsl(var(--rule-warm))", color: "hsl(var(--foreground))" }}
                  >
                    Log in
                  </Link>
                  <Link
                    href="/join"
                    className="btn-pill flex-1 no-underline"
                    style={{ background: "hsl(var(--tomato))", color: "hsl(var(--cream))" }}
                  >
                    Join
                  </Link>
                </>
              )}
            </div>

            <p className="overline m-0 mb-1 text-tomato">§ Explore</p>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-4 p-0">
              {primary.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-[44px] items-center text-lg no-underline ${
                        active ? "text-tomato" : "text-foreground"
                      }`}
                      style={{ fontFamily: DISPLAY_FONT, fontWeight: 700 }}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>

            <div className="rule-warm my-3" />
            <p className="overline m-0 mb-1 text-foreground/55">More</p>
            <ul className="m-0 grid list-none grid-cols-2 gap-x-4 p-0">
              {MORE.map((item) => {
                const active = isActive(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-[44px] items-center text-[15px] no-underline ${
                        active ? "text-tomato font-semibold" : "text-foreground/80"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
      <style>{`
        .site-nav-link[aria-current="page"]::after,
        .site-nav-link[aria-expanded="true"]::after {
          content: "";
          position: absolute;
          left: 10px;
          right: 10px;
          bottom: 8px;
          height: 2px;
          border-radius: 2px;
          background: hsl(var(--tomato));
        }
      `}</style>
    </header>
  );
}
