// app/ui/onboarding/MagicLoginFlow.tsx
//
// mozzarella-41832 — Editorial restyle.
// Visual rewrite of the "DM me a login link" form (POST /api/auth/magic-login/request).
// arugula-30866 — i18n via next-intl (onboarding.magicLogin.*).
// While on "check your DMs" the tab polls /api/auth/magic-login/status: it moves on by itself when
// the link logs this browser in (another tab), and says so when the link was opened elsewhere.
"use client";

import { LS_KEY } from "./types";
import { sanitizeSignupDraft } from "@/app/lib/signup-draft";
import { trackActivation } from "@/app/lib/activation-client";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { ArrowLeft, ArrowUpRight, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { loggedInLanding } from "@/app/lib/login-return";
import { marketingHomeAtRoot } from "@/app/lib/marketing-site";

const WIZARD_HOME = marketingHomeAtRoot() ? "/start" : "/";

const DISCORD_INVITE =
  process.env.NEXT_PUBLIC_DISCORD_INVITE || "https://discord.gg/pizzadao";

/** Discord OAuth login: identifies the member without sending a DM. */
const DISCORD_LOGIN_PATH = "/api/discord/login";

/** The Discord login link, carrying this page's ?returnTo so the member lands where they were headed. */
export function discordLoginHref(search: string): string {
  const returnTo = new URLSearchParams(search).get("returnTo");
  return returnTo ? `${DISCORD_LOGIN_PATH}?next=${encodeURIComponent(returnTo)}` : DISCORD_LOGIN_PATH;
}

type State =
  | { step: "form" }
  | { step: "sending" }
  | { step: "sent"; username: string; hasDraft?: boolean; sentAt?: number }
  | { step: "elsewhere"; username: string }
  | { step: "error"; code: string; message: string; username: string };

export type LoginStatus = { loggedIn: boolean; openedElsewhere: boolean; sessionCreatedAt?: number };

/** This browser's login state as seen by the "check your DMs" tab; null when it can't tell. */
export async function fetchLoginStatus(): Promise<LoginStatus | null> {
  try {
    const res = await fetch("/api/auth/magic-login/status", { credentials: "include", cache: "no-store" });
    if (!res?.ok) return null;
    const body = await res.json();
    const sessionCreatedAt = typeof body?.sessionCreatedAt === "number" ? body.sessionCreatedAt : undefined;
    return { loggedIn: body?.loggedIn === true, openedElsewhere: body?.openedElsewhere === true, sessionCreatedAt };
  } catch {
    return null;
  }
}

/** Where this tab goes once it is logged in: the page the login started from, else dashboard/wizard. */
export async function landingAfterLogin(search: string): Promise<string> {
  const params = new URLSearchParams(search);
  let me: { discordId?: string; memberId?: string | null; nick?: string; username?: string } = {};
  try {
    const res = await fetch("/api/me", { credentials: "include", cache: "no-store" });
    if (res?.ok) me = await res.json();
  } catch {}
  // No resumeSignup here: this tab's own signup draft is still in its localStorage.
  return loggedInLanding(me, { returnTo: params.get("returnTo"), wizardHome: WIZARD_HOME });
}

/** /login skips its form for a logged-in visitor only without a login error, or after "already used". */
export function shouldAutoContinue(loginError?: string | null): boolean {
  return !loginError || loginError === "link_already_used";
}

/** ?switch=1 keeps the form for a logged-in visitor who wants to log in as someone else. */
export function isSwitching(search: string): boolean {
  return new URLSearchParams(search).get("switch") === "1";
}

/**
 * Whether the session the status reports came from this link rather than one the browser already
 * had (possible with ?switch=1). Both times are server clocks; 5 s of slack covers skew between
 * instances. Missing times count as new.
 */
export function isNewSession(status: LoginStatus, sentAt: number | undefined): boolean {
  if (sentAt === undefined || status.sessionCreatedAt === undefined) return true;
  return status.sessionCreatedAt >= sentAt - 5000;
}

/** "Sign in with Telegram": what the tab shows while it waits for the tap in the bot. */
type TgState =
  | { step: "idle" }
  | { step: "starting" }
  | { step: "waiting"; url: string; matchNumber: number; until: number }
  | { step: "ended"; reason: "cancelled" | "expired" | "leftServer" | "unavailable" };

/** Whether /login offers the Telegram button. ?telegram=1 shows it to testers while an allowlist is set. */
export async function fetchTelegramSignInEnabled(search: string): Promise<boolean> {
  try {
    const forced = new URLSearchParams(search).get("telegram") === "1";
    const res = await fetch(`/api/auth/telegram/start${forced ? "?forced=1" : ""}`, { credentials: "include", cache: "no-store" });
    if (!res?.ok) return false;
    return (await res.json())?.enabled === true;
  } catch {
    return false;
  }
}

/** How often the "check your DMs" tab looks for the login, and for how long (the link lives 10 min). */
const WATCH_INTERVAL_MS = 3000;
const WATCH_FOR_MS = 11 * 60 * 1000;

type Props = {
  onBack: () => void;
  loginError?: string | null;
  /** Full-page navigation once logged in (a reload, so every session cache starts fresh). Swappable in tests. */
  navigate?: (href: string) => void;
};

const HERO_SPOTLIGHT: CSSProperties = {
  background:
    "radial-gradient(80% 60% at 30% 0%, hsl(46 100% 62% / 0.20), transparent 65%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.10), transparent 70%)",
};

const assignLocation = (href: string) => window.location.assign(href);

export function MagicLoginFlow({ onBack, loginError, navigate = assignLocation }: Props) {
  const t = useTranslations("onboarding.magicLogin");
  const [username, setUsername] = useState("");
  const [state, setState] = useState<State>({ step: "form" });
  // Read after mount so server and client markup match.
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(window.location.search), []);
  const discordHref = discordLoginHref(search);

  const [tgEnabled, setTgEnabled] = useState(false);
  const [tg, setTg] = useState<TgState>({ step: "idle" });
  useEffect(() => {
    let alive = true;
    fetchTelegramSignInEnabled(window.location.search).then((on) => { if (alive) setTgEnabled(on); });
    return () => { alive = false; };
  }, []);

  async function startTelegram() {
    setTg({ step: "starting" });
    try {
      const res = await fetch("/api/auth/telegram/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ returnTo: new URLSearchParams(window.location.search).get("returnTo") }),
      });
      const data = res?.ok ? await res.json() : null;
      if (!data || typeof data.url !== "string" || typeof data.matchNumber !== "number") {
        setTg({ step: "ended", reason: "unavailable" });
        return;
      }
      const ttl = typeof data.expiresInSeconds === "number" ? data.expiresInSeconds : 300;
      setTg({ step: "waiting", url: data.url, matchNumber: data.matchNumber, until: Date.now() + ttl * 1000 });
    } catch {
      setTg({ step: "ended", reason: "unavailable" });
    }
  }

  async function stopTelegram() {
    setTg({ step: "idle" });
    try {
      await fetch("/api/auth/telegram/start", { method: "DELETE", headers: { "Content-Type": "application/json" }, credentials: "include" });
    } catch {}
  }

  // While the number is shown, poll for the tap in the bot. The session comes back on the poll's own
  // response (only this browser holds the request's secret), so on "approved" we just move on.
  const tgWaitingUntil = tg.step === "waiting" ? tg.until : null;
  useEffect(() => {
    if (tgWaitingUntil === null) return;
    let stopped = false;
    let busy = false;
    const check = async () => {
      if (stopped || busy) return;
      if (Date.now() > tgWaitingUntil + 5000) { stop(); setTg({ step: "ended", reason: "expired" }); return; }
      busy = true;
      try {
        const res = await fetch("/api/auth/telegram/status", { credentials: "include", cache: "no-store" });
        const body = res?.ok ? await res.json() : null;
        busy = false;
        if (stopped || !body) return;
        if (body.status === "approved" && typeof body.href === "string") {
          stop();
          navigate(body.href);
        } else if (body.status === "cancelled" || body.status === "expired") {
          stop();
          setTg({ step: "ended", reason: body.status });
        } else if (body.status === "error") {
          stop();
          setTg({ step: "ended", reason: body.code === "telegram_left_server" ? "leftServer" : "unavailable" });
        } else if (body.status === "none") {
          stop();
          setTg({ step: "idle" });
        }
      } catch {
        busy = false;
      }
    };
    const timer = window.setInterval(check, WATCH_INTERVAL_MS);
    function stop() {
      stopped = true;
      window.clearInterval(timer);
    }
    return stop;
  }, [tgWaitingUntil, navigate]);

  // Already logged in here (e.g. the link was opened in another tab, or a second open of the same
  // link bounced to "already used"): carry on to where the login was headed instead of the form.
  // Not for other login errors (they must be seen), nor with ?switch=1 (log in as someone else).
  const autoContinue = shouldAutoContinue(loginError);
  useEffect(() => {
    if (!autoContinue || isSwitching(window.location.search)) return;
    let alive = true;
    fetchLoginStatus().then(async (status) => {
      if (!alive || !status?.loggedIn) return;
      const href = await landingAfterLogin(window.location.search);
      if (alive) navigate(href);
    });
    return () => { alive = false; };
  }, [navigate, autoContinue]);

  // "Check your DMs": the link usually opens in a NEW tab, the computer's default browser, or the
  // Discord app's own browser, so this tab would never notice the login. Watch for it: logged in
  // here -> continue; link used but still logged out here -> it was opened somewhere else, say so.
  // Not when a signup draft was sent: that link carries the draft and continues signup wherever it
  // opens, so this tab must not run signup too.
  const watching = state.step === "sent" && !state.hasDraft ? state.username : null;
  const sentAt = state.step === "sent" ? state.sentAt : undefined;
  useEffect(() => {
    if (!watching) return;
    let stopped = false;
    let busy = false;
    const until = Date.now() + WATCH_FOR_MS;
    const check = async () => {
      if (stopped || busy || document.visibilityState === "hidden") return;
      if (Date.now() > until) { stop(); return; }
      busy = true;
      const status = await fetchLoginStatus();
      busy = false;
      if (stopped || !status) return;
      if (status.loggedIn && isNewSession(status, sentAt)) {
        stop();
        navigate(await landingAfterLogin(window.location.search));
      } else if (status.openedElsewhere) {
        stop();
        setState({ step: "elsewhere", username: watching });
      }
    };
    const timer = window.setInterval(check, WATCH_INTERVAL_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void check(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    function stop() {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    }
    return stop;
  }, [watching, sentAt, navigate]);

  async function handleSubmit(retryUsername?: string) {
    const name = retryUsername || username.trim();
    if (name.length < 2) return;

    setState({ step: "sending" });
    let localDraft = null;
    try { localDraft = sanitizeSignupDraft(JSON.parse(localStorage.getItem(LS_KEY) || "null")); } catch {}
    const onboarding = new URLSearchParams(window.location.search).get("onboarding") === "1";
    // The server stores a draft only on the onboarding path, so only send it there: then "a draft
    // was sent" is exactly "this link carries a signup draft".
    const signupDraft = onboarding ? localDraft : null;

    const actor = localDraft?.sessionId || crypto.randomUUID();
    try {
      const res = await fetch("/api/auth/magic-login/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: name,
          actor,
          signupDraft,
          returnTo: new URLSearchParams(window.location.search).get("returnTo"),
          onboarding,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        const sentAt = typeof data?.sentAt === "number" ? data.sentAt : undefined;
        setState({ step: "sent", username: name, hasDraft: !!signupDraft, sentAt });
        return;
      }

      setState({
        step: "error",
        code: data.status || "unknown",
        message: data.status === "lookup_failed" ? t("errorLookupFailed") : t("errorSomethingWrong"),
        username: name,
      });
    } catch {
      trackActivation("client_error", actor, "login_network");
      setState({
        step: "error",
        code: "network",
        message: t("errorNetwork"),
        username: name,
      });
    }
  }

  // ─── Login error from redirect ──────────────────────────────
  if (loginError) {
    const errorMessages: Record<string, string> = {
      invalid_token: t("errorInvalidToken"),
      link_expired: t("errorLinkExpired"),
      link_already_used: t("errorLinkAlreadyUsed"),
      missing_token: t("errorMissingToken"),
    };

    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("tryAgainHeadline")}
        />
        <EditorialNotice
          tone="error"
          message={errorMessages[loginError] || t("errorGeneric")}
        />
        <BackLink onBack={onBack} label={t("back")} />
      </Shell>
    );
  }

  // ─── Sign in with Telegram: waiting / ended ─────────────────
  if (tg.step === "waiting") {
    return (
      <Shell>
        <EditorialHeader overline={t("overline")} headline={t("telegram.waitingHeadline")} />
        <EditorialNotice tone="info" message={t("telegram.numberHint")} />
        <p
          className="font-[family-name:var(--font-display)] font-black text-foreground"
          style={{ fontSize: "clamp(3rem, 12vw, 5rem)", lineHeight: 1 }}
          aria-live="polite"
        >
          {tg.matchNumber}
        </p>
        <p className="text-sm text-foreground/70">{t("telegram.waitingNote")}</p>
        <div className="grid gap-3">
          <a
            href={tg.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-pill-lg group no-underline"
            style={{ background: "hsl(var(--tomato-deep))", color: "hsl(var(--cream))", boxShadow: "var(--shadow-soft)" }}
          >
            {t("telegram.openButton")}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
          <button
            type="button"
            onClick={() => void stopTelegram()}
            className="btn-pill-lg"
            style={{ background: "transparent", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--foreground) / 0.25)" }}
          >
            {t("telegram.stopButton")}
          </button>
        </div>
      </Shell>
    );
  }
  if (tg.step === "ended") {
    return (
      <Shell>
        <EditorialHeader overline={t("overline")} headline={t("tryAgainHeadline")} />
        <EditorialNotice tone="error" message={t(`telegram.${tg.reason}`)} />
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => setTg({ step: "idle" })}
            className="btn-pill-lg"
            style={{ background: "transparent", color: "hsl(var(--foreground))", border: "1px solid hsl(var(--foreground) / 0.25)" }}
          >
            {t("telegram.startAgain")}
          </button>
          <BackLink onBack={onBack} label={t("back")} />
        </div>
      </Shell>
    );
  }

  // ─── Sent state ─────────────────────────────────────────────
  if (state.step === "sent") {
    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("checkDmsHeadline")}
        />
        <EditorialNotice
          tone="success"
          message={t.rich("sentMessage", {
            username: state.username,
            b: (chunks) => <strong className="text-foreground">{chunks}</strong>,
          })}
        />
        {state.hasDraft ? (
          <p className="text-sm text-foreground/70">{t("sameBrowserHint")}</p>
        ) : (
          <p className="text-sm text-foreground/70">{t("sentOpenHereHint")}</p>
        )}
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(state.username)}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.25)",
            }}
          >
            {t("resendButton")}
          </button>
          <BackLink onBack={onBack} label={t("back")} />
        </div>
      </Shell>
    );
  }

  // ─── Link opened in another browser ─────────────────────────
  if (state.step === "elsewhere") {
    return (
      <Shell>
        <EditorialHeader overline={t("overline")} headline={t("elsewhereHeadline")} />
        <EditorialNotice tone="info" message={t("elsewhereMessage")} />
        <p className="text-sm text-foreground/70">{t("elsewhereHowTo")}</p>
        <div className="grid gap-3">
          <a
            href={discordHref}
            className="btn-pill-lg no-underline"
            style={{
              background: "hsl(var(--tomato-deep))",
              color: "hsl(var(--cream))",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            {t("openDmsAltButton")}
          </a>
          <button
            type="button"
            onClick={() => handleSubmit(state.username)}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.25)",
            }}
          >
            {t("sendNewLinkButton")}
          </button>
          <BackLink onBack={onBack} label={t("back")} />
        </div>
      </Shell>
    );
  }

  // ─── Error states ───────────────────────────────────────────
  if (state.step === "error") {
    if (state.code === "not_found") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("joinFirstHeadline")}
          />
          <EditorialNotice
            tone="info"
            message={t("joinFirstMessage")}
          />
          <p className="text-sm text-foreground/70">{t("useUsernameHint")}</p>
          <div className="grid gap-3">
            <a
              href={DISCORD_INVITE}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-pill-lg group no-underline"
              style={{
                background: "hsl(var(--tomato-deep))",
                color: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              {t("joinDiscordButton")}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <button
              type="button"
              onClick={() => handleSubmit(state.username)}
              className="btn-pill-lg"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              {t("joinedTryAgainButton")}
            </button>
            <button
              type="button"
              onClick={() => setState({ step: "form" })}
              className="btn-pill-lg"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              {t("editNameButton")}
            </button>
            <BackLink onBack={onBack} label={t("back")} />
          </div>
        </Shell>
      );
    }

    if (state.code === "ambiguous") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("ambiguousHeadline")}
          />
          <EditorialNotice
            tone="info"
            message={t("ambiguousMessage")}
          />
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => setState({ step: "form" })}
              className="btn-pill-lg"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              {t("editNameButton")}
            </button>
            <BackLink onBack={onBack} label={t("back")} />
          </div>
        </Shell>
      );
    }

    if (state.code === "dm_failed") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("openDmsHeadline")}
          />
          <EditorialNotice
            tone="error"
            message={t("openDmsMessage")}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-2xl border border-foreground/15 p-4" aria-label={t("openDmsDesktopTitle")}>
              <h3 className="font-bold text-[15px]">{t("openDmsDesktopTitle")}</h3>
              <ol
                className="mt-2 ml-5 grid gap-2 text-[14px] leading-relaxed text-foreground/80"
                style={{ listStyleType: "decimal" }}
              >
                <li>{t("openDmsStep1")}</li>
                <li>{t("openDmsStep2")}</li>
                <li>{t("openDmsStep3")}</li>
              </ol>
            </section>
            <section className="rounded-2xl border border-foreground/15 p-4" aria-label={t("openDmsMobileTitle")}>
              <h3 className="font-bold text-[15px]">{t("openDmsMobileTitle")}</h3>
              <ol
                className="mt-2 ml-5 grid gap-2 text-[14px] leading-relaxed text-foreground/80"
                style={{ listStyleType: "decimal" }}
              >
                <li>{t("openDmsMobile1")}</li>
                <li>{t("openDmsMobile2")}</li>
                <li>{t("openDmsMobile3")}</li>
                <li>{t("openDmsMobile4")}</li>
              </ol>
            </section>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => handleSubmit(state.username)}
              className="btn-pill-lg group"
              style={{
                background: "hsl(var(--tomato-deep))",
                color: "hsl(var(--cream))",
              }}
            >
              {t("tryAgainButton")}
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </button>
            <p className="text-sm text-foreground/70">{t("openDmsAltIntro")}</p>
            <a
              href={discordHref}
              className="btn-pill-lg no-underline"
              style={{
                background: "transparent",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--foreground) / 0.25)",
              }}
            >
              {t("openDmsAltButton")}
            </a>
            <BackLink onBack={onBack} label={t("back")} />
          </div>
        </Shell>
      );
    }

    if (state.code === "rate_limited") {
      return (
        <Shell>
          <EditorialHeader
            overline={t("overline")}
            headline={t("slowDownHeadline")}
          />
          <EditorialNotice
            tone="error"
            message={t("rateLimitedMessage")}
          />
          <BackLink onBack={onBack} label={t("back")} />
        </Shell>
      );
    }

    // Generic error
    return (
      <Shell>
        <EditorialHeader
          overline={t("overline")}
          headline={t("snappedHeadline")}
        />
        <EditorialNotice tone="error" message={state.message} />
        <div className="grid gap-3">
          <button
            type="button"
            onClick={() => handleSubmit(state.username)}
            className="btn-pill-lg group"
            style={{
              background: "hsl(var(--tomato-deep))",
              color: "hsl(var(--cream))",
            }}
          >
            {t("tryAgainButton")}
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
          <BackLink onBack={onBack} label={t("back")} />
        </div>
      </Shell>
    );
  }

  // ─── Form / sending state ──────────────────────────────────
  return (
    <Shell>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[40svh] opacity-60"
        style={HERO_SPOTLIGHT}
      />
      <EditorialHeader
        overline={t("overline")}
        headline={t("dmMeHeadline")}
      />
      <p
        className="max-w-md text-foreground/70"
        style={{ fontSize: "15px", lineHeight: 1.55 }}
      >
        {t("tagline")}
      </p>
      <p className="max-w-md text-foreground/70" style={{ fontSize: "14px", lineHeight: 1.5 }}>
        {t("dmHint")}
      </p>
      <a
        href={discordHref}
        className="btn-pill-lg no-underline justify-self-start"
        style={{
          background: "transparent",
          color: "hsl(var(--foreground))",
          border: "1px solid hsl(var(--foreground) / 0.25)",
          minHeight: 44,
        }}
      >
        {t("dmHintAlt")}
      </a>
      {tgEnabled && (
        <div className="grid justify-items-start gap-1">
          <button
            type="button"
            onClick={() => void startTelegram()}
            disabled={tg.step === "starting"}
            className="btn-pill-lg"
            style={{
              background: "transparent",
              color: "hsl(var(--foreground))",
              border: "1px solid hsl(var(--foreground) / 0.25)",
              minHeight: 44,
            }}
          >
            {t("telegram.button")}
          </button>
          <p className="text-[13px] text-foreground/60">{t("telegram.buttonHint")}</p>
        </div>
      )}

      <div
        className="relative overflow-hidden rounded-[22px] transition-shadow"
        style={{
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--rule-warm) / 0.6)",
          boxShadow: "0 30px 60px -40px hsl(46 100% 50% / 0.35)",
        }}
      >
        <div
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-40"
        />
        <label className="relative flex items-center gap-3 px-4 py-3.5 md:gap-4 md:px-5 md:py-4">
          <Sparkles
            className="h-5 w-5 shrink-0 text-foreground/70"
            aria-hidden
          />
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            placeholder={t("usernamePlaceholder")}
            autoFocus
            disabled={state.step === "sending"}
            aria-label={t("usernameAriaLabel")}
            maxLength={32}
            autoComplete="username"
            className="font-[family-name:var(--font-display)] w-full bg-transparent font-black leading-tight tracking-tight focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30 rounded-md disabled:opacity-50"
            style={{
              fontSize: "clamp(1.1rem, 2.2vw, 1.5rem)",
              color: "hsl(var(--foreground))",
            }}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <button
          type="button"
          onClick={() => handleSubmit()}
          disabled={state.step === "sending" || username.trim().length < 2}
          className="btn-pill-lg group"
          style={{
            background: "hsl(var(--tomato-deep))",
            color: "hsl(var(--cream))",
            boxShadow: "var(--shadow-soft)",
          }}
        >
          {state.step === "sending" ? t("sendingButton") : t("sendButton")}
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </button>
        <BackLink onBack={onBack} label={t("back")} />
      </div>
    </Shell>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Sub-components
   ────────────────────────────────────────────────────────────────────────── */

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="relative grid gap-6 fade-up py-2">{children}</div>;
}

function EditorialHeader({
  overline,
  headline,
}: {
  overline: string;
  headline: string;
}) {
  return (
    <header className="relative">
      <p className="overline text-tomato-readable">{overline}</p>
      <h2
        className="font-[family-name:var(--font-display)] mt-3 max-w-[16ch] font-black tracking-[-0.015em] text-foreground"
        style={{
          fontSize: "clamp(1.8rem, 4.4vw, 2.8rem)",
          lineHeight: 0.95,
          textWrap: "balance",
        }}
      >
        {headline}
      </h2>
    </header>
  );
}

function EditorialNotice({
  tone,
  message,
}: {
  tone: "success" | "info" | "error";
  message: React.ReactNode;
}) {
  const palette = {
    success: {
      bg: "hsl(140 50% 95%)",
      border: "hsl(140 50% 35% / 0.35)",
      ink: "hsl(140 50% 28%)",
    },
    info: {
      bg: "hsl(var(--muted))",
      border: "hsl(var(--foreground) / 0.18)",
      ink: "hsl(var(--foreground))",
    },
    error: {
      bg: "hsl(var(--destructive) / 0.1)",
      border: "hsl(var(--destructive) / 0.35)",
      ink: "hsl(var(--destructive))",
    },
  }[tone];

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[18px] border p-4 md:p-5"
      style={{
        background: palette.bg,
        borderColor: palette.border,
      }}
    >
      <p
        className="relative font-[family-name:var(--font-display)] font-bold"
        style={{
          color: palette.ink,
          fontSize: "15px",
          lineHeight: 1.4,
        }}
      >
        {message}
      </p>
    </div>
  );
}

function BackLink({ onBack, label }: { onBack: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="ui inline-flex items-center justify-center gap-1.5 self-center text-[13px] uppercase tracking-[0.08em] text-foreground/70 transition-colors hover:text-tomato-readable min-h-11"
      style={{ background: "none", border: "none" }}
    >
      <ArrowLeft className="h-3 w-3" />
      {label}
    </button>
  );
}
