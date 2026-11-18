"use client";

import { useEffect, useState } from "react";
import { Link } from "@/app/(marketing)/_site/lib/router";
const logoLight = "/marketing/assets/logo-light.svg";
import { invokeForm, honeypot } from "@/app/(marketing)/_site/lib/forms";
import Honeypot from "@/app/(marketing)/_site/components/Honeypot";
import { useToast } from "@/app/(marketing)/_site/hooks/use-toast";
import { identifyByEmail, track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";

type FooterItem = { label: string; href: string };

const cols = [
  { title: "Start here", items: [{ label: "Join", href: "/join" }, { label: "Get your mafia name", href: "/get-your-mafia-name" }, { label: "Handbook", href: "/handbook" }, { label: "Calls", href: "/calls" }] as FooterItem[] },
  { title: "More", items: [{ label: "About", href: "/about" }, { label: "Global Pizza Party", href: "https://globalpizza.party" }, { label: "Partners", href: "/partners" }, { label: "Articles", href: "/articles" }] as FooterItem[] },
  { title: "Resources", items: [{ label: "Manuals", href: "/manuals" }] as FooterItem[] },
  { title: "Press", items: [{ label: "Brand System", href: "/brand-system" }, { label: "Contact", href: "/contact" }, { label: "Inquiries", href: "/contact" }] as FooterItem[] },
  { title: "Elsewhere", items: [{ label: "Instagram", href: "https://www.instagram.com/Pizza_DAO/" }, { label: "X / Twitter", href: "https://x.com/Pizza_DAO" }, { label: "YouTube", href: "https://www.youtube.com/@PizzaDAO" }] as FooterItem[] },
];

const PHRASES = [
  "Pizza the planet",
  "Slice by slice",
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
      className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70 transition-opacity duration-500"
      style={{ opacity: show ? 1 : 0 }}
    >
      {PHRASES[index]}
    </span>
  );
};

export const NewsletterSignup = ({ source = "footer", className = "mt-8 max-w-sm", idPrefix = "footer" }: { source?: string; className?: string; idPrefix?: string }) => {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) || trimmed.length > 320) {
      track(EVT.NEWSLETTER_FAILED, { source, reason: "validation" });
      toast({ title: "Check your email", description: "Please enter a valid email address.", variant: "destructive" });
      return;
    }
    setStatus("loading");
    try {
      const { data, error } = await invokeForm("/api/public/newsletter", {
        body: { email: trimmed, source, website: honeypot(e) },
      });
      if (error || !data?.ok) throw error ?? new Error("Subscribe failed");
      void identifyByEmail(trimmed, { newsletter_source: source });
      track(EVT.NEWSLETTER_SUBMITTED, { source });
      toast({ title: "Check your inbox", description: "We sent a link to confirm your address. You're subscribed once you click it." });
      setStatus("success");
      setEmail("");
      setTimeout(() => setStatus("idle"), 4000);
    } catch (err) {
      console.error(err);
      track(EVT.NEWSLETTER_FAILED, {
        source,
        reason: err instanceof Error ? err.message : "unknown",
      });
      toast({ title: "Something went wrong", description: "Please try again in a moment.", variant: "destructive" });
      setStatus("idle");
    }
  };

  return (
    <div className={className}>
      <p className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70">
        Newsletter
      </p>
      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2 border-b border-cream/25 pb-2 focus-within:border-butter/70">
        <Honeypot />
        <label htmlFor={`${idPrefix}-newsletter-email`} className="sr-only">
          Email address
        </label>
        <input
          id={`${idPrefix}-newsletter-email`}
          type="email"
          required
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@somewhere.com"
          className="font-serif flex-1 bg-transparent text-[14px] text-cream placeholder:text-cream/60 focus:outline-none"
          disabled={status === "loading"}
        />
        <button
          type="submit"
          disabled={status === "loading"}
          className="ui inline-flex min-h-11 items-center px-2 text-xs font-semibold uppercase tracking-[0.18em] text-cream/80 transition-colors hover:text-butter disabled:opacity-50 whitespace-nowrap"
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
            <p className="font-serif mt-5 max-w-sm text-[15px] leading-[1.6] text-cream/70">
              A global community built around pizza, generosity, and the people who show up.
            </p>
            <NewsletterSignup />
            <div className="mt-8 flex items-baseline gap-3">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-tomato/70" />
              <RotatingTagline />
            </div>
          </div>

          {/* Right: link columns */}
          <div className="col-span-12 grid grid-cols-2 gap-x-8 gap-y-10 md:col-span-7 md:grid-cols-3">
            {cols.map((c) => (
              <div key={c.title}>
                <div className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70">
                  {c.title}
                </div>
                <ul className="mt-4 space-y-2.5">
                  {c.items.map((i) => {
                    const item = i;
                    return (
                      <li key={item.label}>
                        {/^https?:/.test(item.href) ? (
                          <a
                            href={item.href}
                            className="font-serif text-[14px] text-cream/80 transition-colors duration-300 hover:text-butter"
                          >
                            {item.label}
                          </a>
                        ) : (
                          <Link
                            to={item.href}
                            className="font-serif text-[14px] text-cream/80 transition-colors duration-300 hover:text-butter"
                          >
                            {item.label}
                          </Link>
                        )}
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
          <span className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70">
            © {new Date().getFullYear()} PizzaDAO · A global cultural programme
          </span>
          <div className="flex gap-6">
            <Link to="/privacy" className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70 transition-colors hover:text-butter">Privacy</Link>
            <Link to="/terms" className="ui text-xs font-medium uppercase tracking-[0.2em] text-cream/70 transition-colors hover:text-butter">Terms</Link>
            
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
