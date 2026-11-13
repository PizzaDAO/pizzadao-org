"use client";

import { useEffect, useMemo, useState } from "react";
import { HOME_PATH } from "@/app/(marketing)/_site/lib/router";
import { ArrowUpRight, Sparkles, Pizza, Wrench, Palette, Users, Code2, MapPin } from "lucide-react";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/app/(marketing)/_site/components/ui/dialog";
import Footer from "@/app/(marketing)/_site/components/Footer";
import { track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";
const community = "/marketing/assets/community.jpg";
const hackathon = "/marketing/assets/hackathon.jpg";
const party = "/marketing/assets/timeline-party.jpg";
const hands = "/marketing/assets/hands-pizza.jpg";
const pizzeria = "/marketing/assets/pizzeria.jpg";
const hourpayStage = "/marketing/assets/hourpay-stage.jpg";
const secretPineapple = "/marketing/assets/secret-pineapple.jpg";
const rsvPizza = "/marketing/assets/rsv-pizza.png";
const slice = "/marketing/assets/slice.webp";
const WAYS_IN = [
  {
    icon: Pizza,
    tag: "Host",
    title: "Throw a pizza party",
    one: "Pick a date. Pick a pizzeria. We back it.",
    more: "Budget, playbook, and chapter support handled. You bring the neighborhood.",
  },
  {
    icon: Wrench,
    tag: "Build",
    title: "Ship tools + projects",
    one: "Open repos, real users, shipped fast.",
    more: "RSVP systems, on-chain receipts, chapter dashboards. Pick up an issue or pitch your own.",
  },
  {
    icon: Palette,
    tag: "Create",
    title: "Make the art + culture",
    one: "Posters, zines, mixtapes, films, merch.",
    more: "Every chapter ships its own visual language. Submit to the pool, watch it travel.",
  },
  {
    icon: Users,
    tag: "Gather",
    title: "Hold the room",
    one: "Long tables, slice clubs, coworking nights.",
    more: "Recurring rituals that turn strangers into regulars and regulars into friends.",
  },
  {
    icon: Code2,
    tag: "Experiment",
    title: "Run a hackathon",
    one: "Devs, designers and pizzaiolos, one weekend.",
    more: "Set the prompt, line up the pizza, judge the demos. Prizes paid in slices and grants.",
  },
  {
    icon: MapPin,
    tag: "Grow",
    title: "Open a city",
    one: "Start a chapter where there isn't one yet.",
    more: "Onboard the next organizers, then hand them the keys. New chapters launched by members, not HQ.",
  },
];

type Voice =
  | {
      kind: "quote";
      name: string;
      city: string;
      quote: string;
      span?: string;
      tilt?: string;
    }
  | {
      kind: "note";
      name: string;
      city: string;
      note: string;
      span?: string;
      tilt?: string;
    }
  | {
      kind: "screenshot";
      handle: string;
      channel: string;
      lines: { who: "them" | "me"; text: string }[];
      span?: string;
      tilt?: string;
    }
  | {
      kind: "stat";
      name: string;
      city: string;
      stat: string;
      label: string;
      span?: string;
      tilt?: string;
    };

const VOICES: Voice[] = [
  {
    kind: "quote",
    name: "Margherita Ciro",
    city: "Naples",
    quote:
      "I came for the pizza. I stayed because nobody asked me what I did for a living.",
    span: "md:col-span-7",
    tilt: "md:-rotate-[0.6deg]",
  },
  {
    kind: "note",
    name: "Sister Marinara",
    city: "Lagos",
    note:
      "Four friends. A folding table. Now it's the block's calendar.",
    span: "md:col-span-5 md:translate-y-3",
    tilt: "md:rotate-[0.8deg]",
  },
  {
    kind: "screenshot",
    handle: "@donmami",
    channel: "#cdmx-chapter",
    lines: [
      { who: "them", text: "wait, is the long table still on for sunday?" },
      { who: "me", text: "yes. bring 2 chairs and somebody new." },
      { who: "them", text: "on it 🍕" },
    ],
    span: "md:col-span-5 md:-translate-y-2",
    tilt: "md:-rotate-[1deg]",
  },
  {
    kind: "quote",
    name: "Capo Crust",
    city: "Brooklyn",
    quote:
      "600 people in a parking lot. Nobody fought. Two people got engaged.",
    span: "md:col-span-7",
    tilt: "md:rotate-[0.4deg]",
  },
  {
    kind: "stat",
    name: "Tinashe O.",
    city: "Harare",
    stat: "0 → 84",
    label: "RSVPs in 6 days, first chapter night",
    span: "md:col-span-5",
    tilt: "md:-rotate-[0.5deg]",
  },
  {
    kind: "note",
    name: "Don Mami",
    city: "Mexico City",
    note:
      "The only group chat I haven't muted in three years.",
    span: "md:col-span-7 md:translate-y-2",
    tilt: "md:rotate-[0.6deg]",
  },
];

const RITUALS = [
  { k: "Mon", v: "Open call, anyone can pitch a project." },
  { k: "Wed", v: "Chapter sync, 60+ cities, one shared notebook." },
  { k: "Fri", v: "Field reports drop in #journal." },
  { k: "Sun", v: "Slice club, long table, no agenda." },
];

type Build = {
  name: string;
  tag: "Experiment" | "Hackathon" | "Live-tested" | "Arcade";
  hook: string;
  mission: string;
  context: string;
  detail: string;
  img: string | null;
  demo?: string;
  embed?: string;
  featured?: boolean;
  metric?: { k: string; v: string }[];
};

const BUILDS: Build[] = [
  {
    name: "Plan.xyz · rsv.pizza",
    tag: "Live-tested",
    hook: "Event infrastructure for global, decentralized gatherings.",
    mission: "Open RSVPs, chapter dashboards, and proof-of-attendance in one stack.",
    context: "Tested live during Global Pizza Party 2026 across ~30k attendees worldwide, running hundreds of simultaneous parties in dozens of cities.",
    detail: "Now the default RSVP and check-in layer for chapter events, with public APIs so any community - pizza or otherwise - can use it.",
    img: rsvPizza,
    demo: "https://rsv.pizza",
    featured: true,
    metric: [
      { k: "~30k", v: "attendees routed" },
      { k: "Global Pizza Party 2026", v: "stress-tested live" },
      { k: "Open APIs", v: "any chapter can self-host" },
    ],
  },
  {
    name: "PizzaDAO Arcade",
    tag: "Arcade",
    hook: "Pizza games, built and shipped by members.",
    mission: "Community-built pizza games and a roving arcade cabinet.",
    context: "A traveling cabinet, an open game jam, and a growing library of pizza-themed games made by members - hardware, code, and pixel art, shipped together.",
    detail: "Started as a one-night build at a chapter meetup and grew into an ongoing collab between hardware tinkerers, indie devs, and visual artists. The catalog is open for any chapter to install or remix.",
    img: hackathon,
    embed: "https://c-r-x-s-s.github.io/PizzaDAO-Arcade/",
  },
  {
    name: "HourPay",
    tag: "Hackathon",
    hook: "Streaming payroll for the people who keep kitchens running.",
    mission: "Paid by the hour, not the pay cycle.",
    context: "A working experiment aimed at reducing reliance on payday loans for pizzeria and hospitality staff. Wages stream in real time as the shift happens.",
    detail: "Built by member-operators who watched their own teams struggle between paydays. In pilot with a small group of independent pizzerias.",
    img: hourpayStage,
  },
  {
    name: "Secret Pineapple",
    tag: "Hackathon",
    hook: "Anonymous receipts, itemized and verifiable.",
    mission: "Cryptographically anonymized, itemized receipts.",
    context: "A hackathon-winning prototype exploring how to prove what was purchased without revealing who bought it - useful for sponsorships, reimbursements, and public-goods accounting.",
    detail: "Combines zero-knowledge proofs with itemized receipt schemas so chapters can transparently report spending without doxxing members or vendors.",
    img: secretPineapple,
  },
];

const CommunityPage = () => {
  const [activeBuild, setActiveBuild] = useState<number | null>(null);
  const [embedSite, setEmbedSite] = useState<{ name: string; url: string } | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const openBuild = (i: number) => {
    const b = BUILDS[i];
    track(EVT.COMMUNITY_BUILD_VIEWED, {
      name: b?.name,
      index: i,
      featured: Boolean(b?.featured),
    });
    setActiveBuild(i);
  };

  const openEmbed = (site: { name: string; url: string }) => {
    track(EVT.COMMUNITY_BUILD_EMBED_OPENED, site);
    setEmbedSite(site);
  };

  const navigateGallery = (i: number) => {
    setGalleryIndex((from) => {
      if (from !== i) {
        track(EVT.COMMUNITY_GALLERY_NAVIGATED, { from, to: i });
      }
      return i;
    });
  };


  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav solid />

      {/* HERO, participatory, image-led */}
      <HeroSection />


      {/* MANIFESTO STRIP, high contrast slab */}
      <section className="bg-ink py-16 text-cream md:py-24">
        <div className="container">
          <div className="grid grid-cols-12 gap-x-6 gap-y-10">
            <div className="col-span-12 md:col-span-5">
              <p className="mk-overline text-butter">Manifesto</p>
              <h2 className="font-display mt-5 text-[clamp(2.75rem,7vw,5.5rem)] font-extrabold leading-[0.88] tracking-[-0.01em]">
                Find
                <br />
                your <span className="mk-handwritten marker-bleed relative inline-block text-tomato text-[1.05em] leading-[0.75] -mr-1 translate-y-[0.08em] -rotate-[4deg] align-baseline">crew.</span>
              </h2>
              <p className="ui mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-butter/85">
                Members · Crews · Chapters
              </p>
            </div>
            <div className="col-span-12 md:col-span-6 md:col-start-7 md:translate-y-2">
              <div className="relative space-y-5 border-l-2 border-butter/60 pl-6 md:pl-8">
                <span
                  aria-hidden
                  className="mk-handwritten marker-bleed-butter absolute -left-3 -top-7 hidden text-butter text-[14px] leading-tight -rotate-[8deg] md:block"
                >
                  ↘ read this twice
                </span>
                <p className="font-display text-[clamp(1.6rem,2.6vw,2.25rem)] font-extrabold leading-[1.1] text-cream">
                  Crews coordinate. Chapters host.{" "}
                  <span className="text-butter">Members make the work happen.</span>
                </p>
                <p className="text-base leading-relaxed text-cream/65 md:text-[17px] md:pl-4">
                  Funding, tools, and culture move through whichever crew picks them up this week.
                </p>
              </div>

              <ul className="mt-10 space-y-4 border-t border-cream/20 pt-8">
                {[
                  "Anyone can propose an experiment.",
                  "Anyone can open a chapter in their city.",
                  "Funding follows ideas the community backs.",
                  "Tools, art, and events stay open and remixable.",
                ].map((r, i) => (
                  <li
                    key={r}
                    className={`flex items-baseline gap-5 border-b border-cream/15 pb-4 ${i === 1 ? "md:pl-3" : ""}`}
                  >
                    <span className="ui w-8 text-[11px] tabular-nums text-butter">
                      0{i + 1}
                    </span>
                    <span className="font-display text-xl font-extrabold leading-snug md:text-2xl">
                      {r}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER, liveness band between sections */}
      <div className="overflow-hidden border-y-2 border-ink bg-tomato py-3 text-cream">
        <div className="flex animate-[marquee_40s_linear_infinite] whitespace-nowrap">
          {Array.from({ length: 2 }).map((_, k) => (
            <div key={k} className="flex shrink-0 items-center gap-10 pr-10">
              {[
                "60+ chapters",
                "3,000+ members",
                "Events every week",
                "Open experiments",
                "No fees",
                "No tiers",
                "Anyone can host",
                "Anyone can propose",
                "Funding follows ideas",
              ].map((t) => (
                <span
                  key={`${k}-${t}`}
                  className="ui flex items-center gap-10 text-[11px] font-semibold uppercase tracking-[0.22em]"
                >
                  {t}
                  <span className="text-butter">●</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* WAYS TO PARTICIPATE, workshop board */}
      <section id="ways-in" className="relative overflow-hidden bg-cream py-16 md:py-24">
        {/* FigJam-style dotted board background */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{
            backgroundImage:
              "radial-gradient(hsl(var(--ink) / 0.18) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            maskImage:
              "linear-gradient(to bottom, transparent, black 12%, black 88%, transparent)",
          }}
        />
        <div className="container relative">
          <div className="border-t-2 border-ink pt-8 md:pt-10">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
              <div className="col-span-12 md:col-span-7">
                <p className="mk-overline text-tomato">§ C.01, Ways to participate</p>
                <h2 className="font-display mt-5 text-[clamp(2.5rem,6vw,5rem)] font-extrabold leading-[0.9]">
                  <span className="mk-handwritten marker-bleed relative inline-block text-tomato text-[1.1em] leading-[0.75] -ml-1 translate-y-[0.05em] -rotate-[3deg] align-baseline">find your lane.</span>
                  <br />
                  Show up however fits.
                </h2>
              </div>
              <div className="col-span-12 md:col-span-5 md:pl-8">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                  No application form. No tier system. Pick a lane that fits the
                  time and energy you have this week. Most members end up doing
                  more than one.
                </p>
                <p className="mk-handwritten marker-bleed mt-4 text-tomato text-[15px] md:text-base">
                  ↘ pick a track, start contributing
                </p>
              </div>
            </div>
          </div>

          {/* Board grid - sticky-note cards, slight rotation on desktop only */}
          <div className="mt-12 grid grid-cols-1 gap-5 md:mt-16 md:grid-cols-2 md:gap-7 lg:grid-cols-3">
            {WAYS_IN.map((w, i) => {
              // Alternate paper tones - warm, lightly imperfect
              const tones = [
                "bg-cream",
                "bg-butter/55",
                "bg-cream-warm",
                "bg-butter/40",
                "bg-cream",
                "bg-butter/55",
              ];
              const dotTones = [
                "bg-tomato",
                "bg-ink",
                "bg-tomato",
                "bg-ink",
                "bg-tomato",
                "bg-ink",
              ];
              // Tighter, more believable rotation - like notes set down by a person
              const rots = ["md:-rotate-[0.9deg]", "md:rotate-[0.5deg]", "md:-rotate-[0.4deg]", "md:rotate-[0.8deg]", "md:-rotate-[0.6deg]", "md:rotate-[0.3deg]"];
              // Variable offset - one card (index 2) overlaps into its neighbor on desktop
              const offsets = ["md:translate-y-1", "md:-translate-y-2", "md:translate-y-3 md:-translate-x-2", "md:-translate-y-1", "md:translate-y-2", "md:-translate-y-1"];
              // Subtle scale variance - one is hero-sized
              const scales = ["md:scale-100", "md:scale-[0.97]", "md:scale-[1.04] md:z-10", "md:scale-[0.98]", "md:scale-100", "md:scale-[0.99]"];

              return (
                <article
                  key={w.title}
                  className={`mk-paper-soft group relative flex flex-col rounded-[10px] ${tones[i % tones.length]} ${rots[i % rots.length]} ${offsets[i % offsets.length]} ${scales[i % scales.length]} p-6 md:p-7 shadow-[0_1px_0_hsl(var(--ink)/0.04),0_2px_4px_-2px_hsl(var(--ink)/0.12),0_22px_36px_-26px_hsl(var(--ink)/0.45)] ring-1 ring-ink/[0.06] transition-all duration-300 hover:-translate-y-0.5 hover:rotate-0 hover:shadow-[0_2px_6px_-2px_hsl(var(--ink)/0.18),0_36px_60px_-26px_hsl(var(--ink)/0.5)]`}
                  style={{
                    // soft paper grain - fibrous noise, very low opacity
                    backgroundImage:
                      "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(%23p)' opacity='0.07'/></svg>\")",
                    backgroundBlendMode: "multiply",
                  }}
                >
                  {/* Subtle torn/soft paper edge highlight (top) */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ink/15 to-transparent"
                  />

                  {/* track marker row */}
                  <div className="flex items-center justify-between">
                    <div className="ui flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/70">
                      <span className={`h-2 w-2 rounded-full ${dotTones[i % dotTones.length]}`} />
                      Track {String(i + 1).padStart(2, "0")} · {w.tag}
                    </div>
                    <span className="mk-handwritten text-[18px] leading-none text-tomato md:text-[20px]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>

                  <h3 className="font-display mt-5 text-[22px] font-extrabold leading-[1.05] md:text-[26px]">
                    {w.title}
                  </h3>
                  <p className="mt-3 text-[15px] leading-snug text-ink/75">
                    {w.one}
                  </p>

                  <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-ink/15 pt-4">
                    <p className="ui text-[10px] uppercase tracking-[0.2em] text-ink/55">
                      Open to anyone
                    </p>
                    <ArrowUpRight className="h-4 w-4 text-ink/70 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>

                  {/* Hover reveal */}
                  <div className="mt-2 max-h-0 overflow-hidden text-[13px] leading-relaxed text-ink/65 opacity-0 transition-all duration-300 group-hover:max-h-32 group-hover:opacity-100">
                    {w.more}
                  </div>
                </article>
              );
            })}
          </div>

        </div>
      </section>

      {/* OPEN CALLS - current ways to jump in (extension of Find your lane) */}
      <section className="bg-cream pb-16 pt-4 md:pb-24 md:pt-6">
        <div className="container">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-4">
            <div className="col-span-12 lg:col-span-6">
              <p className="mk-overline text-tomato">§ C.02, Jump in</p>
              <h3 className="font-display mt-4 text-[clamp(1.75rem,3.5vw,2.75rem)] font-extrabold leading-[0.95]">
                Current ways to jump in.
              </h3>
            </div>
            <div className="col-span-12 lg:col-span-5 lg:col-start-8">
              <p className="text-base leading-[1.6] text-ink/70 md:text-lg">
                Some lanes are always open. Others change week to week. If one fits,{" "}
                <span className="text-ink">raise your hand</span>.
              </p>
            </div>
          </div>

          <ul className="mt-8 divide-y divide-ink/10 border-y border-ink/10 md:mt-10">
            {[
              {
                tags: ["Global", "Partnerships"],
                title: "Superconnectors & partnership leads",
                note: "Bridge brands, communities, and ideas through introductions and collaborations.",
                signal: "updated this week",
              },
              {
                tags: ["Pizza", "Operations"],
                title: "Pizzaiolos, operators & pizza builders",
                note: "Share the real shop-floor problems - we'll bring builders alongside you.",
                signal: "looking for collaborators",
              },
              {
                tags: ["Remote", "AI", "Product"],
                title: "AI-native builders, engineers & designers",
                note: "Shape tools for pizza shops, communities, and small businesses worldwide.",
                signal: "active now",
                active: true,
              },
              {
                tags: ["Media", "Culture"],
                title: "Creators, streamers & storytellers",
                note: "Carry the story further across content, media, and internet culture.",
                signal: "open",
              },
              {
                tags: ["Events", "IRL"],
                title: "Community organizers & event architects",
                note: "Host pizza experiences worth remembering - meetups, hackathons, dinners, art shows.",
                signal: "live opportunity",
              },
            ].map((c, i) => (
              <li key={c.title}>
                <a
                  href="/get-your-mafia-name"
                  className={`group relative block rounded-lg px-2 py-5 transition-all duration-200 md:px-3 md:py-6 ${
                    c.active
                      ? "bg-butter/50 hover:-translate-y-0.5 hover:bg-butter/70"
                      : "hover:bg-butter/25 hover:-translate-y-0.5"
                  }`}
                >
                  {c.active && (
                    <span aria-hidden className="pointer-events-none absolute left-0 top-1/2 hidden h-14 w-[4px] -translate-y-1/2 rounded-r bg-tomato md:block" />
                  )}
                  {/* Mobile: stacked */}
                  <div className="flex flex-col gap-3 md:hidden">
                    <div className="flex items-start justify-between gap-4">
                      <span className="ui text-[10px] font-semibold tabular-nums uppercase tracking-[0.22em] text-ink/40">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-ink/45 transition-transform group-hover:translate-x-1 group-hover:-translate-y-0.5 group-hover:text-tomato" />
                    </div>
                    <h4 className="font-display text-left text-lg font-extrabold leading-snug">
                      {c.title}
                    </h4>
                    <p className="text-left text-[14px] leading-[1.6] text-ink/70">
                      {c.note}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`ui inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${c.active ? "bg-tomato text-cream" : "bg-ink/8 text-ink/65"}`}>
                        {c.active && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cream opacity-70" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cream" />
                          </span>
                        )}
                        {c.signal}
                      </span>
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="ui rounded-full border border-ink/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/65"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Desktop / tablet: aligned 12-col */}
                  <div className="hidden md:grid md:grid-cols-12 md:items-center md:gap-x-6">
                    <span className="ui col-span-1 text-[10px] font-semibold tabular-nums uppercase tracking-[0.22em] text-ink/40">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="col-span-4">
                      <h4 className={`font-display text-left font-extrabold leading-[1.1] ${c.active ? "text-[1.35rem] lg:text-[1.55rem]" : "text-lg lg:text-xl"}`}>
                        {c.title}
                      </h4>
                      <span className={`ui mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] ${c.active ? "bg-tomato text-cream shadow-[0_4px_14px_-4px_hsl(var(--tomato)/0.6)]" : "bg-ink/[0.07] text-ink/65"}`}>
                        {c.active && (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cream opacity-70" />
                            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cream" />
                          </span>
                        )}
                        {c.signal}
                      </span>
                    </div>
                    <p className="col-span-4 text-left text-[14px] leading-[1.6] text-ink/70 lg:text-[15px]">
                      {c.note}
                    </p>
                    <div className="col-span-2 flex flex-wrap items-center gap-1.5">
                      {c.tags.map((t) => (
                        <span
                          key={t}
                          className="ui rounded-full border border-ink/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/65"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                    <ArrowUpRight className="col-span-1 h-4 w-4 justify-self-end text-ink/45 transition-transform group-hover:translate-x-1 group-hover:text-tomato" />
                  </div>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* VOICES, magazine pull-quotes on butter */}
      <section className="bg-butter py-16 text-ink md:py-24">
        <div className="container">
          <div className="border-t-2 border-ink pt-8 md:pt-10">
            <p className="mk-overline text-tomato">§ C.03, Voices from the floor</p>
            <h2 className="font-display mt-5 text-[clamp(2.5rem,6vw,5rem)] font-extrabold leading-[0.9]">
              Unedited.
              <br />
              From members.
            </h2>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-5 md:mt-16 md:grid-cols-12 md:gap-6">
            {VOICES.map((v, i) => {
              const baseCard =
                "group relative flex flex-col justify-between rounded-2xl border-2 border-ink bg-cream transition-transform duration-300 hover:-translate-y-1 hover:rotate-0 shadow-[0_1px_0_hsl(var(--ink)/0.08),0_22px_36px_-26px_hsl(var(--ink)/0.45)]";
              const span = v.span ?? "md:col-span-6";
              const tilt = v.tilt ?? "";
              const volTag = (
                <span className="ui absolute right-4 top-4 text-[10px] tabular-nums text-ink/40">
                  Vol. {String(i + 1).padStart(2, "0")}
                </span>
              );
              const credit = (name: string, city: string) => (
                <figcaption className="mt-6 flex items-baseline justify-between border-t border-ink/15 pt-4">
                  <div>
                    <div className="font-display text-base font-extrabold leading-tight md:text-lg">
                      {name}
                    </div>
                    <div className="ui mt-1 text-[10px] uppercase tracking-[0.2em] text-ink/55">
                      Chapter · {city}
                    </div>
                  </div>
                </figcaption>
              );

              if (v.kind === "quote") {
                return (
                  <figure key={i} className={`${baseCard} ${span} ${tilt} p-6 md:p-8`}>
                    <Sparkles className="absolute left-5 top-5 h-5 w-5 text-tomato" />
                    {volTag}
                    <blockquote className="mt-6 font-display text-2xl font-extrabold leading-[1.05] tracking-[-0.005em] md:text-3xl">
                      “{v.quote}”
                    </blockquote>
                    {credit(v.name, v.city)}
                  </figure>
                );
              }

              if (v.kind === "note") {
                return (
                  <figure
                    key={i}
                    className={`${baseCard} ${span} ${tilt} bg-butter/70 p-6 md:p-7`}
                  >
                    <span className="ui absolute left-5 top-5 text-[10px] uppercase tracking-[0.22em] text-ink/55">
                      Field note
                    </span>
                    {volTag}
                    <p className="mk-handwritten mt-10 text-[1.6rem] leading-[1.15] text-ink md:text-[1.9rem]">
                      “{v.note}”
                    </p>
                    {credit(v.name, v.city)}
                  </figure>
                );
              }

              if (v.kind === "screenshot") {
                return (
                  <figure
                    key={i}
                    className={`${baseCard} ${span} ${tilt} overflow-hidden p-0`}
                  >
                    <div className="flex items-center justify-between border-b border-ink/15 bg-cream-warm px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-tomato/70" />
                        <span className="ui text-[11px] font-semibold text-ink">
                          {v.channel}
                        </span>
                      </div>
                      <span className="ui text-[10px] tabular-nums text-ink/45">
                        {v.handle}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2 p-5">
                      {v.lines.map((l, li) => (
                        <div
                          key={li}
                          className={`flex ${l.who === "me" ? "justify-end" : "justify-start"}`}
                        >
                          <span
                            className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[14px] leading-snug ${
                              l.who === "me"
                                ? "bg-ink text-cream rounded-br-sm"
                                : "bg-ink/8 text-ink rounded-bl-sm"
                            }`}
                          >
                            {l.text}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-auto flex items-center justify-between border-t border-ink/15 px-5 py-3">
                      <span className="ui text-[10px] uppercase tracking-[0.22em] text-ink/55">
                        Screenshot · Discord
                      </span>
                      <span className="ui text-[10px] tabular-nums text-ink/40">
                        Vol. {String(i + 1).padStart(2, "0")}
                      </span>
                    </div>
                  </figure>
                );
              }

              // stat
              return (
                <figure key={i} className={`${baseCard} ${span} ${tilt} p-6 md:p-8`}>
                  <span className="ui absolute left-5 top-5 text-[10px] uppercase tracking-[0.22em] text-ink/55">
                    Receipt
                  </span>
                  {volTag}
                  <div className="mt-10">
                    <div className="font-display text-[3.4rem] font-extrabold leading-[0.95] tracking-[-0.02em] text-tomato md:text-[4rem]">
                      {v.stat}
                    </div>
                    <p className="mt-3 font-display text-base font-extrabold leading-snug text-ink md:text-lg">
                      {v.label}
                    </p>
                  </div>
                  {credit(v.name, v.city)}
                </figure>
              );
            })}
          </div>

        </div>
      </section>

      {/* LIVE PULSE, slim auto-scrolling activity feed */}
      <div className="border-y border-ink/10 bg-cream-warm">
        <div className="flex items-center gap-4 overflow-hidden py-3">
          <span className="ui ml-5 hidden shrink-0 items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato md:inline-flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-tomato opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-tomato" />
            </span>
            Live · right now
          </span>
          <div className="relative flex-1 overflow-hidden">
            <div className="mk-marquee-track flex w-max gap-10 whitespace-nowrap">
              {(() => {
                const PULSE = [
                  "Someone in Lisbon just hosted a pizza night",
                  "3 new members joined in Tokyo",
                  "Hackathon project shipped in NYC",
                  "Long table forming in Berlin · Friday",
                  "Open RSVP crossed 40k tonight",
                  "New chapter opened in Nairobi",
                  "Slice club, vol. 47 confirmed in Lisbon",
                  "On-chain receipt minted in CDMX",
                  "Poster Pool submission from Buenos Aires",
                  "Chapter sync starting in 12 minutes",
                ];
                const loop = [...PULSE, ...PULSE];
                return loop.map((t, i) => (
                  <span key={i} className="ui flex items-center gap-10 text-[12px] text-ink/75">
                    {t}
                    <span className="text-tomato/50" aria-hidden>●</span>
                  </span>
                ));
              })()}
            </div>
            {/* edge fades */}
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-12 bg-gradient-to-r from-cream-warm to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-cream-warm to-transparent" />
          </div>
        </div>
      </div>

      {/* RHYTHM BREAK - cinematic interruption, softened, intentionally overlapping next slab */}
      <div className="relative z-20 -mb-10 overflow-visible bg-cream py-20 md:-mb-16 md:py-28">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            background:
              "radial-gradient(60% 70% at 50% 50%, hsl(var(--butter)/0.45), transparent 72%)",
          }}
        />
        <div className="relative mx-auto max-w-[88%] md:max-w-[78%]">
          <p className="ui mb-4 text-center text-[10px] font-semibold uppercase tracking-[0.32em] text-tomato/80">
            § Interlude
          </p>
          <p className="mk-handwritten px-2 text-center text-tomato/85 leading-[0.78] -rotate-[2deg] text-[clamp(3.5rem,18.5vw,16rem)] [text-shadow:0_1px_0_hsl(var(--cream)),0_0_40px_hsl(var(--butter)/0.45)]">
            but enough talk -
          </p>
          <p className="font-display mt-8 text-center text-[clamp(1.1rem,2.2vw,1.6rem)] font-extrabold leading-tight text-ink/80">
            here's what members actually built.
          </p>
        </div>
      </div>


      {/* THE WORKSHOP, builder-focused outputs */}
      <section className="relative bg-ink pb-16 pt-24 text-cream md:pb-24 md:pt-40">

        <div className="container">
          <div className="border-t-2 border-cream/25 pt-8 md:pt-10">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
              <div className="col-span-12 md:col-span-8">
                <p className="mk-overline inline-flex items-center gap-2 text-butter">
                  <span className="h-1.5 w-1.5 rounded-full bg-butter" />
                  § C.05, Infrastructure for pizza culture
                </p>
                <h2 className="font-display mt-5 text-[clamp(2.5rem,6vw,5rem)] font-extrabold leading-[0.9]">
                  Real projects.
                  <br />
                  <span className="mk-handwritten marker-bleed-butter relative inline-block text-butter text-[1.05em] leading-[0.75] -ml-1 translate-y-[0.08em] -rotate-[3deg] align-baseline">made by members.</span>
                </h2>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-8">
                <p className="text-base leading-relaxed text-cream/80 md:text-lg">
                  PizzaDAO is quietly becoming infrastructure for pizza
                  culture - event tooling, payroll experiments, cryptography
                  research, and the arcade hardware that travels between
                  chapters.
                </p>
              </div>
            </div>
          </div>

          {(() => {
            const featured = BUILDS.find((b) => b.featured)!;
            const featuredIndex = BUILDS.indexOf(featured);
            const supporting = BUILDS.filter((b) => !b.featured);
            const tagTone: Record<Build["tag"], string> = {
              "Live-tested": "bg-tomato text-cream",
              Hackathon: "bg-butter text-ink",
              Experiment: "bg-cream text-ink",
              Arcade: "bg-cream text-ink",
            };

            return (
              <>
                {/* FEATURED PROJECT - infrastructure spotlight */}
                <article className="group relative mt-10 md:mt-14">
                  {/* ambient warmth behind the card */}
                  <div
                    aria-hidden
                    className="pointer-events-none absolute -inset-x-6 -inset-y-8 -z-0 opacity-60 blur-3xl md:-inset-x-20 md:-inset-y-16"
                    style={{
                      background:
                        "radial-gradient(50% 60% at 30% 50%, hsl(var(--tomato)/0.55), transparent 70%), radial-gradient(40% 50% at 80% 60%, hsl(var(--butter)/0.45), transparent 75%)",
                    }}
                  />
                  <div className="relative overflow-hidden rounded-3xl bg-cream text-ink shadow-[0_40px_80px_-30px_hsl(var(--tomato)/0.55)] ring-1 ring-ink/[0.06]">
                    <div className="grid grid-cols-1 md:grid-cols-12">
                      <div className="relative md:col-span-7">
                        <div className="relative aspect-[16/10] overflow-hidden bg-ink md:aspect-auto md:h-full md:min-h-[480px]">
                          {featured.img && (
                            <img
                              src={featured.img}
                              alt={featured.name}
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                            />
                          )}
                          <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-ink/10 to-ink/0" />

                          {/* top-left tag stack - infrastructure credibility */}
                          <div className="absolute left-5 top-5 flex max-w-[calc(100%-2.5rem)] flex-wrap items-center gap-2">
                            <span className={`ui rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${tagTone[featured.tag]}`}>
                              {featured.tag}
                            </span>
                            <span className="ui inline-flex items-center gap-1.5 rounded-full bg-ink/80 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cream backdrop-blur-sm">
                              <span className="relative flex h-1.5 w-1.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-butter opacity-70" />
                                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-butter" />
                              </span>
                              Live deployment
                            </span>
                            <span className="ui rounded-full bg-butter/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink backdrop-blur-sm">
                              Hackathon winner
                            </span>
                            <span className="ui rounded-full border border-cream/40 bg-ink/40 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-cream backdrop-blur-sm">
                              Open infra
                            </span>
                          </div>

                          {/* corner hand-note */}
                          <span className="mk-handwritten marker-bleed absolute bottom-5 right-5 max-w-[60%] text-right text-[15px] leading-tight text-cream/95 -rotate-[3deg] md:text-base">
                            tested live, Global Pizza Party 2026 →
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between p-7 md:col-span-5 md:p-10">
                        <div>
                          <p className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato">
                            Infrastructure · {String(featuredIndex + 1).padStart(2, "0")} / 0{BUILDS.length}
                          </p>
                          <h3 className="font-display mt-3 text-[clamp(2.25rem,4vw,3.25rem)] font-extrabold leading-[0.95] tracking-[-0.015em]">
                            {featured.name}
                          </h3>
                          <p className="font-display mt-4 text-lg font-medium leading-snug text-ink/85 md:text-xl">
                            {featured.hook}
                          </p>
                          <p className="mt-4 text-[15px] leading-relaxed text-ink/70">
                            {featured.context}
                          </p>

                          {featured.metric && (
                            <dl className="mt-7 grid grid-cols-3 gap-4 border-t-2 border-ink pt-5">
                              {featured.metric.map((m) => (
                                <div key={m.k}>
                                  <dt className="font-display text-2xl font-extrabold leading-none tracking-[-0.02em] text-tomato md:text-[28px]">
                                    {m.k}
                                  </dt>
                                  <dd className="ui mt-2 text-[10px] uppercase leading-snug tracking-[0.18em] text-ink/55">
                                    {m.v}
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          )}
                        </div>

                        <div className="mt-7 flex flex-wrap items-center gap-3">
                          {featured.demo && (
                            <a
                              href={featured.demo}
                              target="_blank"
                              rel="noreferrer"
                              className="ui group/cta inline-flex items-center gap-2 rounded-full bg-tomato px-6 py-3.5 text-[12px] font-semibold uppercase tracking-[0.22em] text-cream shadow-[0_12px_30px_-12px_hsl(var(--tomato)/0.7)] transition-all hover:bg-ink hover:shadow-[0_18px_40px_-12px_hsl(var(--ink)/0.5)]"
                            >
                              View live demo
                              <ArrowUpRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => openBuild(featuredIndex)}
                            className="ui inline-flex items-center gap-2 rounded-full border border-ink/25 px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/80 transition-colors hover:border-ink hover:text-ink"
                          >
                            How it works
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                {/* SUPPORTING PROJECTS - quieter, footnote-style row */}
                <div className="mt-10 md:mt-14">
                  <div className="mb-5 flex items-end justify-between border-b border-cream/20 pb-3">
                    <p className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-cream/55">
                      Also in the workshop
                    </p>
                    <p className="ui text-[10px] uppercase tracking-[0.22em] text-cream/40">
                      {supporting.length} active builds
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:gap-6">
                    {supporting.map((b) => {
                      const i = BUILDS.indexOf(b);
                      return (
                        <article
                          key={b.name}
                          className="mk-paper-soft group relative flex flex-col overflow-hidden rounded-2xl bg-cream text-ink transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_28px_60px_-22px_hsl(var(--tomato)/0.45)]"
                        >
                          {b.img ? (
                            <div className="relative aspect-[16/10] overflow-hidden bg-ink">
                              <img
                                src={b.img}
                                alt={b.name}
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                              />
                              <span className={`ui absolute left-4 top-4 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${tagTone[b.tag]}`}>
                                {b.tag}
                              </span>
                            </div>
                          ) : (
                            <div className="relative flex aspect-[16/10] items-end justify-between bg-ink p-6 text-cream">
                              <span className="font-display text-[clamp(1.6rem,3vw,2.25rem)] font-extrabold leading-[0.9] text-butter">
                                {b.name}
                              </span>
                              <span className={`ui absolute left-4 top-4 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.22em] ${tagTone[b.tag]}`}>
                                {b.tag}
                              </span>
                            </div>
                          )}

                          <div className="flex flex-1 flex-col p-6 md:p-7">
                            <div className="flex items-center justify-between">
                              <p className="ui text-[10px] font-semibold uppercase tracking-[0.2em] text-ink/50 tabular-nums">
                                Project {String(i + 1).padStart(2, "0")} / 0{BUILDS.length}
                              </p>
                              <p className="ui inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.22em] text-ink/55">
                                <span className="h-1.5 w-1.5 rounded-full bg-tomato/70" />
                                {b.tag === "Hackathon" ? "in pilot" : "shipping"}
                              </p>
                            </div>
                            <h3 className="font-display mt-3 text-xl font-extrabold leading-[1.05] md:text-[22px]">
                              {b.name}
                            </h3>
                            <p className="font-display mt-2 text-[15px] font-medium leading-snug text-ink/85">
                              {b.hook}
                            </p>
                            <p className="mt-3 flex-1 text-[14px] leading-relaxed text-ink/70">
                              {b.context}
                            </p>

                            <div className="mt-5 flex items-center justify-between gap-3 border-t border-ink/15 pt-4">
                              {b.embed ? (
                                <button
                                  type="button"
                                  onClick={() => openEmbed({ name: b.name, url: b.embed! })}
                                  className="ui inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cream transition-colors hover:bg-tomato"
                                >
                                  Open arcade
                                  <ArrowUpRight className="h-4 w-4" />
                                </button>
                              ) : b.demo ? (
                                <a
                                  href={b.demo}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="ui inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cream transition-colors hover:bg-tomato"
                                >
                                  View live demo
                                  <ArrowUpRight className="h-4 w-4" />
                                </a>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openBuild(i)}
                                  className="ui inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/75 transition-colors hover:text-tomato"
                                >
                                  How it works
                                  <ArrowUpRight className="h-4 w-4" />
                                </button>
                              )}
                              <span className="ui text-[10px] uppercase tracking-[0.22em] text-ink/40">
                                Open infra
                              </span>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </>
            );
          })()}

        </div>
      </section>


      {/* Embedded site modal (e.g. Arcade) */}
      <Dialog open={embedSite !== null} onOpenChange={(o) => !o && setEmbedSite(null)}>
        <DialogContent className="max-w-6xl bg-ink p-0 sm:rounded-lg overflow-hidden">
          {embedSite && (
            <div className="flex h-[85vh] flex-col">
              <DialogHeader className="border-b border-cream/10 px-5 py-3">
                <DialogTitle className="ui text-[11px] font-semibold uppercase tracking-[0.22em] text-cream">
                  {embedSite.name}
                </DialogTitle>
              </DialogHeader>
              <iframe
                src={embedSite.url}
                title={embedSite.name}
                className="h-full w-full flex-1 bg-ink"
                allow="autoplay; fullscreen; gamepad"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Project deep-dive modal */}
      <Dialog open={activeBuild !== null} onOpenChange={(o) => !o && setActiveBuild(null)}>
        <DialogContent className="max-w-2xl bg-cream p-0">
          {activeBuild !== null && (
            <>
              {BUILDS[activeBuild].img && (
                <div className="aspect-[16/9] overflow-hidden bg-ink">
                  <img
                    src={BUILDS[activeBuild].img as string}
                    alt={BUILDS[activeBuild].name}
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
              <div className="p-6 md:p-8">
                <p className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-tomato">
                  {BUILDS[activeBuild].tag}
                </p>
                <DialogHeader>
                  <DialogTitle className="font-display mt-2 text-3xl font-extrabold leading-[1.05] md:text-4xl">
                    {BUILDS[activeBuild].name}
                  </DialogTitle>
                </DialogHeader>
                <p className="font-display mt-4 text-lg font-medium leading-snug text-ink/85">
                  {BUILDS[activeBuild].mission}
                </p>
                <p className="mt-4 text-[15px] leading-relaxed text-ink/75">
                  {BUILDS[activeBuild].context}
                </p>
                <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
                  {BUILDS[activeBuild].detail}
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* COMMUNITY GALLERY, masonry strip + MVP modal */}
      {(() => {
        const GALLERY = [
          { img: hands,     cap: "Lagos · open kitchen",       meta: "Apr · @marina_l",   ratio: "4/5", rot: -1.2 },
          { img: party,     cap: "Berlin · long table",        meta: "Mar · @capo",       ratio: "3/4", rot: 0.8 },
          { img: hackathon, cap: "Tokyo · demo night",         meta: "Feb · @hiro.eth",   ratio: "1/1", rot: -0.6 },
          { img: slice,     cap: "NFT LA · booth activation", meta: "Apr · chapter",    ratio: "5/4", rot: 1.4 },
          { img: pizzeria,  cap: "Naples · the oven, 03:00",   meta: "Jan · @margherita", ratio: "3/4", rot: -1.8 },
          { img: community, cap: "CDMX · block party",         meta: "Mar · @donmami",    ratio: "4/5", rot: 0.6 },
          { img: party,     cap: "Quito · global pizza party", meta: "Sep · chapter",     ratio: "1/1", rot: -1.0 },
          { img: hackathon, cap: "Amsterdam · the crew",       meta: "Feb · @nlcrew",     ratio: "4/5", rot: 1.1 },
        ];
        const openAt = (idx: number, source: string) => {
          track(EVT.COMMUNITY_GALLERY_OPENED, { index: idx, source });
          setGalleryIndex(idx);
          setGalleryOpen(true);
        };

        return (
          <section className="bg-cream py-12 md:py-16">
            <div className="container">
              <div className="flex items-end justify-between gap-6">
                <div>
                  <p className="mk-overline text-tomato">§ C.06, From the camera roll</p>
                  <h2 className="font-display mt-3 text-[clamp(1.75rem,3.5vw,2.75rem)] font-extrabold leading-[0.95]">
                    The community,
                    <br />
                    <span className="mk-handwritten relative inline-block text-tomato text-[1.15em] leading-[0.75] -ml-0.5 translate-y-[0.08em] -rotate-[3deg] align-baseline">unedited.</span>
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => openAt(0, "header")}
                  className="ui hidden shrink-0 items-center gap-2 border-b border-ink pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/80 transition-colors hover:border-tomato hover:text-tomato md:inline-flex"
                >
                  Open community gallery
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Masonry strip - varied crops, slight stagger */}
            <div className="container mt-8 md:mt-10">
              <div className="columns-2 gap-3 md:columns-4 md:gap-4">
                {GALLERY.map((p, i) => (
                  <figure
                    key={i}
                    className="group mb-3 break-inside-avoid md:mb-4"
                    style={{ transform: `rotate(${p.rot}deg)` }}
                  >
                    <button
                      type="button"
                      onClick={() => openAt(i, "tile")}
                      className="block w-full text-left"
                      aria-label={`Open ${p.cap}`}
                    >
                      <div
                        className="relative overflow-hidden rounded-xl bg-ink shadow-[0_14px_36px_-22px_hsl(var(--ink)/0.4)] transition-all duration-500 group-hover:z-10 group-hover:scale-[1.06] group-hover:rotate-0 group-hover:shadow-[0_24px_55px_-20px_hsl(var(--tomato)/0.4)]"
                        style={{ aspectRatio: p.ratio }}
                      >
                        <img
                          src={p.img}
                          alt={p.cap}
                          loading="lazy"
                          className="h-full w-full object-cover"
                          style={{ objectPosition: i % 2 === 0 ? "30% 40%" : "65% 55%" }}
                        />
                      </div>
                      <figcaption className="mt-2 flex items-baseline justify-between gap-3">
                        <span className="ui text-[10px] uppercase tracking-[0.2em] text-ink/55">
                          {p.cap}
                        </span>
                        <span className="ui hidden text-[10px] uppercase tracking-[0.2em] text-ink/35 md:inline">
                          {p.meta}
                        </span>
                      </figcaption>
                    </button>
                  </figure>
                ))}
              </div>

              <div className="mt-6 flex justify-center md:hidden">
                <button
                  type="button"
                  onClick={() => openAt(0, "mobile_cta")}
                  className="ui inline-flex items-center gap-2 border-b border-ink pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/80"
                >
                  Open community gallery
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* MVP gallery modal - large versions + thumbnails */}
            <Dialog open={galleryOpen} onOpenChange={setGalleryOpen}>
              <DialogContent className="max-w-5xl bg-ink p-0 text-cream">
                <DialogHeader className="border-b border-cream/15 px-6 py-4">
                  <DialogTitle className="font-display text-xl font-extrabold text-cream md:text-2xl">
                    Community gallery · preview
                  </DialogTitle>
                  <p className="ui mt-1 text-[10px] uppercase tracking-[0.22em] text-cream/55">
                    MVP · full archive coming soon
                  </p>
                </DialogHeader>
                <div className="relative bg-ink">
                  <div className="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-ink">
                    <img
                      src={GALLERY[galleryIndex].img}
                      alt={GALLERY[galleryIndex].cap}
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="flex items-baseline justify-between gap-4 px-6 py-4">
                    <div>
                      <div className="font-display text-lg font-extrabold leading-tight text-cream md:text-xl">
                        {GALLERY[galleryIndex].cap}
                      </div>
                      <div className="ui mt-1 text-[10px] uppercase tracking-[0.2em] text-cream/55">
                        {GALLERY[galleryIndex].meta}
                      </div>
                    </div>
                    <div className="ui tabular-nums text-[10px] uppercase tracking-[0.22em] text-cream/50">
                      {String(galleryIndex + 1).padStart(2, "0")} / {String(GALLERY.length).padStart(2, "0")}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 overflow-x-auto border-t border-cream/15 px-4 py-4">
                  {GALLERY.map((p, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => navigateGallery(i)}
                      className={`relative h-16 w-20 shrink-0 overflow-hidden rounded-md transition-all ${
                        i === galleryIndex
                          ? "ring-2 ring-tomato"
                          : "opacity-60 hover:opacity-100"
                      }`}
                      aria-label={`Show ${p.cap}`}
                    >
                      <img src={p.img} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
          </section>
        );
      })()}

      {/* Asymmetric rhythm break - quiet handwritten margin annotation, off-center */}
      <div className="relative overflow-hidden bg-cream py-6 md:py-10">
        <div className="container">
          <p
            className="mk-handwritten text-tomato/70 text-[clamp(1.4rem,3.4vw,2.4rem)] leading-[0.95] -rotate-[2deg] md:ml-[58%] md:max-w-[40%]"
          >
            ↘ ok, your turn.
          </p>
        </div>
      </div>


      {/* INITIATION - name ritual + 3-path action bridge, one section */}
      <section className="bg-butter py-16 text-ink md:py-24">
        <div className="container">
          <div className="border-t-2 border-ink pt-8 md:pt-10">
            <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
              <div className="col-span-12 md:col-span-8">
                <p className="mk-overline text-tomato">§ C.08, Initiation</p>
                <h2 className="font-display mt-5 text-[clamp(2.75rem,7vw,5.75rem)] font-extrabold leading-[0.88] tracking-[-0.01em]">
                  Every member
                  <br />
                  earns a <span className="mk-handwritten marker-bleed relative inline-block text-tomato text-[1.05em] leading-[0.75] -mr-1 translate-y-[0.08em] -rotate-[3deg] align-baseline">name.</span>
                </h2>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-8">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                  An alias the Mafia will know you by. Claim it, walk in, start.
                </p>
              </div>
            </div>
          </div>

          {/* Name ritual + 3 action paths, visually linked */}
          <div className="mk-paper-soft mt-10 overflow-hidden rounded-3xl bg-cream shadow-[0_30px_80px_-40px_hsl(var(--ink)/0.5)] md:mt-14">
            <div className="grid grid-cols-1 md:grid-cols-12">
              {/* The name ritual - receipt / stamp energy, not form energy */}
              <div className="mk-paper-soft mk-paper-soft-dark relative flex flex-col justify-between bg-ink p-7 text-cream md:col-span-5 md:p-10">
                <div>
                  <p className="mk-overline inline-flex items-center gap-2 text-butter">
                    <span className="h-1.5 w-1.5 rounded-full bg-butter" />
                    The ritual
                  </p>
                  <p className="font-display mt-5 text-[clamp(2rem,3.4vw,2.75rem)] font-extrabold leading-[0.95]">
                    Earn your <span className="mk-handwritten marker-bleed-butter relative inline-block text-butter text-[1.1em] leading-[0.75] translate-y-[0.08em] -rotate-[4deg] align-baseline">slice.</span>
                  </p>
                  <p className="mt-4 text-[15px] leading-relaxed text-cream/75 md:text-base">
                    Don Pepperoni. Sister Marinara. Capo Crust. Generate the
                    alias the Mafia will know you by.
                  </p>

                  {/* Sample names - collectible/stamped feel */}
                  <ul className="mt-7 flex flex-wrap gap-2">
                    {["Don Pepperoni", "Sister Marinara", "Capo Crust", "Vinnie Calzone"].map((n, i) => (
                      <li
                        key={n}
                        className="mk-handwritten inline-flex items-center rounded-full border border-butter/35 bg-butter/10 px-3 py-1.5 text-[14px] text-butter/95 md:text-[15px]"
                        style={{ transform: `rotate(${[-1.4, 0.8, -0.6, 1.2][i]}deg)` }}
                      >
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
                <a
                  href="/get-your-mafia-name"
                  className="ui mt-8 group/cta inline-flex items-center justify-between gap-3 rounded-full bg-butter px-6 py-4 text-[12px] font-semibold uppercase tracking-[0.22em] text-ink transition-all hover:bg-cream hover:shadow-[0_18px_40px_-12px_hsl(var(--butter)/0.6)]"
                >
                  Claim your name
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover/cta:translate-x-0.5 group-hover/cta:-translate-y-0.5" />
                </a>
              </div>

              {/* 3 action paths - softer dividers, ritual flow, not table chrome */}
              <div className="md:col-span-7">
                <div className="flex h-full flex-col">
                  <div className="flex items-baseline justify-between px-6 pb-3 pt-6 md:px-10 md:pt-8">
                    <p className="mk-overline text-tomato">Three ways in</p>
                    <span className="ui text-[10px] uppercase tracking-[0.22em] text-ink/40">
                      Pick one · do it today
                    </span>
                  </div>

                  {[
                    {
                      n: "01",
                      title: "Join Discord",
                      note: "The room is already loud. Someone will say hi.",
                      cta: "Open the door",
                      href: "/get-your-mafia-name",
                      primary: true,
                    },
                    {
                      n: "02",
                      title: "Attend an event",
                      note: "Find one near you through your local chapter.",
                      cta: "Find a chapter",
                      href: `${HOME_PATH}#reach`,
                      primary: false,
                    },
                    {
                      n: "03",
                      title: "Start a project",
                      note: "Pitch the experiment. Ship the weird thing.",
                      cta: "Pick a lane",
                      href: "/get-your-mafia-name",
                      primary: false,
                    },
                  ].map((s, idx, arr) => (
                    <a
                      key={s.n}
                      href={s.href}
                      className={`group flex flex-1 items-center justify-between gap-5 rounded-lg px-6 py-5 transition-colors md:px-10 md:py-6 ${
                        idx < arr.length - 1 ? "border-b border-dashed border-ink/15" : ""
                      } ${s.primary ? "bg-butter/35 hover:bg-butter/60" : "hover:bg-butter/20"}`}
                    >
                      <div className="flex items-start gap-5">
                        <span className="ui mt-1 text-[10px] font-semibold uppercase tracking-[0.22em] text-ink/40 tabular-nums">
                          {s.n}
                        </span>
                        <div>
                          <p className="font-display text-xl font-extrabold leading-tight md:text-2xl">
                            {s.title}
                            {s.primary && (
                              <span className="ui ml-3 inline-flex translate-y-[-2px] items-center rounded-full bg-tomato px-2 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-[0.22em] text-cream">
                                Start here
                              </span>
                            )}
                          </p>
                          <p className="mt-1 text-[14px] leading-snug text-ink/70 md:text-[15px]">
                            {s.note}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="ui hidden text-[11px] font-semibold uppercase tracking-[0.22em] text-ink/65 group-hover:text-tomato md:inline">
                          {s.cta}
                        </span>
                        <ArrowUpRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA - the punchline */}
      <section className="bg-tomato py-16 text-cream md:py-24">
        <div className="container">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
            <div className="col-span-12 md:col-span-8">
              <p className="mk-overline text-butter">Last word</p>
              <h2 className="font-display mt-4 text-[clamp(3rem,8vw,6.5rem)] font-extrabold leading-[0.88]">
                Don't apply.
                <br />
                <span className="italic font-normal">Just start.</span>
              </h2>
              <RotatingPrompt />
            </div>
            <div className="col-span-12 flex flex-col gap-3 md:col-span-4 md:items-end">
              <a
                href="/get-your-mafia-name"
                className="mk-btn-pill-lg bg-ink text-cream hover:bg-cream hover:text-ink"
              >
                Join Discord →
              </a>
              <a
                href={`${HOME_PATH}#journal`}
                className="ui inline-flex items-center gap-2 border-b border-cream/40 pb-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-cream/75 transition-colors hover:border-butter hover:text-butter"
              >
                Read field reports
              </a>
            </div>
          </div>
        </div>
      </section>


      <Footer />
    </main>
  );
};

const ROTATING_PROMPTS = [
  "Start a chapter.",
  "Host a night.",
  "Build something weird.",
];

const RotatingPrompt = () => {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((v) => (v + 1) % ROTATING_PROMPTS.length), 2800);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="font-display mt-6 h-8 text-2xl font-extrabold leading-none text-butter md:h-10 md:text-3xl"
      aria-live="polite"
    >
      <span
        key={i}
        className="inline-block animate-fade-in"
      >
        → {ROTATING_PROMPTS[i]}
      </span>
    </div>
  );
};

const Frame = ({
  img,
  caption,
  span,
}: {
  img: string;
  caption: string;
  span: string;
}) => (
  <figure className={`group relative overflow-hidden rounded-2xl border-2 border-ink bg-ink ${span}`}>
    <img
      src={img}
      alt={caption}
      loading="lazy"
      className="mk-grain absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
    />
    <figcaption className="ui absolute bottom-0 left-0 right-0 flex items-center justify-between bg-ink/85 px-4 py-2.5 text-[10px] uppercase tracking-[0.2em] text-cream">
      <span>{caption}</span>
      <span className="text-butter">●</span>
    </figcaption>
  </figure>
);

const HeroFrame = Frame;

type HeroTile = {
  img?: string;
  video?: string;
  poster?: string;
  caption: string;
};

const HERO_IMAGES: HeroTile[] = [
  {
    video: "/media/video/nyc-rp-teaser.mp4",
    poster: "/marketing/media/nyc-rp-teaser-poster.jpg",
    caption: "New York City · RP Reveal",
  },
  {
    video: "/media/video/wen-pizza-nyc.mp4",
    poster: "/marketing/media/wen-pizza-nyc-poster.jpg",
    caption: "New York City · Wen Pizza",
  },
  { img: "/marketing/media/community-yerevan-poster.jpg", caption: "Yerevan · long table" },
  { img: "/marketing/media/community-prayagraj-poster.jpg", caption: "Prayagraj · slice drop" },
  { img: "/marketing/media/community-amsterdam.jpg", caption: "Amsterdam · the whole crew" },
  { img: "/marketing/media/community-melbourne.jpg", caption: "Melbourne · panel night" },
  { img: "https://raw.githubusercontent.com/PizzaDAO/dow-pizza-party/main/public/photos/lagos/2025/01.jpg", caption: "Lagos · first party" },
  { img: "/marketing/media/community-quito.jpg", caption: "Quito · Global Pizza Party" },
  { img: "/marketing/media/community-pizza-robots.jpg", caption: "NYC · Pizza Robots" },
];

// Layout for collage tiles, percentages relative to collage box.
// Intentionally imperfect overlap. Two tiles allowed to break the row.
const TILE_LAYOUTS = [
  // ANCHOR - dominant editorial centerpiece, smaller so supporting cards breathe.
  { top: "5%",  left: "31%", w: "39%", aspect: "5/6",   rot: -1.5, z: 4, delay: 80  },
  // upper-left support - larger, readable
  { top: "3%",  left: "-1%", w: "26%", aspect: "4/5",   rot: -5,   z: 3, delay: 220 },
  // upper-right support
  { top: "1%",  left: "73%", w: "26%", aspect: "3/4",   rot: 5,    z: 3, delay: 360 },
  // lower-left medium
  { top: "60%", left: "1%",  w: "26%", aspect: "5/4",   rot: -3,   z: 5, delay: 500 },
  // lower-right medium - pulled up + slightly narrower so it never clips the container floor
  { top: "52%", left: "76%", w: "22%", aspect: "4/5",   rot: 4,    z: 6, delay: 640 },
  // tiny accent - pulled up + smaller so it sits safely above the floor
  { top: "78%", left: "42%", w: "12%", aspect: "1/1",   rot: -6,   z: 7, delay: 820 },
];


const HeroSection = () => {
  // Slight randomization per refresh. The server and first client render keep the listed order
  // (hydration must match); the shuffle happens right after mount.
  const [imgs, setImgs] = useState(HERO_IMAGES);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setImgs([...HERO_IMAGES].sort(() => Math.random() - 0.5));
  }, []);
  const tiles = useMemo(
    () => TILE_LAYOUTS.map((layout, i) => ({ ...layout, ...imgs[i % imgs.length] })),
    [imgs],
  );

  return (
    <section className="relative overflow-hidden bg-cream pt-24 md:pt-32">
      {/* Warm radial gradient - slightly stronger for warmth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(65% 60% at 65% 30%, hsl(var(--butter) / 0.7), transparent 72%), radial-gradient(50% 45% at 20% 75%, hsl(var(--tomato) / 0.22), transparent 78%)",
        }}
      />
      {/* Film grain overlay */}
      <div aria-hidden className="mk-grain pointer-events-none absolute inset-0" />

      <div className="container relative">
        <div className="border-t-2 border-ink pt-8 md:pt-10">
          <div className="flex items-center justify-between gap-6">
            <p className="mk-overline text-tomato">§ C, Community</p>
            <p className="ui hidden text-[10px] uppercase tracking-[0.22em] text-ink/55 md:block">
              Volume 04 · The Pizza Mafia
            </p>
          </div>

          <div className="mt-8 grid grid-cols-12 items-end gap-x-6 gap-y-10 md:mt-12">
            <div className="col-span-12 md:col-span-8">
              <p className="mk-handwritten mb-4 text-[15px] text-tomato md:text-base">
                ↘ this part is important
              </p>
              <h1 className="font-display relative text-[clamp(3rem,9.5vw,8.25rem)] font-extrabold leading-[0.84] tracking-[-0.015em]">
                The Pizza Mafia
                <br />
                <span className="relative inline-block align-baseline">
                  is built.
                </span>
                {/* "by you" drops down to overlap/interact with the "is built." line, scaled ~6% smaller, marker-bleed edge */}
                <span
                  aria-hidden
                  className="mk-handwritten marker-bleed pointer-events-none absolute z-10 text-tomato text-[0.86em] sm:text-[0.94em] md:text-[1.02em] leading-[0.7] -rotate-[5deg]"
                  style={{ left: "clamp(7.5rem, 22vw, 19rem)", top: "clamp(2.4rem, 6.8vw, 5.8rem)" }}
                >
                  by you.
                </span>
                <span className="sr-only">by you</span>
              </h1>
              <p className="font-display mt-6 max-w-2xl text-xl font-medium leading-snug text-ink/75 md:text-2xl">
                Some people show up for pizza. Some stay and build something bigger.
              </p>
            </div>
            <div className="col-span-12 md:col-span-4 md:pl-8">
              {/* Soft warm panel - integrated, not utility */}
              <div
                className="mk-paper-soft relative rounded-3xl px-6 py-7 md:px-7 md:py-8"
                style={{
                  background:
                    "linear-gradient(155deg, hsl(var(--cream) / 0.55), hsl(var(--butter) / 0.18) 60%, hsl(var(--tomato) / 0.06))",
                  boxShadow: "0 1px 0 hsl(var(--cream) / 0.6) inset, 0 30px 60px -30px hsl(var(--tomato) / 0.25)",
                }}
              >
                <p className="text-lg leading-relaxed text-ink/85 md:text-xl">
                  People don't just join PizzaDAO. They host. Build. Create.
                  Feed. Organize. <span className="mk-handwritten marker-bleed inline-block text-tomato text-[1.25em] leading-none -rotate-[3deg] translate-y-[0.05em]">show up.</span>
                </p>
                <div className="mt-7 flex flex-col gap-3 sm:flex-row md:flex-col">
                  <a href="/get-your-mafia-name" className="mk-btn-pill-lg bg-tomato text-cream hover:bg-ink">
                    Join the Pizza Mafia →
                  </a>
                  <a href="#ways-in" className="mk-btn-pill-lg border-2 border-ink/15 text-ink hover:border-ink hover:bg-cream/60">
                    See how people show up
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Organic collage - container scales by aspect ratio so tile heights (which key off width)
              can never exceed the floor. Overflow stays hidden as a safety net. */}
          <div className="relative mt-14 aspect-[4/3] w-full overflow-hidden md:mt-20 md:aspect-[5/3] [contain:layout_paint] [&_figure]:will-change-transform">

            {tiles.map((t, i) => (
              <figure
                key={i}
                className="group absolute opacity-0 transition-[transform,box-shadow] duration-500 ease-out hover:z-50"
                style={{
                  top: t.top,
                  left: t.left,
                  width: t.w,
                  zIndex: t.z,
                  transform: `rotate(${t.rot}deg)`,
                  animation: `fadeUp 1s cubic-bezier(0.2,0.7,0.2,1) ${t.delay}ms forwards`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = `rotate(${t.rot * 0.15}deg) translateY(-6px) scale(1.035)`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = `rotate(${t.rot}deg)`;
                }}
              >
                <div
                  className="relative overflow-hidden rounded-2xl shadow-[0_2px_4px_-2px_hsl(var(--ink)/0.25),0_18px_40px_-18px_hsl(var(--ink)/0.35),0_40px_80px_-30px_hsl(var(--ink)/0.25)] ring-1 ring-ink/5 transition-shadow duration-500 group-hover:shadow-[0_4px_8px_-2px_hsl(var(--ink)/0.3),0_30px_70px_-20px_hsl(var(--tomato)/0.4),0_60px_120px_-40px_hsl(var(--butter)/0.35)]"
                  style={{ aspectRatio: t.aspect }}
                >
                  {t.video ? (
                    <video
                      src={t.video}
                      poster={t.poster}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="none"
                      aria-label={t.caption}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img
                      src={t.img}
                      alt={t.caption}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  )}
                  <figcaption className="ui absolute bottom-0 left-0 right-0 flex items-center justify-between bg-ink/75 px-3 py-2 text-[10px] uppercase tracking-[0.2em] text-cream backdrop-blur-sm">
                    <span>{t.caption}</span>
                    <span className="text-butter">●</span>
                  </figcaption>
                </div>
              </figure>
            ))}
          </div>

          {/* Live ticker / proof of participation */}
          <dl className="relative mt-10 grid grid-cols-2 gap-y-6 border-y-2 border-ink py-6 md:mt-14 md:grid-cols-4">
            {[
              { k: "Active members", v: "3,000+" },
              { k: "Chapters", v: "60+" },
              { k: "Open experiments", v: "Always" },
              { k: "Weekly calls", v: "Open to all" },
            ].map((m) => (
              <div key={m.k} className="px-1">
                <dt className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/55">
                  {m.k}
                </dt>
                <dd className="font-display mt-2 text-3xl font-extrabold leading-none md:text-4xl">
                  {m.v}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
};

export default CommunityPage;
