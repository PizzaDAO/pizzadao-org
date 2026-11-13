"use client";

import { ReactNode, useEffect, useState } from "react";
import { HOME_PATH, Link, useLocation } from "@/app/(marketing)/_site/lib/router";
import { ArrowUpRight, ChevronDown, FileText, ShieldCheck } from "lucide-react";
import SiteNav from "./SiteNav";
import Footer from "./Footer";

const HUB_DOCS = [
  {
    to: "/privacy",
    label: "Privacy Policy",
    blurb: "What we collect, why, and how to control it.",
    Icon: ShieldCheck,
  },
  {
    to: "/terms",
    label: "Terms & Conditions",
    blurb: "Ground rules for the site, programs, and community.",
    Icon: FileText,
  },
] as const;

const LegalHub = () => {
  const { pathname } = useLocation();
  return (
    <section aria-label="Legal hub" className="relative z-10 pt-20 md:pt-28">
      <div className="container">
        <div className="mx-auto max-w-[820px]">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-ink/20 text-tomato"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
                <circle cx="12" cy="12" r="10" opacity="0.15" />
                <circle cx="9" cy="9" r="1.2" />
                <circle cx="15" cy="10" r="1" />
                <circle cx="11" cy="14" r="1.1" />
                <circle cx="14.5" cy="14.5" r="0.9" />
              </svg>
            </span>
            <p className="mk-overline text-tomato">§ Legal hub</p>
          </div>

          <p className="font-serif mt-4 max-w-[60ch] text-[15.5px] leading-[1.65] text-ink/70 md:mt-5 md:text-[17px] md:leading-relaxed">
            PizzaDAO is built around community participation, events, culture,
            and experimentation. These documents explain how we handle the
            practical side of that.
          </p>

          <div className="mt-6 h-px w-full bg-ink/10 md:mt-7" aria-hidden />

          <ul className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 md:mt-7">
            {HUB_DOCS.map(({ to, label, blurb, Icon }) => {
              const active = pathname === to;
              return (
                <li key={to}>
                  <Link
                    to={to}
                    aria-current={active ? "page" : undefined}
                    className={`group relative flex h-full min-h-[72px] items-start gap-4 rounded-2xl border p-4 transition-all duration-300 md:p-5 ${
                      active
                        ? "border-ink bg-ink text-cream shadow-[0_10px_30px_-18px_hsl(var(--ink)/0.5)]"
                        : "border-ink/15 bg-cream/60 text-ink active:bg-ink/[0.03] hover:-translate-y-0.5 hover:border-ink hover:shadow-[0_14px_36px_-22px_hsl(var(--tomato)/0.45)]"
                    }`}
                  >
                    <span
                      className={`mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors ${
                        active
                          ? "bg-tomato text-cream"
                          : "bg-ink/[0.04] text-ink/70 group-hover:bg-tomato group-hover:text-cream"
                      }`}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-display text-lg font-extrabold leading-tight tracking-[-0.005em]">
                          {label}
                        </span>
                        <ArrowUpRight
                          className={`h-4 w-4 shrink-0 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 ${
                            active ? "text-cream/80" : "text-ink/45"
                          }`}
                        />
                      </span>
                      <span
                        className={`mt-1.5 block text-sm leading-relaxed ${
                          active ? "text-cream/75" : "text-ink/65"
                        }`}
                      >
                        {blurb}
                      </span>
                      {active && (
                        <span className="ui mt-3 inline-block text-[10px] uppercase tracking-[0.22em] text-butter">
                          You are here
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
};


export type LegalSection = {
  id: string;
  title: string;
  body: ReactNode;
};

type Props = {
  eyebrow?: string;
  title: string;
  intro: string;
  lastUpdated: string;
  sections: LegalSection[];
  metaTitle?: string;
  metaDescription?: string;
  canonical?: string;
};

const LegalLayout = ({
  eyebrow = "Legal",
  title,
  intro,
  lastUpdated,
  sections,
}: Props) => {

  const [activeId, setActiveId] = useState(sections[0]?.id);
  const [tocOpen, setTocOpen] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveId(e.target.id);
        });
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  return (
    <main className="relative min-h-[100svh] bg-cream text-ink">
      <SiteNav solid />

      {/* Faint sauce wash */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60svh] opacity-70"
        style={{
          background:
            "radial-gradient(70% 55% at 20% 0%, hsl(var(--butter) / 0.22), transparent 65%), radial-gradient(60% 50% at 95% 5%, hsl(var(--tomato) / 0.08), transparent 70%)",
        }}
      />
      <div aria-hidden className="mk-grain pointer-events-none absolute inset-0" />

      <LegalHub />

      {/* Hero */}
      <header className="relative z-10 pt-8 md:pt-14">
        <div className="container">
          <div className="mx-auto max-w-[820px]">
            <p className="mk-overline text-tomato">§ {eyebrow}</p>
            <h1 className="font-display mt-4 text-[clamp(2.125rem,8vw,4.75rem)] font-extrabold leading-[0.95] tracking-[-0.015em] md:leading-[0.9] [text-wrap:balance]">
              {title}
            </h1>
            <p className="font-serif mt-5 max-w-[58ch] text-[17px] leading-[1.6] text-ink/75 md:mt-6 md:text-xl md:leading-relaxed">
              {intro}
            </p>
            <p className="ui mt-6 text-[11px] uppercase tracking-[0.22em] text-ink/55 md:mt-8">
              Last updated · <span className="text-ink/80">{lastUpdated}</span>
            </p>
          </div>
        </div>
      </header>

      {/* Body */}
      <section className="relative z-10 pb-20 pt-8 md:pb-32 md:pt-16">
        <div className="container">
          <div className="mx-auto max-w-[1100px] md:grid md:grid-cols-12 md:gap-x-10">
            {/* TOC - sticky desktop, accordion mobile */}
            <aside className="md:col-span-3">
              {/* Mobile accordion - sticky just below the nav for easy thumb access */}
              <div className="sticky top-16 z-20 -mx-4 bg-cream/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-cream/75 md:hidden">
                <button
                  type="button"
                  onClick={() => setTocOpen((v) => !v)}
                  aria-expanded={tocOpen}
                  aria-controls="legal-toc-mobile"
                  className="flex min-h-[48px] w-full items-center justify-between border-y border-ink/15 py-3 text-left"
                >
                  <span className="flex items-baseline gap-3">
                    <span className="ui text-[11px] font-semibold uppercase tracking-[0.22em] text-tomato">
                      On this page
                    </span>
                    {!tocOpen && activeId && (
                      <span className="truncate text-sm text-ink/70">
                        {sections.find((s) => s.id === activeId)?.title}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-ink/60 transition-transform ${
                      tocOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {tocOpen && (
                  <ol id="legal-toc-mobile" className="space-y-0 pb-3 pt-1">
                    {sections.map((s, i) => {
                      const active = activeId === s.id;
                      return (
                        <li key={s.id}>
                          <a
                            href={`#${s.id}`}
                            onClick={() => setTocOpen(false)}
                            className={`ui flex min-h-[44px] items-baseline gap-3 py-2 text-[15px] transition-colors ${
                              active ? "text-tomato" : "text-ink/75 hover:text-tomato"
                            }`}
                          >
                            <span className="text-[10px] tabular-nums text-ink/40">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className="leading-snug">{s.title}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              {/* Desktop sticky */}
              <nav
                aria-label="Table of contents"
                className="hidden md:sticky md:top-28 md:block"
              >
                <p className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato">
                  On this page
                </p>
                <ol className="mt-4 space-y-1 border-l border-ink/15">
                  {sections.map((s, i) => {
                    const active = activeId === s.id;
                    return (
                      <li key={s.id}>
                        <a
                          href={`#${s.id}`}
                          className={`ui group -ml-px flex items-baseline gap-3 border-l-2 py-2 pl-4 text-sm transition-colors ${
                            active
                              ? "border-tomato text-ink"
                              : "border-transparent text-ink/55 hover:border-ink/40 hover:text-ink"
                          }`}
                        >
                          <span className="text-[10px] tabular-nums text-ink/40 group-hover:text-tomato">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="leading-snug">{s.title}</span>
                        </a>
                      </li>
                    );
                  })}
                </ol>
              </nav>
            </aside>

            {/* Content */}
            <article
              className="mt-8 md:col-span-9 md:mt-0"
              style={{ scrollBehavior: "smooth" }}
            >
              <div className="legal-prose mx-auto max-w-[68ch]">
                {sections.map((s, i) => (
                  <section
                    key={s.id}
                    id={s.id}
                    className="scroll-mt-[120px] pb-12 pt-1 first:pt-0 md:scroll-mt-28 md:pb-14 md:pt-2"
                  >
                    <div className="mb-4 flex items-baseline gap-3 md:mb-6 md:gap-4">
                      <span className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato/80 tabular-nums">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <h2 className="font-display text-[1.5rem] font-extrabold leading-[1.15] tracking-[-0.005em] [text-wrap:balance] md:text-3xl md:leading-tight">
                        {s.title}
                      </h2>
                    </div>
                    <div className="space-y-4 text-[16px] leading-[1.7] text-ink/80 antialiased [text-wrap:pretty] md:space-y-5 md:text-[17px] md:leading-[1.75]">
                      {s.body}
                    </div>
                    {i < sections.length - 1 && (
                      <div className="mt-12 h-px w-12 bg-tomato/60 md:mt-14 md:w-16" aria-hidden />
                    )}
                  </section>
                ))}
              </div>

              {/* Footer CTA */}
              <div className="mx-auto mt-6 max-w-[68ch] border-t border-ink/15 pt-10 md:mt-8">
                <p className="mk-overline text-tomato">§ Get in touch</p>
                <h3 className="font-display mt-3 text-[1.5rem] font-extrabold leading-[1.15] [text-wrap:balance] md:text-3xl md:leading-tight">
                  Questions, requests, or corrections?
                </h3>
                <p className="font-serif mt-4 text-[16px] leading-[1.7] text-ink/75 md:text-lg md:leading-relaxed">
                  We read everything. Reach us by email or come hang out in
                  Discord - most policy questions get answered there first.
                </p>
                <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-3">
                  <a
                    href="mailto:hello@pizzadao.org"
                    className="mk-btn-pill justify-center bg-ink text-cream hover:bg-tomato sm:justify-start"
                  >
                    hello@pizzadao.org
                  </a>
                  <a
                    href="https://discord.pizzadao.xyz/"
                    target="_blank"
                    rel="noreferrer"
                    className="mk-btn-pill justify-center border border-ink/20 bg-transparent text-ink hover:border-tomato hover:text-tomato sm:justify-start"
                  >
                    Join the Discord
                  </a>
                  <Link
                    to={HOME_PATH}
                    className="mk-btn-pill justify-center border border-ink/20 bg-transparent text-ink hover:border-tomato hover:text-tomato sm:justify-start"
                  >
                    Back to home
                  </Link>
                </div>
                <p className="ui mt-10 text-[11px] uppercase tracking-[0.22em] text-ink/45">
                  Built for the internet. Shared over pizza.
                </p>
              </div>
            </article>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
};

export default LegalLayout;
