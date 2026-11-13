"use client";

import { MapPin, Sparkles, Waves, Radio, LayoutGrid } from "lucide-react";
import PhotoVeil from "@/app/(marketing)/_site/components/PhotoVeil";

const VALUE_PROPS = [
  {
    n: "01",
    k: "Trusted Local Distribution",
    v: "Hundreds of pizzerias in real neighborhoods. Your brand shows up where people already gather.",
    icon: MapPin,
  },
  {
    n: "02",
    k: "Founder + Builder Access",
    v: "Direct lines to founders, developers, and operators shaping what's next.",
    icon: Sparkles,
  },
  {
    n: "03",
    k: "Cultural Relevance",
    v: "Programs that feel native. Built with communities, not around them.",
    icon: Waves,
  },
  {
    n: "04",
    k: "Earned Media",
    v: "Moments people talk about. Content that spreads because it deserves to.",
    icon: Radio,
  },
  {
    n: "05",
    k: "Global Activation, No Ops",
    v: "We coordinate the logistics and playbook. You provide the brief.",
    icon: LayoutGrid,
  },
];

const PROOF: { k: string; v: string; sub?: string; num?: number; prefix?: string; suffix?: string }[] = [
  { k: "City network", v: "400+", sub: "independently organized", num: 400, suffix: "+" },
  { k: "Countries", v: "100+", sub: "active chapters", num: 100, suffix: "+" },
  { k: "Annual attendance", v: "20,000+", sub: "real-world participants", num: 20000, suffix: "+" },
  { k: "Repeat collaborators", v: "60+", sub: "brands, year over year", num: 60, suffix: "+" },
];


import { useEffect, useRef, useState } from "react";

const CountUp = ({ value, suffix = "", fallback }: { value?: number; suffix?: string; fallback: string }) => {
  const [n, setN] = useState(0);
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (value === undefined) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting && !started) {
            setStarted(true);
            const duration = 1400;
            const start = performance.now();
            const tick = (t: number) => {
              const p = Math.min(1, (t - start) / duration);
              const eased = 1 - Math.pow(1 - p, 3);
              setN(Math.round(value * eased));
              if (p < 1) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }
        });
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [value, started]);

  if (value === undefined) return <span ref={ref}>{fallback}</span>;
  return (
    <span ref={ref}>
      {n.toLocaleString()}
      {suffix}
    </span>
  );
};

const Sponsorship = () => {
  return (
    <section
      id="partner-with-us"
      className="relative overflow-hidden bg-butter/25 pt-16 text-ink md:pt-24"
    >
      {/* Top hairline + soft tonal bridge from cream hero above */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-ink/10" />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-20"
        style={{
          background:
            "linear-gradient(180deg, hsl(40 55% 93%) 0%, transparent 100%)",
        }}
      />
      {/* Organic tonal warmth - off-axis warm pool, no even grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 28% 38%, hsl(44 80% 80% / 0.35) 0%, transparent 65%)",
        }}
      />
      {/* Soft cooler tonal shift toward the lower right - printed unevenness */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 55% 50% at 82% 78%, hsl(38 30% 78% / 0.22) 0%, transparent 60%)",
        }}
      />
      {/* Edge wear - slight darkening at the page margins */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 50%, transparent 62%, hsl(30 30% 35% / 0.06) 100%)",
        }}
      />

      {/* Masthead */}
      <div className="container relative">
        <div className="relative border-t-2 border-ink pt-5 md:pt-6">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-4">
            <div className="col-span-12 md:col-span-7">
              <p className="mk-overline text-tomato">Why it works</p>
              <h2 className="font-display mt-2 text-display-1 font-extrabold leading-[0.9] tracking-[0.005em] text-ink">
                Why brands
                <br />
                <span className="text-ink">partner with PizzaDAO.</span>
              </h2>
            </div>
            <div className="col-span-12 md:col-span-5 md:pl-8">
              <p className="text-lg leading-[1.45] text-ink/85 md:text-xl">
                Trust, coordinated globally. Built city by city, by the people who already live there.
              </p>
              <p className="mt-2 text-[15px] leading-[1.6] text-ink/65">
                PizzaDAO is a 400-city network of independently organized
                chapters. Brands plug into a real, repeating, IRL community -
                not a list, not a mailshot, not a pop-up.
              </p>
            </div>
          </div>
        </div>

        {/* Proof ledger - operational credibility, slight overlap with masthead */}
        <div className="relative mt-5 rounded-2xl border border-ink/15 bg-cream shadow-[var(--shadow-lifted)] md:mt-6">
          {/* Asymmetric annotation - slight tension off the corner */}
          <span
            aria-hidden
            className="mk-handwritten absolute -top-3 right-4 -rotate-[6deg] text-[12px] text-tomato md:right-6"
          >
            ↘ what we measure
          </span>
          <dl className="grid grid-cols-2 md:grid-cols-4">
            {PROOF.map((p, i) => (
              <div
                key={p.k}
                className={`px-5 py-5 md:px-7 md:py-7 ${
                  i > 0 ? "md:border-l md:border-ink/15" : ""
                } ${i === 1 ? "border-l border-ink/15" : ""} ${
                  i >= 2 ? "border-t border-ink/15 md:border-t-0" : ""
                }`}
              >
                <dt className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-tomato">
                  {p.k}
                </dt>
                <dd className="font-display mt-2 text-[clamp(2.5rem,6.2vw,5rem)] font-extrabold leading-[0.82] tracking-[-0.015em] text-ink">
                  <CountUp value={p.num} suffix={p.suffix} fallback={p.v} />
                </dd>
                {p.sub && (
                  <p className="ui mt-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-ink/55">
                    {p.sub}
                  </p>
                )}
              </div>
            ))}
          </dl>
        </div>

        {/* Trust rail - small operational signals beneath the ledger */}
        <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-[11px] font-medium text-ink/55">
          <li className="ui uppercase tracking-[0.18em]">
            <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-[1px] rounded-full bg-tomato align-middle" />
            Annual Global Pizza Party · 5 years running
          </li>
          <li className="ui uppercase tracking-[0.18em]">
            <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-[1px] rounded-full bg-tomato align-middle" />
            6 continents · 100+ countries
          </li>
          <li className="ui uppercase tracking-[0.18em]">
            <span className="mr-2 inline-block h-1.5 w-1.5 -translate-y-[1px] rounded-full bg-tomato align-middle" />
            Locally organized, globally coordinated
          </li>
        </ul>
      </div>



      {/* Value props - refined capabilities overview */}
      <div className="container mt-8 md:mt-12">
        <div className="grid grid-cols-12 gap-x-6 gap-y-5">
          <div className="col-span-12 md:col-span-4">
            <p className="mk-overline text-tomato">What you receive</p>
            <h3 className="font-display mt-2 text-display-2 font-extrabold leading-[0.95] tracking-[0.005em] text-ink">
              Five things
              <br />
              <span className="text-ink">we deliver.</span>
            </h3>
            <p className="mt-2 text-[15px] leading-relaxed text-ink/60">
              Bespoke programs built on these foundations.
            </p>
          </div>

          <ol className="col-span-12 md:col-span-8 md:pl-6">
            <div className="border-t border-ink/15">
              {VALUE_PROPS.map((vp, i) => {
                const Icon = vp.icon;
                return (
                  <li
                    key={vp.n}
                    className="group relative border-b border-ink/15 py-4 md:py-5"
                  >
                    <div className="grid grid-cols-12 items-start gap-x-4 gap-y-2">
                      <div className="col-span-12 md:col-span-5">
                        <div className="flex items-center gap-2.5">
                          <Icon size={15} strokeWidth={1.25} className="shrink-0 text-ink/20" />
                          <h4 className="font-display text-[1.4rem] font-extrabold leading-[1.05] tracking-[-0.01em] md:text-[1.6rem]">
                            {vp.k}
                          </h4>
                        </div>
                      </div>
                      <div className="col-span-12 md:col-span-7 md:relative md:pl-2">
                        <p className="text-[14px] leading-[1.55] text-ink/70 md:text-[15px]">
                          {vp.v}
                        </p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </div>
          </ol>
        </div>
      </div>

      {/* What we build together - edge-to-edge cream-warm band, layered into flow */}
      <div className="mk-paper-soft paper-drift relative mt-7 overflow-hidden bg-cream-warm py-8 md:mt-9 md:py-11">
        {/* Soft tonal transition at top - fades from butter/25 above into cream-warm */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-24"
          style={{
            background:
              "linear-gradient(180deg, hsl(44 60% 92% / 0.9) 0%, transparent 100%)",
          }}
        />
        {/* Edge darkening - subtle vignette pulling focus inward */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, transparent 55%, hsl(30 30% 60% / 0.08) 100%)",
          }}
        />
        {/* Understated grain */}
        <div aria-hidden className="mk-grain pointer-events-none absolute inset-0 opacity-[0.22]" />
        {/* Hairline top + bottom rules - editorial section markers */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-ink/10" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-ink/10" />
        {/* Photographic warmth - hands at work, integrated into right edge */}
        <PhotoVeil variant="hands" position="right" opacity={0.05} blend="multiply" />

        <div className="container relative">
          <div className="relative pt-2 md:pt-4">
            {/* IRL stamp - floats on the band, no opaque chip */}
            <span aria-hidden className="ui absolute -top-1 left-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato">
              IRL ·  built in cities
            </span>
            <div className="grid grid-cols-12 items-end gap-x-8 gap-y-5 md:gap-x-12">
              <div className="col-span-12 md:col-span-8">
                <p className="mk-overline text-tomato">Possibilities</p>
                <h3 className="font-display mt-3 text-display-2 font-extrabold leading-[0.88] tracking-[-0.02em] md:mt-4">
                  What we build
                  <br />
                  <span className="mk-handwritten text-tomato text-[1.05em]">together.</span>
                </h3>
              </div>

              <div className="col-span-12 md:col-span-4 md:pl-10 md:pb-2">
                <p className="font-serif text-[15.5px] leading-[1.65] text-ink/70 md:text-[15px]">
                  Five formats we know how to run, and a hundred more we'd love to invent with you.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:mt-12 md:grid-cols-2 md:gap-7 lg:grid-cols-3 lg:auto-rows-fr">
            {[
              {
                k: "Global Moments",
                v: "Large-scale activations across hundreds of cities, built to create shared global experiences. One brief, one weekend, hundreds of independent chapters showing up in parallel.",
                note: "400+ cities, one weekend",
                accent: "global",
                stamp: "WORLDWIDE",
                tilt: "-rotate-[1.2deg]",
                featured: true,
                stats: [
                  { k: "Cities", v: "400+" },

                  { k: "Continents", v: "6" },
                  { k: "Lead time", v: "8 wks" },
                ],
                motif: (
                  <svg viewBox="0 0 200 120" className="absolute -right-6 -top-4 h-28 w-44 text-ink/[0.07]" fill="none" stroke="currentColor" strokeWidth="0.8">
                    <ellipse cx="100" cy="60" rx="80" ry="40" />
                    <ellipse cx="100" cy="60" rx="60" ry="40" />
                    <ellipse cx="100" cy="60" rx="40" ry="40" />
                    <ellipse cx="100" cy="60" rx="20" ry="40" />
                    <path d="M20 60h160M30 35h140M30 85h140" />
                  </svg>
                ),
                motifLg: (
                  <svg viewBox="0 0 400 260" className="pointer-events-none absolute -right-12 -bottom-10 h-[280px] w-[460px] text-ink/[0.07]" fill="none" stroke="currentColor" strokeWidth="0.7">
                    <ellipse cx="200" cy="130" rx="170" ry="90" />
                    <ellipse cx="200" cy="130" rx="135" ry="90" />
                    <ellipse cx="200" cy="130" rx="100" ry="90" />
                    <ellipse cx="200" cy="130" rx="60" ry="90" />
                    <ellipse cx="200" cy="130" rx="20" ry="90" />
                    <path d="M30 130h340M40 80h320M40 180h320M40 50h320M40 210h320" />
                    {/* network dots - chapter cities */}
                    <g fill="currentColor" stroke="none">
                      <circle cx="80" cy="80" r="2" />
                      <circle cx="135" cy="55" r="1.6" />
                      <circle cx="170" cy="90" r="2.2" />
                      <circle cx="220" cy="65" r="1.8" />
                      <circle cx="265" cy="100" r="2" />
                      <circle cx="310" cy="80" r="1.6" />
                      <circle cx="105" cy="170" r="1.8" />
                      <circle cx="160" cy="195" r="2" />
                      <circle cx="225" cy="180" r="1.6" />
                      <circle cx="285" cy="170" r="2.2" />
                      <circle cx="335" cy="195" r="1.6" />
                    </g>
                    {/* faint arcs */}
                    <path d="M80 80 Q 200 -10 320 80" strokeDasharray="2 3" />
                    <path d="M105 170 Q 200 260 295 170" strokeDasharray="2 3" />
                  </svg>
                ),
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
                    <circle cx="12" cy="12" r="9" />
                    <ellipse cx="12" cy="12" rx="4" ry="9" />
                    <path d="M3 12h18M5 7h14M5 17h14" />
                  </svg>
                ),
              },
              {
                k: "Local Takeovers",
                v: "City-by-city brand presence through trusted neighborhood pizzerias.",
                note: "on the corner you already know",
                accent: "local energy",
                stamp: "NEIGHBORHOOD",
                tilt: "rotate-[1.6deg]",
                motif: (
                  <svg viewBox="0 0 200 120" className="absolute -right-4 -top-6 h-28 w-40 text-ink/[0.08]" fill="none" stroke="currentColor" strokeWidth="0.8">
                    <path d="M10 90 L60 40 L100 70 L150 30 L190 80" />
                    <circle cx="60" cy="40" r="3" />
                    <circle cx="100" cy="70" r="3" />
                    <circle cx="150" cy="30" r="3" />
                    <path d="M60 40 L60 95M100 70 L100 95M150 30 L150 95" strokeDasharray="2 3" />
                  </svg>
                ),
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13z" />
                    <circle cx="12" cy="9" r="2.4" />
                  </svg>
                ),
              },
              {
                k: "Builder Collaborations",
                v: "Hackathons, product integrations, and experimental launches with founders and developers.",
                note: "shipped in a weekend",
                accent: "experimental",
                stamp: "FIELD KIT",
                tilt: "-rotate-[2deg]",
                motif: (
                  <svg viewBox="0 0 200 120" className="absolute -right-8 -top-4 h-28 w-44 text-ink/[0.07]" fill="none" stroke="currentColor" strokeWidth="0.8">
                    <path d="M10 60 L60 60 L70 40 L130 40 L140 60 L190 60" />
                    <path d="M10 60 L60 60 L70 80 L130 80 L140 60" />
                    <circle cx="100" cy="60" r="14" />
                    <path d="M100 46 L100 74M86 60 L114 60" />
                  </svg>
                ),
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2.5l1.8 5.6 5.7.3-4.6 3.6 1.7 5.7L12 14.6l-4.6 3.1 1.7-5.7-4.6-3.6 5.7-.3z" />
                  </svg>
                ),
              },
              {
                k: "Cultural Programming",
                v: "Artist residencies, food and culture crossovers, and community-led events.",
                note: "vol. 04 · ongoing",
                accent: "community-led",
                stamp: "ARCHIVE",
                tilt: "rotate-[1.2deg]",
                motif: (
                  <svg viewBox="0 0 200 120" className="absolute -right-4 -top-6 h-28 w-44 text-ink/[0.07]" fill="none" stroke="currentColor" strokeWidth="0.8">
                    <rect x="30" y="20" width="60" height="80" />
                    <rect x="110" y="20" width="60" height="80" />
                    <path d="M40 35h40M40 50h40M40 65h30M120 35h40M120 50h40M120 65h25" />
                  </svg>
                ),
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="1.5" />
                    <rect x="7" y="7" width="10" height="10" rx="0.5" />
                    <path d="M9.5 12h5M12 9.5v5" />
                  </svg>
                ),
              },
              {
                k: "Experimental Activations",
                v: "NFC pizza boxes, AR experiences, AI-generated menus, and unexpected formats.",
                note: "tap the box, see what happens",
                accent: "IRL",
                stamp: "PROTOTYPE",
                tilt: "-rotate-[1.4deg]",
                motif: (
                  <svg viewBox="0 0 200 120" className="absolute -right-6 -top-6 h-28 w-44 text-ink/[0.07]" fill="none" stroke="currentColor" strokeWidth="0.8">
                    <circle cx="100" cy="60" r="50" />
                    <circle cx="100" cy="60" r="35" />
                    <circle cx="100" cy="60" r="20" />
                    <path d="M100 10v100M50 60h100M65 25l70 70M135 25l-70 70" strokeDasharray="2 4" />
                  </svg>
                ),
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 20L12 4l9 16z" />
                    <circle cx="9.5" cy="15.5" r="0.9" fill="currentColor" stroke="none" />
                    <circle cx="14" cy="14" r="0.9" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="11" r="0.9" fill="currentColor" stroke="none" />
                  </svg>
                ),
              },
            ].map((b, i) => {
              const featured = b.featured;
              return (
                <article
                  key={b.k}
                  className={`group mk-paper-soft paper-drift relative flex flex-col overflow-hidden ring-1 ring-ink/10 transition-all duration-500 ease-out hover:-translate-y-[5px] hover:rotate-[-0.2deg] hover:ring-tomato/30 ${
                    featured
                      ? "lg:col-span-2 lg:row-span-2 rounded-[18px] bg-cream-warm p-7 md:p-10 lg:p-12 shadow-[0_3px_0_hsl(var(--ink)/0.08),0_30px_70px_-30px_hsl(28_60%_30%/0.35),0_10px_24px_-12px_hsl(var(--tomato)/0.18)] hover:shadow-[0_55px_120px_-40px_hsl(28_60%_25%/0.45),0_14px_36px_-14px_hsl(var(--tomato)/0.28)]"
                      : "rounded-[14px] bg-cream p-6 md:p-8 shadow-[0_2px_0_hsl(var(--ink)/0.06),0_22px_50px_-32px_hsl(28_50%_25%/0.32)] hover:bg-cream-warm hover:shadow-[0_44px_100px_-44px_hsl(28_55%_22%/0.42),0_12px_30px_-16px_hsl(var(--tomato)/0.22)]"
                  }`}
                  style={{
                    borderTopLeftRadius: featured ? "22px" : i % 2 === 0 ? "18px" : "12px",
                    borderBottomRightRadius: featured ? "14px" : i % 2 === 0 ? "12px" : "18px",
                  }}
                >
                  {/* Inner grain - tactile paper feel */}
                  <div aria-hidden className="mk-grain pointer-events-none absolute inset-0 opacity-[0.22]" />
                  {/* Soft warm wash for emotional energy */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-0"
                    style={{
                      background: featured
                        ? "radial-gradient(ellipse at 85% 90%, hsl(var(--butter) / 0.28) 0%, transparent 55%), radial-gradient(ellipse at 15% 10%, hsl(var(--tomato) / 0.06) 0%, transparent 50%)"
                        : "radial-gradient(ellipse at 80% 100%, hsl(var(--butter) / 0.14) 0%, transparent 60%)",
                    }}
                  />

                  {/* Decorative motif fragment */}
                  {featured ? b.motifLg : b.motif}

                  {/* Featured ribbon - tiny editorial mark */}
                  {featured && (
                    <span
                      aria-hidden
                      className="ui absolute left-0 top-7 rounded-r-full bg-tomato px-3 py-1 text-[9.5px] font-semibold uppercase tracking-[0.24em] text-cream shadow-[0_6px_14px_-6px_hsl(var(--tomato)/0.55)]"
                    >
                      Featured · Fig. 01
                    </span>
                  )}

                  {/* Corner stamp */}
                  <span
                    aria-hidden
                    className={`ui absolute right-4 top-4 ${b.tilt} rounded-full border border-ink/15 px-2 py-[3px] text-[8.5px] font-semibold uppercase tracking-[0.22em] text-ink/55 transition-colors duration-500 group-hover:border-tomato/40 group-hover:text-tomato`}
                  >
                    {b.stamp}
                  </span>

                  <div className="relative flex items-start justify-between">
                    {!featured && (
                      <span className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-ink/45">
                        Fig. {String(i + 1).padStart(2, "0")}
                      </span>
                    )}
                    {featured && <span aria-hidden className="block h-5" />}
                    <span
                      aria-hidden
                      className={`${featured ? "h-9 w-9 text-tomato/70" : "h-7 w-7 text-ink/35"} transition-colors duration-500 group-hover:text-tomato`}
                    >
                      {b.icon}
                    </span>
                  </div>

                  <h4
                    className={`font-display relative font-extrabold tracking-[-0.018em] transition-colors duration-500 group-hover:text-tomato ${
                      featured
                        ? "mt-12 text-[2.4rem] leading-[0.98] md:mt-16 md:text-[3.1rem] lg:text-[3.5rem]"
                        : "mt-8 text-[1.85rem] leading-[1.02] md:mt-10 md:text-[2.05rem]"
                    }`}
                  >
                    {b.k}
                  </h4>

                  {/* Imperfect underline */}
                  <svg
                    aria-hidden
                    viewBox="0 0 120 6"
                    className={`mt-2.5 h-[6px] transition-colors duration-500 group-hover:text-tomato ${
                      featured ? "w-32 text-tomato/60" : "w-20 text-ink/30"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  >
                    <path d="M2 3 Q 30 1 60 3 T 118 3" />
                  </svg>

                  <p
                    className={`font-serif text-ink/75 ${
                      featured
                        ? "mt-5 max-w-[42ch] text-[16.5px] leading-[1.6] md:text-[17.5px] md:leading-[1.55]"
                        : "mt-4 text-[15px] leading-[1.65] md:text-[15.5px]"
                    }`}
                  >
                    {b.v}
                  </p>

                  {/* Featured mini-stats row */}
                  {featured && b.stats && (
                    <dl className="relative mt-6 grid grid-cols-3 gap-x-4 border-t border-ink/15 pt-5 md:mt-8 md:pt-6">
                      {b.stats.map((s) => (
                        <div key={s.k}>
                          <dd className="font-display text-[1.6rem] font-extrabold leading-none tracking-[-0.02em] text-ink md:text-[1.85rem]">
                            {s.v}
                          </dd>
                          <dt className="ui mt-1.5 text-[9.5px] font-medium uppercase tracking-[0.22em] text-ink/50">
                            {s.k}
                          </dt>
                        </div>
                      ))}
                    </dl>
                  )}

                  {/* Spacer pushes annotation to bottom on featured */}
                  {featured && <div className="flex-1" aria-hidden />}

                  {/* Annotation - always visible on featured, reveal on others */}
                  <p
                    className={`ui mt-4 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.22em] ${
                      featured
                        ? "text-tomato"
                        : "text-ink/55 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`inline-block h-px ${featured ? "w-8 bg-tomato" : "w-6 bg-tomato"}`}
                    />
                    ↳ {b.note}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </div>


      {/* CTA band - edge-to-edge butter, layered transition from cream-warm above */}
      <div className="relative overflow-hidden bg-butter pb-8 pt-10 md:pb-10 md:pt-11">
        {/* Organic warm tonal pool - off-center, no even gradient fade */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 65% 70% at 38% 48%, hsl(44 95% 76% / 0.40) 0%, transparent 60%)",
          }}
        />
        {/* Counter-tone - subtle deeper butter at lower right for printed unevenness */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 55% 55% at 85% 80%, hsl(40 85% 60% / 0.18) 0%, transparent 60%)",
          }}
        />
        {/* Edge wear - soft vignette for printed dimensionality */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at 50% 50%, transparent 58%, hsl(30 40% 30% / 0.10) 100%)",
          }}
        />
        {/* Top hairline - clean editorial join */}
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-ink/12" />
        {/* Subtle paper grain only - no dot patterns */}
        <div aria-hidden className="mk-grain pointer-events-none absolute inset-0 opacity-[0.28]" />

        <div className="container relative">
          {/* Tighter, more editorial composition */}
          <div className="grid grid-cols-12 items-end gap-x-8 gap-y-6 md:gap-x-10">
            {/* Left: headline + copy + annotations, tightly grouped */}
            <div className="col-span-12 md:col-span-7 lg:col-span-7">
              <p className="mk-overline text-tomato">Bespoke programs</p>
              <h3 className="font-display mt-2 text-display-2 font-extrabold leading-[0.9] tracking-[-0.02em]">
                Build something
                <br />
                people actually{" "}
                <span
                  className="mk-handwritten inline-block text-tomato"
                  style={{
                    transform: "rotate(-2.5deg)",
                    fontSize: "0.72em",
                    verticalAlign: "0.14em",
                  }}
                >
                  show up
                </span>
                {" "}to.
              </h3>
              <p className="mt-3 max-w-md text-[15px] leading-[1.55] text-ink/70 md:text-base">
                Tell us what you're trying to do. We'll shape it into something worth showing up for.
              </p>

              {/* Subtle supporting annotations - editorial micro-labels */}
              <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
                {["IRL matters", "shared moments", "community-first"].map((tag) => (
                  <li
                    key={tag}
                    className="ui flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.22em] text-ink/45"
                  >
                    <span className="inline-block h-1 w-1 rounded-full bg-tomato/70" />
                    {tag}
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: buttons, aligned with baseline of headline, more integrated */}
            <div className="col-span-12 flex flex-col gap-2.5 md:col-span-5 lg:col-span-5 md:items-end md:pb-1">
              <a
                href="https://t.me/snack_man"
                target="_blank"
                rel="noopener noreferrer"
                className="mk-btn-pill-lg group bg-tomato text-cream shadow-[var(--shadow-soft)] hover:-translate-y-[2px] hover:bg-tomato-deep hover:shadow-[var(--shadow-lifted)]"
              >
                <span>Reach out to partner</span>
                <span aria-hidden className="transition-transform duration-500 ease-out group-hover:translate-x-1">→</span>
              </a>

            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Sponsorship;
