"use client";

import { useEffect, useState } from "react";
import { HOME_PATH, Link } from "@/app/(marketing)/_site/lib/router";
import { useSession } from "@/app/lib/hooks/use-session";
import { Menu, X } from "lucide-react";
const logoDark = "/marketing/assets/logo-dark.svg";
const logoLight = "/marketing/assets/logo-light.svg";
import { track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";
import { useTrackOutbound } from "@/app/(marketing)/_site/lib/analytics/useTrackOutbound";

const NAV = [
  { label: "About", href: "/about" },
  { label: "Partners", href: "/partners" },
  { label: "Community", href: "/community" },
];


type Props = { solid?: boolean };

const SiteNav = ({ solid = false }: Props) => {
  const [open, setOpen] = useState(false);
  // The features link is behind its own switch (features.navLinkEnabled); off, the header is unchanged.
  const [featuresNav, setFeaturesNav] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/public/features-nav")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => alive && setFeaturesNav(b?.enabled === true))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const navItems = featuresNav ? [...NAV, { label: "What we've built", href: "/features" }] : NAV;
  const { data: session } = useSession();
  // A signed-in member sees their dashboard instead of "Member login" and "Join".
  const dashboardHref = session?.authenticated ? (session.memberId ? `/dashboard/${session.memberId}` : "/start") : null;
  const trackOutbound = useTrackOutbound("site_nav");

  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (solid) return;
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [solid]);

  const onRed = !solid && !scrolled;

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-colors duration-300 ${
        onRed
          ? "bg-transparent"
          : "bg-cream/90 backdrop-blur shadow-[0_1px_0_0_hsl(var(--ink)/0.10)]"
      }`}
    >
      <div className="container flex h-16 items-center justify-between md:h-[72px] lg:h-20">
        <Link to={HOME_PATH} className="flex items-center" aria-label="PizzaDAO home">
          <img
            src={onRed ? logoLight : logoDark}
            alt="PizzaDAO"
            className="h-6 w-auto md:h-[26px] lg:h-7"
          />
        </Link>

        <nav className="hidden items-center gap-5 md:flex lg:gap-7">
          {navItems.map((n) => (
            <Link
              key={n.label}
              to={n.href}
              onClick={() => track(EVT.NAV_CLICKED, { label: n.label, to: n.href, surface: "desktop" })}
              className={`ui text-sm font-medium tracking-wide transition-colors ${
                onRed
                  ? "text-cream/90 hover:text-butter"
                  : "text-foreground/80 hover:text-tomato"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 md:flex lg:gap-3">
          {dashboardHref ? (
            <Link
              to={dashboardHref}
              onClick={() => trackOutbound("Dashboard", dashboardHref, { surface: "desktop" })}
              className={`mk-btn-pill ${
                onRed
                  ? "bg-cream text-ink hover:bg-butter"
                  : "bg-ink text-cream hover:bg-tomato"
              }`}
            >
              Dashboard
            </Link>
          ) : (
            <>
          <a
            href="/login"
            onClick={() => trackOutbound("Member login", "/login", { surface: "desktop" })}
            className={`mk-btn-pill border ${
              onRed
                ? "border-cream/40 text-cream/90 hover:border-cream hover:text-cream"
                : "border-ink/30 text-ink/80 hover:border-ink hover:text-ink"
            }`}
          >
            Member login
          </a>
          <a
            href="/join"
            onClick={() => {
              track(EVT.MAFIA_INTENT_CLICKED, { label: "Join", surface: "site_nav_desktop" });
              trackOutbound("Join", "/join", { surface: "desktop" });
            }}
            className={`mk-btn-pill ${
              onRed
                ? "bg-cream text-ink hover:bg-butter"
                : "bg-ink text-cream hover:bg-tomato"
            }`}
          >
            Join
          </a>
            </>
          )}


        </div>

        <button
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className={`-mr-2 flex h-11 w-11 items-center justify-center md:hidden ${
            onRed ? "text-cream" : "text-ink"
          }`}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile overlay - full-screen editorial sheet */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-cream transition-[opacity,transform] duration-[420ms] ease-[cubic-bezier(0.22,0.61,0.24,1)] ${
          open ? "opacity-100 translate-y-0 pointer-events-auto" : "pointer-events-none opacity-0 -translate-y-2"
        }`}
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 4rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1.5rem)",
        }}
        aria-hidden={!open}
      >
        <div className="container flex h-full flex-col">
          <p className="mk-overline text-ink/45">Navigate</p>
          <nav className="mt-6 flex flex-col">
            {navItems.map((n, i) => (
              <Link
                key={n.label}
                to={n.href}
                onClick={() => {
                  track(EVT.NAV_CLICKED, { label: n.label, to: n.href, surface: "mobile" });
                  setOpen(false);
                }}
                className="font-display group flex min-h-[64px] items-center justify-between border-b border-rule-warm/60 text-[2rem] font-extrabold leading-none tracking-[-0.01em] text-ink transition-colors hover:text-tomato"
                style={{
                  transitionDelay: open ? `${80 + i * 40}ms` : "0ms",
                }}
              >
                <span>{n.label}</span>
                <span className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/35 group-hover:text-tomato">
                  0{i + 1}
                </span>
              </Link>
            ))}
          </nav>

          <div className="mt-auto flex flex-col gap-3 pt-10">
            {dashboardHref ? (
              <Link
                to={dashboardHref}
                onClick={() => {
                  trackOutbound("Dashboard", dashboardHref, { surface: "mobile" });
                  setOpen(false);
                }}
                className="mk-btn-pill-lg bg-tomato text-cream text-center hover:bg-ink"
              >
                Dashboard →
              </Link>
            ) : (
              <>
            <a
              href="/login"
              className="mk-btn-pill-lg border border-ink/30 text-center text-ink/80 hover:border-ink hover:text-ink"
              onClick={() => {
                trackOutbound("Member login", "/login", { surface: "mobile" });
                setOpen(false);
              }}
            >
              Member login
            </a>
            <a
              href="/join"
              onClick={() => {
                track(EVT.MAFIA_INTENT_CLICKED, { label: "Join the Pizza Mafia", surface: "site_nav_mobile" });
                trackOutbound("Join the Pizza Mafia", "/join", { surface: "mobile" });
                setOpen(false);
              }}
              className="mk-btn-pill-lg bg-tomato text-cream text-center hover:bg-ink"
            >
              Join the Pizza Mafia →
            </a>
              </>
            )}


            <div className="mt-4 flex items-center justify-between border-t border-rule-warm/50 pt-4">
              <span className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-ink/45">
                PizzaDAO · Est. 2021
              </span>
              <div className="flex gap-5">
                <Link to="/privacy" onClick={() => setOpen(false)} className="ui text-[10px] uppercase tracking-[0.18em] text-ink/55 hover:text-tomato">Privacy</Link>
                <Link to="/terms" onClick={() => setOpen(false)} className="ui text-[10px] uppercase tracking-[0.18em] text-ink/55 hover:text-tomato">Terms</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};

export default SiteNav;
