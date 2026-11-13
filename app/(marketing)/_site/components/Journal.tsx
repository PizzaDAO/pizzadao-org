"use client";

import { useState } from "react";
const lead = "/marketing/assets/journal-lead.png";
const jAi = "/marketing/assets/journal-ai-community.png";
import { invokeForm } from "@/app/(marketing)/_site/lib/forms";
import { useToast } from "@/app/(marketing)/_site/hooks/use-toast";
import { identifyByEmail, track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";

const SECONDARY = [
  {
    kicker: "Rare Pizzas",
    title: "Yes, Cheese! What we slather on the sauce at Rare Pizzas.",
    author: "JoBlank",
    meta: "Medium · 9 min",
    img: "https://miro.medium.com/v2/resize:fit:1200/format:webp/1*cT59q32F-znhT94o_8Bu8A.jpeg",
    href: "https://medium.com/pizzadao/yes-cheese-f80648a01ff3",
  },
  {
    kicker: "Field Notes",
    title: "How PizzaDAO leverages AI: community to code.",
    author: "Enzo Pepperoni",
    meta: "Dispatch · 8 min",
    img: jAi,
    href: "/articles/how-pizzadao-leverages-ai-community-to-code",
  },
  {
    kicker: "Rare Pizzas",
    title: "Lost in the Sauce: what goes into the Rare Pizzas sauce.",
    author: "Don Snausages",
    meta: "Medium · 4 min",
    img: "https://miro.medium.com/v2/resize:fit:1200/format:webp/1*7Op7o3Zb_xBWUoQzq_Fkew.png",
    href: "https://medium.com/pizzadao/what-goes-into-the-rare-pizzas-sauce-22610e9228f0",
  },
  {
    kicker: "Philosophy",
    title: "Blockchain meets ontology: the Turing-incomplete loop of metaphysical certainty.",
    author: "T. Dylan Daniel",
    meta: "Medium · 10 min",
    img: "https://miro.medium.com/v2/resize:fit:1200/format:webp/0*tiakepu7JZiYXeXG.png",
    href: "https://medium.com/pizzadao/blockchain-meets-ontology-the-turing-incomplete-loop-of-metaphysical-certainty-b7ddbfdefe48",
  },
];

const PRESS = [
  "The New York Times", "Wired", "Bloomberg", "Vice", "The Verge",
  "Eater", "Bon Appétit", "TechCrunch", "Forbes",
];

const Journal = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const handleSubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 320) {
      track(EVT.NEWSLETTER_FAILED, { source: "journal", reason: "validation" });
      toast({ title: "Check your email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setStatus("loading");
    try {
      const { data, error } = await invokeForm("/api/public/newsletter", {
        body: { email: trimmed, source: "journal" },
      });
      if (error || !data?.ok) throw error ?? new Error("Subscribe failed");
      void identifyByEmail(trimmed, { newsletter_source: "journal" });
      track(EVT.NEWSLETTER_SUBMITTED, { source: "journal", already: Boolean(data.already) });
      if (data.already) {
        toast({ title: "You're already on the list", description: "Thanks for being here." });
      } else {
        toast({ title: "You're in", description: "We'll be in touch when the next issue lands." });
      }
      setStatus("success");
      setEmail("");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      console.error(err);
      track(EVT.NEWSLETTER_FAILED, {
        source: "journal",
        reason: err instanceof Error ? err.message : "unknown",
      });
      toast({ title: "Something went wrong", description: "Please try again in a moment.", variant: "destructive" });
      setStatus("idle");
    }
  };

  return (
    <section id="journal" className="bg-cream pt-20 md:pt-32">
      {/* Masthead */}
      <div className="container">
        <div className="border-t-2 border-ink pt-8 md:pt-10">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-6">
            <div className="col-span-12 md:col-span-7">
              <p className="mk-overline text-tomato">The Journal</p>
              <h2 className="font-display mt-4 text-display-1 font-extrabold leading-[0.88]">
                A living
                <br />
                <span className="text-ink/70">publication.</span>
              </h2>
            </div>
            <div className="col-span-12 md:col-span-5 md:pl-8">
              <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                Field reports, essays, and research from the edges of
                the pizza world.

              </p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <a href="#" className="mk-btn-pill bg-ink text-cream hover:bg-tomato">
                  Read latest issue
                </a>
                <a href="#" className="mk-btn-pill border border-ink text-ink hover:border-tomato hover:text-tomato">
                  Subscribe on Substack
                </a>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Lead story, editorial cover */}
      <div className="container mt-16 md:mt-24">
        <div className="border-t-2 border-ink pt-6">
          <div className="flex items-center justify-between">
            <p className="mk-overline text-tomato">Cover Story</p>
            <span className="ui text-[10px] uppercase tracking-[0.18em] text-ink/45">
              The lead
            </span>
          </div>
        </div>

        <article className="mt-8 md:mt-10">
          <a
            href="https://brandonwtf.substack.com/p/the-room-about-nothing"
            target="_blank"
            rel="noreferrer"
            className="group block"
          >
            <figure className="mk-grain relative overflow-hidden rounded-2xl" data-benny="true">
              <img
                src={lead}
                alt="Pizza party gathering, lit warmly, strangers becoming neighbors"
                loading="lazy"
                width={1920}
                height={1080}
                className="block aspect-[16/9] w-full object-cover transition-transform duration-700 group-hover:scale-[1.02] md:aspect-[21/9]"
              />
              <span className="ui absolute left-5 top-5 inline-flex items-center gap-2 rounded-full bg-butter px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink">
                ● Lead Story
              </span>
              <figcaption className="ui pointer-events-none absolute bottom-4 left-5 right-5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-cream/85 mix-blend-difference">
                <span>Origin Story</span>
                <span>Substack · Brandon Forant</span>
              </figcaption>
            </figure>

            <div className="mt-8 grid grid-cols-12 gap-x-6 gap-y-6 md:mt-10">
              <div className="col-span-12 md:col-span-8">
                <h3 className="font-display text-[clamp(2.25rem,5.5vw,4.75rem)] font-extrabold leading-[0.92] tracking-[-0.01em] group-hover:text-tomato">
                  The Room about Nothing: how strangers in a Clubhouse drop-in
                  decided to feed the world pizza.
                </h3>
              </div>
              <div className="col-span-12 md:col-span-4 md:pl-6 md:pt-2">
                <p className="text-base leading-relaxed text-ink/75 md:text-lg">
                  On community, purpose, and what happens when an improbable
                  idea, born deep in pandemic isolation, turns into a global
                  network feeding tens of thousands on Bitcoin Pizza Day.
                </p>
                <div className="ui mt-6 flex items-center justify-between border-t border-ink/15 pt-4 text-[10px] uppercase tracking-[0.2em] text-ink/55">
                  <span>By Brandon Forant</span>
                  <span>12 min read</span>
                </div>
              </div>
            </div>
          </a>
        </article>
      </div>

      {/* Two supporting stories */}
      <div className="container mt-20 md:mt-28">
        <div className="border-t-2 border-ink pt-6">
          <p className="mk-overline text-tomato">In this issue</p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2">
          {SECONDARY.map((s, i) => (
            <a key={s.title} href={s.href} target={s.href.startsWith("http") ? "_blank" : undefined} rel={s.href.startsWith("http") ? "noreferrer" : undefined} className="group flex flex-col">
              <figure className="mk-grain relative overflow-hidden rounded-2xl" data-benny="true">
                <img
                  src={s.img}
                  alt={s.title}
                  loading="lazy"
                  width={1280}
                  height={1080}
                  className="block aspect-[5/4] w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
                />
              </figure>
              <p className="mk-overline mt-5 text-tomato">{s.kicker}</p>
              <h4 className="font-display mt-3 text-2xl font-extrabold leading-[1.05] transition-colors group-hover:text-tomato md:text-[1.75rem]">
                {s.title}
              </h4>
              <div className="ui mt-4 flex items-center justify-between border-t border-ink/15 pt-3 text-[10px] uppercase tracking-[0.18em] text-ink/55">
                <span>{s.author}</span>
                <span>{s.meta}</span>
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* Substack subscribe band */}
      <div id="newsletter" className="mt-20 bg-cream pb-20 md:mt-28 md:pb-32 scroll-mt-24">
        <div className="container border-t border-ink/15 pt-16 md:pt-20">
          <div className="grid grid-cols-12 items-end gap-x-6 gap-y-8">
            <div className="col-span-12 md:col-span-7">
              <p className="mk-overline text-tomato">The newsletter</p>
              <h3 className="font-display mt-4 text-display-2 font-extrabold leading-[0.92]">
                One issue.
                <br />
                <span className="mk-handwritten text-ink/65 text-[1.05em]">When it's ready.</span>
              </h3>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-ink/70 md:text-lg">
                An occasional dispatch - the best new writing, dispatches from
                chapters, and one thing about pizza you didn't know yesterday.
                No fixed schedule. No tracking. Unsubscribe anytime.
              </p>
            </div>
            <form
              className="col-span-12 md:col-span-5"
              onSubmit={handleSubscribe}
            >
              <div className="flex flex-col gap-3 sm:flex-row">
                <label className="sr-only" htmlFor="journal-email">Email</label>
                <input
                  id="journal-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={status === "loading"}
                  placeholder="your@email.com"
                  className="ui w-full rounded-full border border-ink bg-cream px-5 py-3.5 text-base text-ink placeholder:text-ink/40 focus:border-tomato focus:outline-none disabled:opacity-60 sm:text-sm"
                />
                <button
                  type="submit"
                  disabled={status === "loading"}
                  className="mk-btn-pill-lg bg-ink text-cream hover:bg-tomato disabled:opacity-60"
                >
                  {status === "loading" ? "Subscribing…" : status === "success" ? "Subscribed ✓" : "Subscribe →"}
                </button>
              </div>
              <p className="ui mt-3 text-[10px] uppercase tracking-[0.18em] text-ink/50">
                Join 12,000+ readers · Unsubscribe anytime
              </p>
            </form>

          </div>
        </div>
      </div>
    </section>
  );
};

export default Journal;
