// app/ui/onboarding/OnboardingWizard.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { TURTLES } from "../constants";

import { LoadingScreen } from "./LoadingScreen";
import { ClaimFlow } from "./ClaimFlow";
import { MagicLoginFlow } from "./MagicLoginFlow";
import { FinaleScene } from "./FinaleScene";
import { WelcomeStep } from "./steps/WelcomeStep";
import { NameStep } from "./steps/NameStep";
import { CityStep } from "./steps/CityStep";
import { RolesStep } from "./steps/RolesStep";
import { MemberIdStep } from "./steps/MemberIdStep";
import { CrewsStep } from "./steps/CrewsStep";
import { ReviewStep } from "./steps/ReviewStep";

// mozzarella-41832: card/btn/alert primitives replaced by editorial
// utilities (.paper-soft, .btn-pill-lg, .overline) inline in the JSX.
import {
  FlowState,
  WizardData,
  CrewOption,
  NamegenResponse,
  LS_KEY,
  PENDING_CLAIM_KEY,
  uuidLike,
  initialWizardData,
} from "./types";

// ============================================================================
// Main Component
// ============================================================================

export type OnboardingWizardProps = {
  /**
   * Deep-link entry point. When set, skips the session check and URL-param
   * negotiation and starts the wizard in this flow state. Used by `/login`
   * (magic_login) and `/join` (wizard step 1 / NameStep).
   *
   * URL params still win for explicit redirects: ?loginError=... will force
   * magic_login regardless of initialFlow.
   */
  initialFlow?: FlowState;
};

export function OnboardingWizard({ initialFlow }: OnboardingWizardProps = {}) {
  const router = useRouter();
  const hasProcessedParams = useRef(false);

  // --- Flow State Machine ---
  const [flow, setFlow] = useState<FlowState>({ type: "initializing" });

  // --- Wizard Data (form state) ---
  const [data, setData] = useState<WizardData>(() => {
    // Load from localStorage on init
    if (typeof window === "undefined") return initialWizardData;

    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          ...initialWizardData,
          ...parsed,
          sessionId: parsed?.sessionId || uuidLike(),
          turtles: Array.isArray(parsed?.turtles)
            ? parsed.turtles
            : parsed?.turtle
              ? [String(parsed.turtle)]
              : [],
        };
      }
    } catch {}
    return { ...initialWizardData, sessionId: uuidLike() };
  });

  // --- Crew Options (loaded from API) ---
  const [crewOptions, setCrewOptions] = useState<CrewOption[]>([]);
  const [crewsLoading, setCrewsLoading] = useState(false);

  // --- Submission state (for button flash fix) ---
  const [isSubmitting, setIsSubmitting] = useState(false);

  // --- Error state ---
  const [error, setError] = useState<string | undefined>();
  const [errorDetails, setErrorDetails] = useState<string | undefined>();

  // --- Magic login error from redirect ---
  const [loginError, setLoginError] = useState<string | null>(null);

  // --- Name generation state ---
  const [generatingNames, setGeneratingNames] = useState(false);
  const [lastGenParams, setLastGenParams] = useState<{ topping: string; movie: string; style: string } | null>(null);

  // --- Persist data to localStorage ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    } catch {}
  }, [data]);

  // --- Load crew mappings ---
  useEffect(() => {
    let alive = true;
    (async () => {
      setCrewsLoading(true);
      try {
        const res = await fetch("/api/crew-mappings", { cache: "no-store" });
        const json = await res.json();
        if (alive && Array.isArray(json?.crews)) {
          setCrewOptions(json.crews);
        }
      } catch {}
      if (alive) setCrewsLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  // --- Initialize flow based on URL params and session ---
  useEffect(() => {
    if (hasProcessedParams.current) return;

    const url = new URL(window.location.href);
    const discordId = url.searchParams.get("discordId");
    const discordJoined = url.searchParams.get("discordJoined") === "1";
    const discordNick = url.searchParams.get("discordNick") || undefined;
    const isEdit = url.searchParams.get("edit") === "1";
    const memberId = url.searchParams.get("memberId") || undefined;
    const loginErrorParam = url.searchParams.get("loginError");

    // Clean URL params
    if (discordId || isEdit || loginErrorParam) {
      hasProcessedParams.current = true;
      url.searchParams.delete("discordId");
      url.searchParams.delete("discordJoined");
      url.searchParams.delete("sessionId");
      url.searchParams.delete("discordNick");
      url.searchParams.delete("edit");
      url.searchParams.delete("memberId");
      url.searchParams.delete("loginError");
      window.history.replaceState({}, "", url.toString());
    }

    // Handle magic login error redirect
    if (loginErrorParam) {
      setLoginError(loginErrorParam);
      setFlow({ type: "magic_login" });
      return;
    }

    // Handle Discord OAuth callback
    if (discordId) {
      setData((p) => ({ ...p, discordId, discordJoined, discordNick }));
      handleDiscordCallback(discordId, discordNick);
      return;
    }

    // Handle edit flow
    if (isEdit && memberId) {
      handleEditFlow(memberId);
      return;
    }

    // Deep-link entry: /login and /join pass an initialFlow so the wizard
    // skips the session check and URL-param negotiation. URL params above
    // still win — explicit redirects (?loginError=...) override this.
    if (initialFlow) {
      hasProcessedParams.current = true;
      setFlow(initialFlow);
      return;
    }

    // Check if user is already logged in
    checkSession();
  }, [initialFlow]);

  // --- Check existing session ---
  async function checkSession() {
    setFlow({ type: "checking_session" });
    try {
      const res = await fetch("/api/me", { credentials: "include" });
      if (res.ok) {
        const me = await res.json();
        if (me.discordId) {
          setData((p) => ({ ...p, discordId: me.discordId, discordNick: me.nick }));
          // Check if user has a member record
          const lookupRes = await fetch(`/api/member-lookup/${me.discordId}`);
          if (lookupRes.ok) {
            const lookup = await lookupRes.json();
            if (lookup.found && lookup.memberId) {
              router.push(`/dashboard/${lookup.memberId}`);
              return;
            }
          }
        }
      }
    } catch {}
    // Not logged in or no member record - show welcome
    setFlow({ type: "wizard", step: 0, isUpdate: false });
  }

  // --- Handle Discord OAuth callback ---
  async function handleDiscordCallback(discordId: string, discordNick?: string) {
    setFlow({ type: "looking_up_member", discordId });

    try {
      const res = await fetch(
        `/api/member-lookup/${discordId}${discordNick ? `?searchName=${encodeURIComponent(discordNick)}` : ""}`
      );
      const lookup = await res.json();

      // Check for auto-claim by name match
      if (lookup.found && lookup.method === "name_match" && lookup.memberId) {
        const claimRes = await fetch("/api/auto-claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId: lookup.memberId,
            expectedName: lookup.memberName || discordNick,
          }),
        });
        if (claimRes.ok) {
          router.push(`/dashboard/${lookup.memberId}`);
          return;
        }
      }

      // Already linked member
      if (lookup.found && lookup.data) {
        const hasPendingClaim = localStorage.getItem(PENDING_CLAIM_KEY) === "1";
        if (!hasPendingClaim) {
          // Auto-login
          router.push(`/dashboard/${lookup.memberId || discordId}`);
          return;
        }
        // User completed wizard, show review
        setData((p) => ({
          ...p,
          memberId: lookup.memberId,
          existingData: {
            mafiaName: lookup.data["Name"] || "",
            city: lookup.data["City"] || "",
            turtles: parseList(lookup.data["Turtles"]),
            crews: parseList(lookup.data["Crews"]),
          },
        }));
        setFlow({ type: "wizard", step: 6, isUpdate: true });
        return;
      }

      // Not found - check if user has pending wizard data
      const hasPendingClaim = localStorage.getItem(PENDING_CLAIM_KEY) === "1";
      const hasWizardData = !!(data.memberId && data.mafiaName);

      if (hasPendingClaim && hasWizardData) {
        // User completed wizard - submit directly
        submitAll();
        return;
      }

      // Show claim flow for unknown users
      setFlow({
        type: "claim_flow",
        step: "ask",
        memberId: "",
        foundName: null,
        error: null,
      });
    } catch (e) {
      setFlow({ type: "wizard", step: 0, isUpdate: false });
    }
  }

  // --- Handle edit flow ---
  async function handleEditFlow(memberId: string) {
    setFlow({ type: "looking_up_member", discordId: data.discordId || "" });
    try {
      const res = await fetch(`/api/verify-edit?memberId=${memberId}`, { credentials: "include" });
      if (!res.ok) {
        setError("Not authorized to edit this profile");
        setFlow({ type: "wizard", step: 0, isUpdate: false });
        return;
      }

      const userData = await fetch(`/api/user-data/${memberId}`);
      if (userData.ok) {
        const existing = await userData.json();
        setData((p) => ({
          ...p,
          memberId,
          mafiaName: existing["Name"] || "",
          city: existing["City"] || "",
          turtles: parseList(existing["Turtles"]),
          crews: parseList(existing["Crews"]),
          existingData: {
            mafiaName: existing["Name"] || "",
            city: existing["City"] || "",
            turtles: parseList(existing["Turtles"]),
            crews: parseList(existing["Crews"]),
          },
        }));
      }
      setFlow({ type: "wizard", step: 1, isUpdate: true });
    } catch {
      setError("Failed to load profile for editing");
      setFlow({ type: "wizard", step: 0, isUpdate: false });
    }
  }

  // --- Generate names ---
  async function generateNames(force = false) {
    setGeneratingNames(true);
    setError(undefined);

    // Check if user clicked generate with same params - treat as regenerate
    const currentParams = { topping: data.topping, movie: data.mafiaMovieTitle, style: data.style };
    const sameParams = lastGenParams &&
      lastGenParams.topping === currentParams.topping &&
      lastGenParams.movie === currentParams.movie &&
      lastGenParams.style === currentParams.style;

    const shouldForce = force || (sameParams && data.suggestions && data.suggestions.length > 0);

    try {
      const res = await fetch("/api/namegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topping: data.topping,
          movieTitle: data.mafiaMovieTitle,
          style: data.style,
          force: shouldForce,
          exclude: shouldForce ? data.seenNames : [],
        }),
      });

      const result = (await res.json()) as NamegenResponse | any;
      if (!res.ok) throw new Error(result?.error || "Failed to generate names");

      setData((p) => ({
        ...p,
        suggestions: result.suggestions,
        resolvedMovieTitle: result.resolvedMovieTitle,
        tmdbMovieId: result.tmdbMovieId,
        releaseDate: result.releaseDate,
        mediaType: result.mediaType,
        seenNames: mergeSeen(p.seenNames, result.suggestions ?? []),
      }));

      setLastGenParams(currentParams);
    } catch (e: unknown) {
      setError((e as any)?.message || "Failed to generate names");
    } finally {
      setGeneratingNames(false);
    }
  }

  // --- Submit profile ---
  async function submitAll() {
    setIsSubmitting(true);
    setFlow({ type: "submitting" });
    setError(undefined);

    try {
      // Clear pending claim flag
      localStorage.removeItem(PENDING_CLAIM_KEY);

      const res = await fetch("/api/profile", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "web",
          sessionId: data.sessionId,
          mafiaName: data.mafiaName,
          topping: data.topping,
          mafiaMovieTitle: data.mafiaMovieTitle,
          resolvedMovieTitle: data.resolvedMovieTitle,
          tmdbMovieId: data.tmdbMovieId,
          releaseDate: data.releaseDate,
          mediaType: data.mediaType,
          city: data.city,
          cityRegion: data.cityRegion,
          cityCountryCode: data.cityCountryCode,
          turtle: data.turtles.join(", "),
          turtles: data.turtles,
          crews: data.crews,
          memberId: data.memberId,
          discordId: data.discordId,
          discordJoined: data.discordJoined,
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result?.error || "Failed to save profile");
      }

      // pizzaiolo-35410 — Don't redirect immediately. Play the finale ceremony
      // first; FinaleScene's "Continue to dashboard" CTA (and the auto-redirect
      // fallback below) handles the navigation.
      const memberId = data.memberId || result?.sheets?.memberId || data.discordId;
      localStorage.removeItem(LS_KEY);
      const redirectTo = memberId ? `/dashboard/${memberId}` : "/";
      setFlow({ type: "success", redirectTo });
    } catch (e: unknown) {
      setIsSubmitting(false);
      setError((e as any)?.message || "Failed to save");
      setErrorDetails((e as any)?.details);
      setFlow({
        type: "wizard",
        step: flow.type === "wizard" ? flow.step : 5,
        isUpdate: flow.type === "wizard" && flow.isUpdate,
      });
    }
  }

  // --- Claim roles (start OAuth or submit) ---
  function claimRoles() {
    if (!data.discordId) {
      // Force persist before redirect
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(data));
        localStorage.setItem(PENDING_CLAIM_KEY, "1");
      } catch {}
      const loginUrl = `/api/discord/login?state=${encodeURIComponent(data.sessionId)}`;
      (window.top || window).location.href = loginUrl;
      return;
    }
    submitAll();
  }

  // --- Navigation helpers ---
  function goToStep(step: 0 | 1 | 2 | 3 | 4 | 5 | 6) {
    setFlow({ type: "wizard", step, isUpdate: flow.type === "wizard" && flow.isUpdate });
  }

  function nextStep() {
    if (flow.type !== "wizard") return;
    const next = Math.min(flow.step + 1, 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    // Skip step 4 (member ID) for updates
    const actualNext = flow.isUpdate && next === 4 ? 5 : next;
    setFlow({ type: "wizard", step: actualNext, isUpdate: flow.isUpdate });
  }

  function prevStep() {
    if (flow.type !== "wizard") return;
    const prev = Math.max(flow.step - 1, 0) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
    // Skip step 4 (member ID) for updates
    const actualPrev = flow.isUpdate && prev === 4 ? 3 : prev;
    setFlow({ type: "wizard", step: actualPrev, isUpdate: flow.isUpdate });
  }

  // --- Render ---

  // Loading states
  if (
    flow.type === "initializing" ||
    flow.type === "checking_session" ||
    flow.type === "looking_up_member" ||
    flow.type === "submitting"
  ) {
    return <LoadingScreen flow={flow} />;
  }

  // Magic login flow
  if (flow.type === "magic_login") {
    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[28px] border p-6 md:p-9"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-lifted)",
        }}
      >
        <MagicLoginFlow
          onBack={() => {
            setLoginError(null);
            setFlow({ type: "wizard", step: 0, isUpdate: false });
          }}
          loginError={loginError}
        />
      </div>
    );
  }

  // Claim flow
  if (flow.type === "claim_flow") {
    return (
      <ClaimFlow
        discordId={data.discordId || ""}
        discordNick={data.discordNick}
        onStartRegistration={() => {
          if (data.discordNick) {
            setData((p) => ({ ...p, mafiaName: p.discordNick }));
          }
          setFlow({ type: "wizard", step: 1, isUpdate: false });
        }}
      />
    );
  }

  // Error state
  if (flow.type === "error") {
    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[28px] border p-6 md:p-9 grid gap-5 fade-up"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p className="overline text-tomato">§ ··· Something snapped</p>
        <div
          className="relative paper-soft overflow-hidden rounded-[18px] border p-4"
          style={{
            background: "hsl(var(--destructive) / 0.08)",
            borderColor: "hsl(var(--destructive) / 0.3)",
          }}
        >
          <div
            className="font-[family-name:var(--font-display)] text-xl font-black tracking-tight"
            style={{ color: "hsl(var(--destructive))" }}
          >
            {flow.message}
          </div>
          {flow.details && (
            <details className="mt-2">
              <summary className="text-xs text-foreground/55 cursor-pointer">Details</summary>
              <pre className="text-xs whitespace-pre-wrap text-foreground/65 mt-1">{flow.details}</pre>
            </details>
          )}
        </div>
        <button
          onClick={() => setFlow({ type: "wizard", step: 0, isUpdate: false })}
          className="btn-pill-lg"
          style={{
            background: "transparent",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--foreground) / 0.25)",
            alignSelf: "start",
          }}
        >
          Start over
        </button>
      </div>
    );
  }

  // Success state — pizzaiolo-35410 finale ceremony.
  // FinaleScene paints over the wizard chrome and plays the 6-phase reveal.
  // The "Continue to dashboard" CTA inside the scene routes when the user
  // is ready; we don't auto-redirect because the animation IS the reward.
  if (flow.type === "success") {
    return (
      <FinaleScene
        mafiaName={data.mafiaName || data.discordNick || "Made"}
        memberId={data.memberId}
        dashboardHref={flow.redirectTo}
      />
    );
  }

  // Wizard
  if (flow.type === "wizard") {
    const stepTitle = getStepTitle(flow.step, flow.isUpdate);

    // Welcome step (step 0) renders without the card chrome so the hero can
    // breathe like the marketing site.
    if (flow.step === 0) {
      return (
        <WelcomeStep
          onJoin={() => goToStep(1)}
          onLogin={() => {
            const loginUrl = `/api/discord/login?state=${encodeURIComponent(data.sessionId)}`;
            (window.top || window).location.href = loginUrl;
          }}
          onMagicLogin={() => setFlow({ type: "magic_login" })}
        />
      );
    }

    // Progress (steps 1..6 = 6 visible steps)
    const totalSteps = 6;
    const currentIndex = Math.max(1, flow.step);
    const progress = Math.min(100, Math.round((currentIndex / totalSteps) * 100));

    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[28px] border p-5 md:p-8 grid gap-7"
        style={{
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-lifted)",
        }}
      >
        {/* Progress — editorial overline + thick tomato bar */}
        <div className="relative grid gap-2.5">
          <div className="flex items-center justify-between">
            <p className="overline text-tomato/85">
              § Step {currentIndex} · of {totalSteps}
            </p>
            <p className="ui text-[11px] uppercase tracking-[0.22em] text-foreground/55">
              {progress}%
            </p>
          </div>
          <div
            className="relative h-2 w-full overflow-hidden rounded-full"
            style={{ background: "hsl(var(--rule-warm) / 0.35)" }}
          >
            <div
              className="h-full transition-all duration-500 ease-out"
              style={{
                width: `${progress}%`,
                background: "hsl(var(--tomato))",
                boxShadow: "0 0 14px hsl(var(--tomato) / 0.4)",
              }}
            />
          </div>
        </div>

        {/* Summary bar — hand-stamped dossier strip */}
        {(data.mafiaName || data.city || data.turtles.length > 0) && (
          <div
            className="relative grid grid-cols-1 gap-3 pb-4 sm:grid-cols-3"
            style={{
              borderBottom: "1px dashed hsl(var(--rule-warm) / 0.7)",
            }}
          >
            {data.mafiaName && (
              <SummaryStamp label="Name" value={data.mafiaName} />
            )}
            {data.city && <SummaryStamp label="City" value={data.city} />}
            {data.turtles.length > 0 && (
              <SummaryStamp label="Turtles" value={data.turtles.join(", ")} />
            )}
          </div>
        )}

        {/* Header — editorial overline + display headline + tiny reset link.
            sicilian-99996: when stepTitle is empty (NameStep, which owns its
            own large hero), drop the chapter heading entirely but keep the
            reset link in the chrome. */}
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          {stepTitle ? (
            <div className="flex-1 min-w-0">
              <p className="overline text-tomato">§ Chapter {currentIndex}</p>
              <h2
                className="font-[family-name:var(--font-display)] mt-2 font-black tracking-[-0.015em] text-foreground"
                style={{
                  fontSize: "clamp(1.6rem, 4vw, 2.8rem)",
                  lineHeight: 0.95,
                  textWrap: "balance",
                }}
              >
                {stepTitle}
              </h2>
            </div>
          ) : (
            <div className="flex-1 min-w-0" />
          )}
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(LS_KEY);
              localStorage.removeItem(PENDING_CLAIM_KEY);
              setData({ ...initialWizardData, sessionId: uuidLike() });
              setFlow({ type: "wizard", step: 1, isUpdate: false });
            }}
            className="ui inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.28em] text-foreground/45 transition-colors hover:text-tomato min-h-11"
            style={{ background: "none", border: "none" }}
          >
            <span aria-hidden>×</span>
            Reset
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div
            className="relative paper-soft overflow-hidden rounded-[18px] border p-4"
            style={{
              background: "hsl(var(--destructive) / 0.08)",
              borderColor: "hsl(var(--destructive) / 0.3)",
            }}
          >
            <p
              className="font-[family-name:var(--font-display)] text-lg font-black tracking-tight"
              style={{ color: "hsl(var(--destructive))" }}
            >
              {error}
            </p>
            {errorDetails && (
              <details className="mt-2">
                <summary className="text-xs text-foreground/55 cursor-pointer">
                  Details
                </summary>
                <pre className="text-xs whitespace-pre-wrap text-foreground/65 mt-1">
                  {errorDetails}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Step content */}
        {flow.step === 1 && (
          <NameStep
            topping={data.topping}
            mafiaMovieTitle={data.mafiaMovieTitle}
            style={data.style}
            suggestions={data.suggestions}
            resolvedMovieTitle={data.resolvedMovieTitle}
            releaseDate={data.releaseDate}
            mediaType={data.mediaType}
            seenNames={data.seenNames}
            mafiaName={data.mafiaName}
            isUpdate={flow.isUpdate}
            existingName={data.existingData?.mafiaName}
            discordNick={data.discordNick}
            submitting={generatingNames}
            onChange={(updates) => setData((p) => ({ ...p, ...updates }))}
            onGenerate={generateNames}
            onPickName={(name) => {
              setData((p) => ({ ...p, mafiaName: name, seenNames: mergeSeen(p.seenNames, [name]) }));
              goToStep(2);
            }}
            onKeepExisting={() => {
              const nameToKeep = flow.isUpdate ? data.existingData?.mafiaName : data.discordNick;
              setData((p) => ({ ...p, mafiaName: nameToKeep }));
              goToStep(2);
            }}
            onBack={() => {
              if (flow.isUpdate && data.memberId) {
                router.push(`/dashboard/${data.memberId}`);
              } else {
                goToStep(0);
              }
            }}
          />
        )}

        {flow.step === 2 && (
          <CityStep
            city={data.city}
            onChange={(city) => setData((p) => ({ ...p, city }))}
            onRegionResolved={(region, countryCode) =>
              setData((p) => ({
                ...p,
                cityRegion: region ?? undefined,
                cityCountryCode: countryCode ?? undefined,
              }))
            }
            onNext={() => goToStep(3)}
            onBack={() => goToStep(1)}
          />
        )}

        {flow.step === 3 && (
          <RolesStep
            turtles={data.turtles}
            onChange={(turtles) => setData((p) => ({ ...p, turtles }))}
            onNext={() => goToStep(flow.isUpdate ? 5 : 4)}
            onBack={() => goToStep(2)}
            isUpdate={flow.isUpdate}
          />
        )}

        {flow.step === 4 && (
          <MemberIdStep
            value={data.memberId || ""}
            onChange={(memberId) => setData((p) => ({ ...p, memberId }))}
            onNext={() => goToStep(5)}
            onBack={() => goToStep(3)}
          />
        )}

        {flow.step === 5 && (
          <CrewsStep
            crews={data.crews}
            turtles={data.turtles}
            crewOptions={crewOptions}
            crewsLoading={crewsLoading}
            onChange={(crews) => setData((p) => ({ ...p, crews }))}
            onSubmit={flow.isUpdate ? () => goToStep(6) : claimRoles}
            onBack={() => goToStep(flow.isUpdate ? 3 : 4)}
            isUpdate={flow.isUpdate}
            submitting={false}
          />
        )}

        {flow.step === 6 && (
          <ReviewStep
            mafiaName={data.mafiaName}
            city={data.city}
            turtles={data.turtles}
            crews={data.crews}
            existingData={data.existingData}
            crewOptions={crewOptions}
            submitting={isSubmitting}
            onSubmit={submitAll}
            onCancel={() => router.push(`/dashboard/${data.memberId || data.discordId || data.sessionId}`)}
          />
        )}
      </div>
    );
  }

  return null;
}

// ============================================================================
// Helpers
// ============================================================================

function getStepTitle(step: number, isUpdate: boolean): string {
  switch (step) {
    case 0:
      return "";
    case 1:
      // sicilian-99996: NameStep has its own large headline ("Claim your
      // mafia name."), so the wizard chrome no longer adds a redundant
      // section title above it. Other steps still render theirs.
      return "";
    case 2:
      return "What city are you in?";
    case 3:
      return "What roles do you play?";
    case 4:
      return "Pick your Member ID";
    case 5:
      return "Join some crews";
    case 6:
      return "Review Changes";
    default:
      return "";
  }
}

function parseList(val: any): string[] {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === "string")
    return val
      .split(/[,|]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

function mergeSeen(prevSeen: string[], newNames: string[]): string[] {
  const cleaned = newNames.map((x) => String(x ?? "").trim()).filter(Boolean);
  return Array.from(new Set([...(prevSeen ?? []), ...cleaned]));
}

// ============================================================================
// SummaryStamp — hand-stamped dossier strip cell for the wizard summary bar
// ============================================================================

function SummaryStamp({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="ui text-[9px] uppercase tracking-[0.3em] text-foreground/45">
        {label}
      </p>
      <p
        className="font-[family-name:var(--font-display)] mt-0.5 truncate font-black tracking-tight text-foreground"
        style={{ fontSize: "14px", lineHeight: 1.2 }}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}
