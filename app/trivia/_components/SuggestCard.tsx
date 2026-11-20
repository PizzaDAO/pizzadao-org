"use client";

// "Suggest a question": Discord-signed-in members only. Sends POST /api/trivia/suggest; an admin reviews it in /admin/trivia.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { loginHrefFrom } from "@/app/lib/login-return";
import { paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";
import { inputClass, postJson } from "./shared";

const CATEGORY_IDS = ["pizza-day", "jercos", "early-bitcoin", "satoshi", "protocol", "myth-busting", "pizzadao", "just-for-fun"] as const;

interface Status {
  signedIn: boolean;
  remaining?: number;
  limit?: number;
}
interface SuggestReply {
  code?: string;
  field?: string;
}

export default function SuggestCard() {
  const t = useTranslations("trivia");
  const pathname = usePathname() || "/trivia";
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "done" | "limit" | "unavailable" | "invalid">("idle");
  const [field, setField] = useState<string | null>(null);
  const [form, setForm] = useState({ question: "", answer: "", aliases: "", source: "", category: "" });

  useEffect(() => {
    let live = true;
    fetch("/api/trivia/suggest", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((s) => live && setStatus(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    setField(null);
    const r = await postJson<SuggestReply>("/api/trivia/suggest", { ...form, category: form.category || undefined });
    if (r.ok) {
      setState("done");
      setForm({ question: "", answer: "", aliases: "", source: "", category: "" });
      setStatus((s) => (s && s.remaining !== undefined ? { ...s, remaining: Math.max(0, s.remaining - 1) } : s));
      return;
    }
    if (r.status === 429 && r.data?.code === "LIMIT") return setState("limit");
    if (r.status === 400 && r.data?.code === "INVALID") {
      setField(r.data.field ?? null);
      return setState("invalid");
    }
    setState("unavailable");
  }

  const signedIn = status?.signedIn === true;
  const outOfSuggestions = signedIn && status?.remaining === 0;

  return (
    <section className={`${paperCard} p-6 sm:p-8`} aria-labelledby="trivia-suggest-title">
      <p className="overline m-0 text-tomato-readable">{t("suggestOverline")}</p>
      <h2 id="trivia-suggest-title" className="font-display mb-0 mt-1 text-xl font-black md:text-2xl">
        {t("suggestTitle")}
      </h2>
      <p className="mb-0 mt-3 text-foreground/80" style={{ lineHeight: 1.55 }}>
        {t("suggestDek")}
      </p>

      {status && !signedIn && (
        <p className="mb-0 mt-4 flex flex-wrap items-center gap-3 text-sm text-foreground/75">
          <span>{t("suggestSignIn")}</span>
          <Link href={loginHrefFrom(pathname)} className={pillOutline}>
            {t("signIn")}
          </Link>
        </p>
      )}

      {signedIn && state === "done" && (
        <p role="status" className="mb-0 mt-4 text-foreground">
          {t("suggestThanks")}
        </p>
      )}

      {signedIn && !open && state !== "done" && (
        <button type="button" onClick={() => setOpen(true)} disabled={outOfSuggestions} className={`${pillInk} mt-4`}>
          {outOfSuggestions ? t("suggestLimit", { limit: status?.limit ?? 5 }) : t("suggestOpen")}
        </button>
      )}

      {signedIn && open && state !== "done" && (
        <form className="mt-4 grid gap-3" onSubmit={submit}>
          <label className="grid gap-1 text-sm font-semibold">
            {t("suggestQuestion")}
            <textarea className={`${inputClass} min-h-20 font-normal`} value={form.question} maxLength={300} required minLength={8} onChange={set("question")} aria-invalid={field === "question"} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t("suggestAnswer")}
            <input className={`${inputClass} font-normal`} value={form.answer} maxLength={120} required onChange={set("answer")} aria-invalid={field === "answer"} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t("suggestAliases")}
            <input className={`${inputClass} font-normal`} value={form.aliases} maxLength={400} placeholder={t("suggestAliasesHint")} onChange={set("aliases")} aria-invalid={field === "aliases"} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t("suggestSource")}
            <input className={`${inputClass} font-normal`} type="url" inputMode="url" value={form.source} maxLength={300} required placeholder="https://" onChange={set("source")} aria-invalid={field === "source"} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            {t("suggestCategory")}
            <select className={`${inputClass} font-normal`} value={form.category} onChange={set("category")}>
              <option value="">{t("suggestCategoryAny")}</option>
              {CATEGORY_IDS.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={state === "sending"} className={pillInk}>
              {state === "sending" ? t("reportSending") : t("suggestSend")}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={pillOutline}>
              {t("cancel")}
            </button>
            {status?.remaining !== undefined && <span className="text-sm text-foreground/70">{t("suggestRemaining", { n: status.remaining })}</span>}
          </div>
          {state === "invalid" && (
            <p role="alert" className="m-0 text-sm text-tomato-readable">
              {t(field && ["question", "answer", "aliases", "source"].includes(field) ? (`suggestInvalid_${field}` as "suggestInvalid_question") : "suggestInvalid_generic")}
            </p>
          )}
          {state === "limit" && (
            <p role="alert" className="m-0 text-sm text-tomato-readable">
              {t("suggestLimit", { limit: status?.limit ?? 5 })}
            </p>
          )}
          {state === "unavailable" && (
            <p role="alert" className="m-0 text-sm text-tomato-readable">
              {t("suggestError")}
            </p>
          )}
        </form>
      )}
    </section>
  );
}
