"use client";

import { useEffect, useRef, useState } from "react";
import { invokeForm } from "@/app/(marketing)/_site/lib/forms";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import PageHero from "@/app/(marketing)/_site/components/PageHero";
import { identifyByEmail, track } from "@/app/(marketing)/_site/lib/analytics/posthog";
import { EVT } from "@/app/(marketing)/_site/lib/analytics/events";
import { useTrackOutbound } from "@/app/(marketing)/_site/lib/analytics/useTrackOutbound";

const INTENTS = [
  "Partnership",
  "Host a pizza party",
  "Sponsor / brand collaboration",
  "Press / media",
  "Join the community",
  "Build with PizzaDAO",
  "Pizzeria / pizza industry",
  "Something else",
];

const CHANNELS: { k: string; v: string; href: string; note: string }[] = [
  {
    k: "Discord",
    v: "Walk into the kitchen",
    href: "https://discord.pizzadao.xyz/",
    note: "The fastest way to meet the crew. Open chats, open doors.",
  },
  {
    k: "X / Twitter",
    v: "@Pizza_DAO",
    href: "https://x.com/Pizza_DAO",
    note: "Field reports, party photos, occasional pizza opinions.",
  },
  {
    k: "Community",
    v: "Explore chapters",
    href: "/community",
    note: "Sixty plus cities. Find the one cooking near you.",
  },
  {
    k: "Email",
    v: "hello@pizzadao.org",
    href: "mailto:hello@pizzadao.org",
    note: "Old fashioned but reliable. We read every note.",
  },
];

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const ContactPage = () => {
  const [name, setName] = useState("");
  const [organization, setOrganization] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [intents, setIntents] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const startedRef = useRef(false);
  const trackOutbound = useTrackOutbound("contact_aside");

  useEffect(() => {
    track(EVT.CONTACT_VIEWED, { page: "/contact" });
  }, []);

  const markStarted = (field: string) => {
    if (startedRef.current) return;
    startedRef.current = true;
    track(EVT.CONTACT_STARTED, { first_field: field });
  };

  const toggleIntent = (i: string) => {
    setIntents((cur) => {
      const next = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i];
      track(EVT.CONTACT_INTENT_SELECTED, {
        intent: i,
        selected: !cur.includes(i),
        intents_count: next.length,
      });
      return next;
    });
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Add your name so we know who's writing.";
    if (!email.trim()) e.email = "We need an email to write you back.";
    else if (!isEmail(email.trim())) e.email = "That email looks off.";
    if (!message.trim()) e.message = "Tell us a little about what's on your mind.";
    setErrors(e);
    if (Object.keys(e).length) {
      track(EVT.CONTACT_FAILED, { reason: "validation", fields: Object.keys(e) });
    }
    return Object.keys(e).length === 0;
  };

  const onSubmit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting) return;
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const { error: invokeError } = await invokeForm(
        "/api/public/contact",
        {
          body: {
            name: name.trim(),
            organization: organization.trim() || undefined,
            email: email.trim(),
            message: message.trim(),
            intents,
          },
        },
      );

      if (invokeError) throw invokeError;
      // Identify after explicit submit (consent boundary).
      void identifyByEmail(email.trim(), {
        name: name.trim(),
        organization: organization.trim() || undefined,
        intents,
        source_page: "/contact",
      });
      track(EVT.CONTACT_SUBMITTED, {
        intents,
        intents_count: intents.length,
        has_org: Boolean(organization.trim()),
        message_length: message.trim().length,
      });
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      track(EVT.CONTACT_FAILED, {
        reason: "submit_error",
        message: err instanceof Error ? err.message : "unknown",
      });
      setError(
        "Something went wrong sending your message. Please try again or email hello@pizzadao.org directly.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-cream text-ink">
      <SiteNav solid />

      <PageHero
        section="§ D, Contact"
        title="Let's make"
        italic="something delicious happen."
        lede="Whether you want to partner, host, sponsor, build, report, or just say hello, send us a note and we'll route it to the right PizzaDAO crew."
      />

      <section className="container py-16 md:py-24">
        <div className="grid grid-cols-12 gap-x-6 gap-y-12">
          {/* Form card */}
          <div className="col-span-12 lg:col-span-8">
            <div className="rounded-2xl border border-ink/10 bg-paper p-6 shadow-[0_1px_0_0_hsl(var(--ink)/0.05)] md:p-10">
              {submitted ? (
                <div className="py-10 text-center">
                  <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">
                    § Received
                  </p>
                  <h2 className="font-display mt-4 text-3xl font-extrabold leading-tight md:text-4xl">
                    Got it. Your note is on its way to the PizzaDAO team.
                  </h2>
                  <p className="font-serif mx-auto mt-5 max-w-md text-base text-ink/70">
                    Someone will read it shortly and route it to the right
                    person. Hang tight.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      setOrganization("");
                      setEmail("");
                      setMessage("");
                      setIntents([]);
                      setSubmitted(false);
                    }}
                    className="ui mt-8 inline-flex items-center gap-2 text-sm font-medium text-ink/70 hover:text-tomato"
                  >
                    Send another note →
                  </button>
                </div>
              ) : (
                <form onSubmit={onSubmit} noValidate>
                  <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">
                    § The form
                  </p>
                  <h2 className="font-display mt-3 text-2xl font-extrabold leading-tight md:text-3xl">
                    Drop us a note.
                  </h2>

                  {/* Intents */}
                  <fieldset className="mt-8">
                    <legend className="ui text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55">
                      What's this about? <span className="text-ink/35">(optional)</span>
                    </legend>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {INTENTS.map((i) => {
                        const active = intents.includes(i);
                        return (
                          <button
                            key={i}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggleIntent(i)}
                            className={`ui rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                              active
                                ? "border-ink bg-ink text-cream"
                                : "border-ink/20 bg-transparent text-ink/75 hover:border-ink/50 hover:text-ink"
                            }`}
                          >
                            {i}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <div className="mt-8 grid grid-cols-1 gap-6 md:grid-cols-2">
                    <Field
                      id="name"
                      label="Name"
                      required
                      value={name}
                      onChange={(v) => { markStarted("name"); setName(v); }}
                      error={errors.name}
                      autoComplete="name"
                    />
                    <Field
                      id="organization"
                      label="Organization"
                      hint="optional"
                      value={organization}
                      onChange={(v) => { markStarted("organization"); setOrganization(v); }}
                      autoComplete="organization"
                    />
                    <div className="md:col-span-2">
                      <Field
                        id="email"
                        label="Email"
                        type="email"
                        required
                        value={email}
                        onChange={(v) => { markStarted("email"); setEmail(v); }}
                        error={errors.email}
                        autoComplete="email"
                      />
                    </div>
                  </div>

                  <div className="mt-6">
                    <label
                      htmlFor="message"
                      className="ui flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55"
                    >
                      <span>
                        Message <span className="text-tomato">*</span>
                      </span>
                    </label>
                    <textarea
                      id="message"
                      required
                      rows={6}
                      value={message}
                      onChange={(e) => { markStarted("message"); setMessage(e.target.value); }}
                      aria-invalid={!!errors.message}
                      aria-describedby={errors.message ? "message-error" : undefined}
                      className={`mt-2 w-full resize-y rounded-lg border bg-cream px-4 py-3 font-serif text-base leading-relaxed text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-tomato/40 ${
                        errors.message ? "border-tomato" : "border-ink/15 focus:border-ink/40"
                      }`}
                      placeholder="Tell us what's on your mind."
                      data-ph-mask
                    />
                    {errors.message && (
                      <p id="message-error" className="ui mt-2 text-xs text-tomato">
                        {errors.message}
                      </p>
                    )}
                  </div>

                  {error && (
                    <div
                      role="alert"
                      className="ui mt-6 rounded-lg border border-tomato/30 bg-tomato/5 px-4 py-3 text-sm text-tomato"
                    >
                      {error}
                    </div>
                  )}

                  <div className="mt-8 flex flex-col-reverse items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <p className="ui text-xs text-ink/50">
                      We read every note. No autoresponders.
                    </p>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="mk-btn-pill bg-ink text-cream transition-colors hover:bg-tomato disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? "Sending..." : "Send note"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>

          {/* Side channels */}
          <aside className="col-span-12 lg:col-span-4">
            <p className="ui text-[11px] font-semibold uppercase tracking-[0.2em] text-tomato">
              § Other doors
            </p>
            <h2 className="font-display mt-3 text-2xl font-extrabold leading-tight md:text-3xl">
              Or come find us.
            </h2>
            <p className="font-serif mt-4 text-base leading-relaxed text-ink/70">
              The form goes to the same people as everything below. Pick the
              door that suits you.
            </p>

            <ul className="mt-8 divide-y divide-ink/10 border-y border-ink/10">
              {CHANNELS.map((c) => {
                const external = c.href.startsWith("http");
                return (
                  <li key={c.k}>
                    <a
                      href={c.href}
                      target={external ? "_blank" : undefined}
                      rel={external ? "noreferrer noopener" : undefined}
                      onClick={() => trackOutbound(c.k, c.href, { channel: c.k })}
                      className="group block py-5"
                    >
                      <div className="flex items-baseline justify-between gap-4">
                        <div>
                          <p className="ui text-[10px] font-semibold uppercase tracking-[0.18em] text-ink/45">
                            {c.k}
                          </p>
                          <p className="font-display mt-1 text-xl font-extrabold leading-tight transition-colors group-hover:text-tomato">
                            {c.v}
                          </p>
                        </div>
                        <span
                          aria-hidden
                          className="text-ink/40 transition-transform group-hover:translate-x-1 group-hover:text-tomato"
                        >
                          →
                        </span>
                      </div>
                      <p className="font-serif mt-2 text-sm leading-relaxed text-ink/65">
                        {c.note}
                      </p>
                    </a>
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      </section>

      <Footer />
    </main>
  );
};

type FieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  autoComplete?: string;
};

const Field = ({
  id,
  label,
  value,
  onChange,
  type = "text",
  required,
  error,
  hint,
  autoComplete,
}: FieldProps) => (
  <div>
    <label
      htmlFor={id}
      className="ui flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-ink/55"
    >
      <span>
        {label}
        {required && <span className="text-tomato"> *</span>}
      </span>
      {hint && <span className="text-ink/35 normal-case tracking-normal">{hint}</span>}
    </label>
    <input
      id={id}
      type={type}
      required={required}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={autoComplete}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
      className={`mt-2 w-full rounded-lg border bg-cream px-4 py-3 font-serif text-base text-ink placeholder:text-ink/40 focus:outline-none focus:ring-2 focus:ring-tomato/40 ${
        error ? "border-tomato" : "border-ink/15 focus:border-ink/40"
      }`}
    />
    {error && (
      <p id={`${id}-error`} className="ui mt-2 text-xs text-tomato">
        {error}
      </p>
    )}
  </div>
);

export default ContactPage;
