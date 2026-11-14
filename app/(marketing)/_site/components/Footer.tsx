"use client";

import { useEffect, useState } from "react";
const logoLight = "/marketing/assets/logo-light.svg";
import { invokeForm, honeypot } from "@/app/(marketing)/_site/lib/forms";
import Honeypot from "@/app/(marketing)/_site/components/Honeypot";
import { useToast } from "@/app/(marketing)/_site/hooks/use-toast";
import { identifyByEmail, track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";

const cols = [
  { title: "More", items: ["About", "Global Pizza Party", { label: "Partners", href: "/partners" }, "Journal", "Join"] as Array<string | { label: string; href: string }> },
  { title: "Press", items: [{ label: "Brand System", href: "https://pizzadao.xyz/brand" }, { label: "Contact", href: "/contact" }, "Inquiries"] as Array<string | { label: string; href: string }> },
  { title: "Elsewhere", items: [{ label: "Instagram", href: "https://www.instagram.com/Pizza_DAO/" }, { label: "X / Twitter", href: "https://x.com/Pizza_DAO" }, { label: "YouTube", href: "https://www.youtube.com/@PizzaDAO" }] as Array<string | { label: string; href: string }> },
];

const PHRASES = [
  "Pizza the planet",
  "Slice by slice",
  "See you May 22",
  "The internet needed a table",
  "People kept showing up",
  "Every city does it differently",
  "Global Pizza Party",
  "Powered by mozzarella",
  "Internet coordination, real-world pizza",
  "Somewhere near you, pizza is already bringing people together",
];

const RotatingTagline = () => {
  const [index, setIndex] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % PHRASES.length);
        setShow(true);
      }, 600);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span
      className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-cream/40 transition-opacity duration-500"
      style={{ opacity: show ? 1 : 0 }}
    >
      {PHRASES[index]}
    </span>
  );
};

const NewsletterSignup = () => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 320) {
      track(EVT.NEWSLETTER_FAILED, { source: "footer", reason: "validation" });
      toast({ title: "Check your email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setStatus("loading");
    try {
      const { data, error } = await invokeForm("/api/public/newsletter", {
        body: { email: trimmed, source: "footer", website: honeypot(e) },
      });
      if (error || !data?.ok) throw error ?? new Error("Subscribe failed");
      void identifyByEmail(trimmed, { newsletter_source: "footer" });
      track(EVT.NEWSLETTER_SUBMITTED, { source: "footer" });
      toast({ title: "Check your inbox", description: "We sent a link to confirm your address. You're subscribed once you click it." });
      setStatus("success");
      setEmail("");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      console.error(err);
      track(EVT.NEWSLETTER_FAILED, {
        source: "footer",
        reason: err instanceof Error ? err.message : "unknown",
      });
      toast({ title: "Something went wrong", description: "Please try again in a moment.", variant: "destructive" });
      setStatus("idle");
    }
  };

  return (
    <div className="mt-8 max-w-sm">
      <p className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/40">
        Newsletter
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2 border-b border-cream/25 pb-2 focus-within:border-butter/70">
        <Honeypot />
        <input
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@somewhere.com"
          aria-label="Email address"
          className="font-serif flex-1 bg-transparent text-[14px] text-cream placeholder:text-cream/35 focus:outline-none"
          disabled={status === "loading"}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="ui text-[10px] font-semibold uppercase tracking-[0.22em] text-cream/70 transition-colors hover:text-butter disabled:opacity-50 whitespace-nowrap"
        >
          {status === "loading" ? "…" : status === "success" ? "Thanks" : "Subscribe →"}
        </button>
      </form>
    </div>
  );
};

const Footer = () => {
  return (
    <footer className="mk-paper-soft mk-paper-soft-dark paper-drift relative overflow-hidden bg-ink text-cream">
      {/* Restrained warm atmosphere - establishment, not promotion */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-24 h-[440px] w-[440px] rounded-full opacity-[0.08] blur-[120px]"
        style={{ background: "hsl(var(--tomato))" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-0 h-[360px] w-[360px] rounded-full opacity-[0.06] blur-[100px]"
        style={{ background: "hsl(var(--butter))" }}
      />
      {/* Soft grain - calm texture */}
      <div aria-hidden className="mk-grain pointer-events-none absolute inset-0 opacity-[0.10]" />
      {/* Faint edge rule */}
      <div className="absolute inset-x-0 top-0 h-px bg-cream/8" aria-hidden />

      <div className="container relative py-16 md:py-20">
        <div className="grid grid-cols-12 gap-x-8 gap-y-12 md:gap-x-12">
          {/* Left: identity + promise */}
          <div className="col-span-12 md:col-span-5">
            <div className="flex items-center">
              <img src={logoLight} alt="PizzaDAO" className="h-7 w-auto md:h-8" />
            </div>
            <p className="font-serif mt-5 max-w-sm text-[15px] leading-[1.6] text-cream/60">
              A global community built around pizza, generosity, and the people who show up.
            </p>
            <NewsletterSignup />
            <div className="mt-8 flex items-baseline gap-3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-tomato/70" />
              <RotatingTagline />
            </div>
          </div>

          {/* Right: link columns */}
          <div className="col-span-12 grid grid-cols-2 gap-x-8 gap-y-10 md:col-span-7 md:grid-cols-4">
            {cols.map((c) => (
              <div key={c.title}>
                <div className="ui text-[9.5px] font-medium uppercase tracking-[0.24em] text-cream/40">
                  {c.title}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {c.items.map((i) => {
                    const item = typeof i === "string" ? { label: i, href: "#" } : i;
                    return (
                      <li key={item.label}>
                        <a
                          href={item.href}
                          className="font-serif text-[14px] text-cream/75 transition-colors duration-300 hover:text-butter"
                        >
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar - calm, established */}
        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-cream/8 pt-6 md:flex-row md:items-center">
          <span className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-cream/35">
            © {new Date().getFullYear()} PizzaDAO · A global cultural programme
          </span>
          <div className="flex gap-6">
            <a href="/privacy" className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-cream/45 transition-colors hover:text-butter">Privacy</a>
            <a href="/terms" className="ui text-[10px] font-medium uppercase tracking-[0.24em] text-cream/45 transition-colors hover:text-butter">Terms</a>
            
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
