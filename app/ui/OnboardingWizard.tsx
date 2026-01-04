// app/ui/OnboardingWizard.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CREWS, TURTLES } from "./constants";

type NamegenResponse = {
  cached: boolean;
  topping: string;
  mafiaMovieTitle: string;
  resolvedMovieTitle: string;
  tmdbMovieId: string;
  releaseDate: string;
  style: "balanced" | "serious" | "goofy";
  suggestions: string[];
};

type CityPrediction = { description: string; place_id: string };

type WizardState = {
  step: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  sessionId: string;

  topping: string;
  mafiaMovieTitle: string;
  style: "balanced" | "serious" | "goofy";

  resolvedMovieTitle?: string;
  tmdbMovieId?: string;
  releaseDate?: string;

  suggestions?: string[];
  mafiaName?: string;

  city: string;

  // ✅ multi-select turtles (stores TURTLES[*].id)
  turtles: string[];

  crews: string[];

  seenNames: string[];

  // ✅ Discord linking (Phase 3)
  // ✅ Discord linking (Phase 3)
  discordId?: string;
  discordJoined?: boolean;
  discordNick?: string;

  memberId?: string;
  isUpdate?: boolean;
  lookupLoading?: boolean;
  submitting: boolean;
  error?: string;
  errorDetails?: string;
  success?: boolean;
  existingData?: {
    mafiaName?: string;
    city?: string;
    turtles: string[];
    crews: string[];
  };
};

type ClaimState = {
  active: boolean;
  step: "ask" | "input-id" | "input-pass" | "processing";
  memberId: string;
  error: string | null;
  foundName: string | null;
};

type CrewOption = {
  id: string;
  label: string; // Crew name
  turtles?: string[] | string; // from sheet: comma-delimited turtle names
  role?: string;
  channel?: string;
  event?: string;
  emoji?: string;
  sheet?: string;
  callTime?: string;
  callLength?: string;
  tasks?: { label: string; url?: string }[];
};

type CrewMappingsResponse = {
  crews: CrewOption[];
};

function uuidLike() {
  return `sess_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

// bump key to avoid old saved state shape conflicts (turtle -> turtles)
const LS_KEY = "mob_pizza_onboarding_v3";
const PENDING_CLAIM_KEY = "mob_pizza_onboarding_pending_claim_v1";

function norm(s: unknown) {
  return String(s ?? "")
    .trim()
    .replace(/\s+/g, " ");
}
function normKey(s: unknown) {
  return norm(s).toLowerCase();
}
function splitTurtlesCell(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(norm).filter(Boolean);
  const s = norm(v);
  if (!s) return [];
  return s
    .split(/[,/|]+/)
    .map((x) => norm(x))
    .filter(Boolean);
}

export default function OnboardingWizard() {
  const router = useRouter();
  const [s, setS] = useState<WizardState>(() => ({
    step: 0,
    sessionId: uuidLike(),
    topping: "",
    mafiaMovieTitle: "",
    style: "balanced",
    city: "",
    turtles: [],
    crews: [],
    seenNames: [],
    discordId: undefined,
    discordJoined: false,
    memberId: "",
    isUpdate: false,
    lookupLoading: false,
    submitting: false,
    errorDetails: undefined,
    existingData: undefined,
  }));


  // ✅ dynamic crews from Crew Mappings sheet (fallback to constants)
  const [crewOptions, setCrewOptions] = useState<CrewOption[]>(() =>
    (CREWS ?? []).map((c: any) => ({
      id: String(c.id),
      label: String(c.label ?? c.id),
      turtles: [],
    }))
  );

  const [claimState, setClaimState] = useState<ClaimState>({
    active: false,
    step: "ask",
    memberId: "",
    error: null,
    foundName: null,
  });
  const [crewsLoading, setCrewsLoading] = useState(false);

  // ✅ Pick up Discord callback params (/?discordId=...&discordJoined=1&sessionId=...)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const discordId = url.searchParams.get("discordId");
      const joined = url.searchParams.get("discordJoined");
      const returnedSessionId = url.searchParams.get("sessionId");
      const discordNick = url.searchParams.get("discordNick");

      if (discordId) {
        setS((p) => ({
          ...p,
          discordId,
          discordJoined: joined === "1" || joined === "true",
          discordNick: discordNick || undefined,
          sessionId: returnedSessionId || p.sessionId,
        }));

        // clean URL
        url.searchParams.delete("discordId");
        url.searchParams.delete("discordJoined");
        url.searchParams.delete("sessionId");
        url.searchParams.delete("discordNick");
        window.history.replaceState({}, "", url.toString());

        // ✅ Check if member exists and redirect to dashboard if so
        (async () => {
          try {
            setS(p => ({ ...p, lookupLoading: true }));
            // Pass nickname for fallback search
            const searchParam = discordNick ? `?searchName=${encodeURIComponent(discordNick)}` : "";
            const res = await fetch(`/api/member-lookup/${discordId}${searchParam}`);
            if (res.ok) {
              const data = await res.json();

              // ✅ Handle Name Match Auto-Claim FIRST - must write discordId to sheet
              if (data.found && data.method === "name_match" && data.memberId) {
                console.log("[AutoClaim] Found by nickname, claiming member:", data.memberId);
                try {
                  const claimRes = await fetch("/api/claim-member", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      memberId: data.memberId,
                      discordId: discordId,
                      password: "moltobenny"
                    }),
                  });
                  if (claimRes.ok) {
                    router.push(`/dashboard/${data.memberId}`);
                    return;
                  }
                  console.error("Auto-claim failed", await claimRes.text());
                } catch (err) {
                  console.error("Auto-claim error", err);
                }
                // If auto-claim fails, fall through to manual flow
              }

              // ✅ Handle regular Discord ID match (already linked)
              if (data.found && data.data) {
                const sheetData = data.data;
                const parseList = (val: any) => {
                  if (Array.isArray(val)) return val.map(String);
                  if (typeof val === "string") return val.split(/[,|]+/).map(s => s.trim()).filter(Boolean);
                  return [];
                };

                const isAutoLogin = !localStorage.getItem(PENDING_CLAIM_KEY);
                if (isAutoLogin) {
                  router.push(`/dashboard/${data.memberId || discordId}`);
                  return;
                }

                setS(p => ({
                  ...p,
                  isUpdate: true,
                  lookupLoading: false,
                  existingData: {
                    mafiaName: sheetData["Name"] || "",
                    city: sheetData["City"] || "",
                    turtles: parseList(sheetData["Turtles"]),
                    crews: parseList(sheetData["Crews"]),
                  },
                  memberId: data.memberId || sheetData["ID"] || p.memberId,
                  step: 6
                }));
                return;
              }
            }
            // Not found -> Trigger Claim Flow
            setS(p => ({ ...p, lookupLoading: false }));
            setClaimState(p => ({ ...p, active: true, step: "ask" }));
          } catch (e) {
            console.error("Lookup failed", e);
            setS(p => ({ ...p, lookupLoading: false }));
          }
        })();
        return;
      }

      // ✅ Edit Profile Flow
      const isEdit = url.searchParams.get("edit") === "1";
      const memberId = url.searchParams.get("memberId");

      if (isEdit && memberId) {
        // Clear query params
        url.searchParams.delete("edit");
        url.searchParams.delete("memberId");
        window.history.replaceState({}, "", url.toString());

        (async () => {
          try {
            setS(p => ({ ...p, lookupLoading: true }));
            const res = await fetch(`/api/user-data/${memberId}`);
            if (!res.ok) throw new Error("Failed to load user data");
            const data = await res.json();

            const parseList = (val: any) => {
              if (Array.isArray(val)) return val.map(String);
              if (typeof val === "string") return val.split(/[,|]+/).map(s => s.trim()).filter(Boolean);
              return [];
            };

            const existing = {
              mafiaName: data["Name"] || data["Mafia Name"] || "",
              city: data["City"] || "",
              turtles: parseList(data["Turtles"] || data["Roles"] || []),
              crews: parseList(data["Crews"] || []),
            };

            setS(p => ({
              ...p,
              memberId,
              isUpdate: true,
              lookupLoading: false,
              mafiaName: existing.mafiaName,
              city: existing.city,
              crews: existing.crews,
              turtles: existing.turtles,
              existingData: existing,
              step: 1 // Start at Step 1 for edit flow
            }));
          } catch (e) {
            console.error("Edit profile fetch failed", e);
            setS(p => ({ ...p, lookupLoading: false })); // Unblock if failed
          }
        })();
      }
    } catch { }
  }, [router]);

  // ✅ Fetch crew mappings
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setCrewsLoading(true);
        const res = await fetch("/api/crew-mappings", { cache: "no-store" });
        const data = (await res.json()) as CrewMappingsResponse | any;
        if (!res.ok) throw new Error(data?.error || "Failed to load crews");

        const crews: CrewOption[] = Array.isArray(data?.crews) ? data.crews : [];
        const cleaned = crews
          .map((c) => ({
            ...c,
            id: String((c as any)?.id ?? ""),
            label: norm((c as any)?.label ?? ""),
            turtles: splitTurtlesCell((c as any)?.turtles),
            emoji: norm((c as any)?.emoji) || undefined,
            role: norm((c as any)?.role) || undefined,
            channel: norm((c as any)?.channel) || undefined,
            event: norm((c as any)?.event) || undefined,
            sheet: norm((c as any)?.sheet) || undefined,
            callTime: norm((c as any)?.callTime) || undefined,
            callLength: norm((c as any)?.callLength) || undefined,
            tasks: Array.isArray((c as any)?.tasks) ? (c as any).tasks : [],
          }))
          .filter((c) => c.id && c.label);

        if (!alive) return;
        if (cleaned.length) setCrewOptions(cleaned);
      } catch {
        // keep fallback crews
      } finally {
        if (alive) setCrewsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Load draft from localStorage (with migration for old "turtle" string)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);

        const migratedTurtles: string[] = Array.isArray(parsed?.turtles)
          ? parsed.turtles
          : parsed?.turtle
            ? [String(parsed.turtle)]
            : [];

        setS((prev) => ({
          ...prev,
          ...parsed,
          // if a saved state is on step 5, bring them to step 4 (combined)
          step: parsed?.step === 5 ? 4 : (parsed?.step ?? prev.step),
          turtles: migratedTurtles,
          submitting: false,
          error: undefined,
          success: false,
          seenNames: Array.isArray(parsed?.seenNames) ? parsed.seenNames : [],
          discordId: typeof parsed?.discordId === "string" ? parsed.discordId : prev.discordId,
          discordJoined: typeof parsed?.discordJoined === "boolean" ? parsed.discordJoined : prev.discordJoined,
        }));
      }
    } catch { }
  }, []);

  // Persist draft
  useEffect(() => {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ ...s, submitting: false, error: undefined, success: false })
      );
    } catch { }
  }, [
    s.step,
    s.topping,
    s.mafiaMovieTitle,
    s.style,
    s.suggestions,
    s.mafiaName,
    s.city,
    s.turtles,
    s.crews,
    s.sessionId,
    s.seenNames,
    s.discordId,
    s.discordJoined,
    s.memberId,
  ]);

  const canGenerate = s.topping.trim().length > 0 && s.mafiaMovieTitle.trim().length > 0;

  function mergeSeen(prevSeen: string[], newNames: string[]) {
    const cleaned = newNames.map((x) => String(x ?? "").trim()).filter(Boolean);
    return Array.from(new Set([...(prevSeen ?? []), ...cleaned]));
  }

  async function generateNames(force = false) {
    setS((p) => ({ ...p, submitting: true, error: undefined, success: false }));

    try {
      const res = await fetch("/api/namegen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topping: s.topping,
          movieTitle: s.mafiaMovieTitle,
          style: s.style,
          force,
          exclude: force ? s.seenNames : [],
        }),
      });

      const data = (await res.json()) as NamegenResponse | any;
      if (!res.ok) throw new Error(data?.error || "Failed to generate names");

      setS((p) => ({
        ...p,
        submitting: false,
        error: undefined,
        suggestions: data.suggestions,
        resolvedMovieTitle: data.resolvedMovieTitle,
        tmdbMovieId: data.tmdbMovieId,
        releaseDate: data.releaseDate,
        seenNames: mergeSeen(p.seenNames, data.suggestions ?? []),
      }));
    } catch (e: any) {
      setS((p) => ({ ...p, submitting: false, error: e?.message || "Failed", success: false }));
    }
  }

  function pickName(name: string) {
    setS((p) => ({
      ...p,
      mafiaName: name,
      step: 2,
      error: undefined,
      seenNames: mergeSeen(p.seenNames, [name]),
    }));
  }

  function toggleCrew(id: string) {
    setS((p) => {
      const has = p.crews.includes(id);
      return { ...p, crews: has ? p.crews.filter((x) => x !== id) : [...p.crews, id] };
    });
  }

  // ✅ multi-select turtle toggle
  function toggleTurtle(t: string) {
    setS((p) => {
      const has = p.turtles.includes(t);
      return { ...p, turtles: has ? p.turtles.filter((x) => x !== t) : [...p.turtles, t] };
    });
  }

  async function submitAll() {
    setS((p) => ({ ...p, submitting: true, error: undefined, success: false }));

    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "web",
          sessionId: s.sessionId,

          mafiaName: s.mafiaName,
          topping: s.topping,

          mafiaMovieTitle: s.mafiaMovieTitle,
          resolvedMovieTitle: s.resolvedMovieTitle,
          tmdbMovieId: s.tmdbMovieId,
          releaseDate: s.releaseDate,

          city: s.city,

          // ✅ send both for compatibility
          turtle: s.turtles.join(", "),
          turtles: s.turtles,

          crews: s.crews,
          memberId: s.memberId,

          // ✅ Discord (include in payload so backend can embed in RawJSON)
          discordId: s.discordId || "",
          discordJoined: !!s.discordJoined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setS(p => ({ ...p, errorDetails: data?.details ? JSON.stringify(data.details, null, 2) : undefined }));
        throw new Error(data?.error || "Submit failed");
      }

      // clear the pending claim flag if it existed
      try {
        localStorage.removeItem(PENDING_CLAIM_KEY);
      } catch { }

      setS((p) => ({ ...p, submitting: false, success: true, error: undefined, errorDetails: undefined }));

      // delay slightly so they see the success state before redirect
      setTimeout(() => {
        router.push(`/dashboard/${s.memberId || s.discordId || s.sessionId}`);
      }, 1500);
    } catch (e: any) {
      setS((p) => ({
        ...p,
        submitting: false,
        error: e?.message || "Submit failed",
        success: false,
      }));
    }
  }

  function connectDiscord() {
    window.location.href = `/api/discord/login?state=${encodeURIComponent(s.sessionId)}`;
  }

  async function claimRoles() {
    // If we don't have a discordId yet, start OAuth and auto-finish when we come back.
    if (!s.discordId) {
      try {
        localStorage.setItem(PENDING_CLAIM_KEY, "1");
      } catch { }
      connectDiscord();
      return;
    }

    // Already linked, just save/claim now.
    submitAll();
  }

  // If user just returned from Discord and they intended to claim roles, auto-submit.
  useEffect(() => {
    if (!s.discordId) return;

    let pending = false;
    try {
      pending = localStorage.getItem(PENDING_CLAIM_KEY) === "1";
    } catch { }

    if (pending && !s.submitting && !s.success && !s.lookupLoading && !s.isUpdate) {
      submitAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.discordId, s.lookupLoading, s.isUpdate]);

  const stepTitle = useMemo(() => {
    switch (s.step) {
      case 0:
        return "Welcome to PizzaDAO";
      case 1:
        return "1) Pick your mafia name";
      case 2:
        return "2) Your city";
      case 3:
        return "3) What kind of team member are you?";
      case 4:
        return s.isUpdate ? "Review your Member ID" : "4) Pick your Member ID";
      case 5:
        return s.isUpdate ? "Update your Crews" : "5) Choose Crews:";
      case 6:
        return "6) Review Profile Updates";
    }
  }, [s.step]);

  // ✅ Map turtle ids -> labels so we can match sheet values like "Leonardo"
  const turtleIdToLabel = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of TURTLES as any[]) {
      if (!t) continue;
      const id = String(t.id ?? "").trim();
      const label = String(t.label ?? "").trim();
      if (id) m[id] = label || id;
    }
    return m;
  }, []);

  // ✅ RECOMMENDATION:
  // Crew is “Recommended” if ANY selected turtle matches ANY turtle in that crew row's "Turtles" column.
  // Now returns a Map<CrewID, MatchedTurtleID[]> so we can show WHY it's recommended.
  const recommendedCrewReasons = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!s.turtles.length) return map;

    // Build a quick lookup for selected turtles: id -> id (normalized)
    // We want to preserve the ORIGINAL selected ID (s.turtles elements) to display their images later.
    const selectedTurtles = s.turtles; // these are IDs like "Leonardo"

    for (const c of crewOptions) {
      const crewIdStr = String(c.id);
      const crewTurtlesNormalized = new Set(
        splitTurtlesCell((c as any)?.turtles).map(normKey)
      );

      const matches: string[] = [];

      for (const tId of selectedTurtles) {
        // We match if the turtle ID itself or its label matches one of the crew's turtle entries
        const tIdKey = normKey(tId);
        const tLabelKey = normKey(turtleIdToLabel[tId]);

        if (crewTurtlesNormalized.has(tIdKey) || crewTurtlesNormalized.has(tLabelKey)) {
          matches.push(tId);
        }
      }

      if (matches.length > 0) {
        map.set(crewIdStr, matches);
      }
    }
    return map;
  }, [s.turtles, crewOptions, turtleIdToLabel]);

  // --- Claim Flow Handlers ---

  async function checkMemberId() {
    if (!claimState.memberId.trim()) {
      setClaimState(p => ({ ...p, error: "Please enter an ID" }));
      return;
    }
    setClaimState(p => ({ ...p, step: "processing", error: null }));
    try {
      const res = await fetch(`/api/user-data/${claimState.memberId}`);
      if (res.ok) {
        const data = await res.json();
        const name = data["Name"] || data["Mafia Name"] || "Unknown";
        setClaimState(p => ({ ...p, step: "input-pass", foundName: name }));
      } else {
        setClaimState(p => ({ ...p, step: "input-id", error: "ID not found in our records." }));
      }
    } catch {
      setClaimState(p => ({ ...p, step: "input-id", error: "Failed to check ID." }));
    }
  }

  async function submitClaim(password: string) {
    setClaimState(p => ({ ...p, step: "processing", error: null }));
    try {
      const res = await fetch("/api/claim-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId: claimState.memberId,
          discordId: s.discordId,
          password
        }),
      });
      const json = await res.json();
      if (res.ok) {
        // Success! Redirect to dashboard
        router.push(`/dashboard/${claimState.memberId}`);
      } else {
        setClaimState(p => ({ ...p, step: "input-pass", error: json.error || "Claim failed" }));
      }
    } catch {
      setClaimState(p => ({ ...p, step: "input-pass", error: "Network error" }));
    }
  }

  // ---

  // --- Render Claim Flow ---
  if (claimState.active) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafafa",
        padding: 20,
      }}>
        <div style={card()}>
          {claimState.step === "ask" && (
            <>
              <h2 style={{ fontSize: 24, marginBottom: 16 }}>Welcome, Pizza Chef! 🍕</h2>
              <p style={{ marginBottom: 24, lineHeight: 1.5 }}>
                We authenticated your Discord, but we couldn't automatically find your Profile.
                <br /><br />
                <strong>Do you already have a PizzaDAO Member ID?</strong>
              </p>
              <div style={{ display: "flex", gap: 12 }}>
                <button
                  onClick={() => setClaimState(p => ({ ...p, step: "input-id" }))}
                  style={btn("primary")}
                >
                  Yes, I have an ID
                </button>
                <button
                  onClick={() => {
                    setClaimState(p => ({ ...p, active: false }));
                    if (s.discordNick) {
                      setS(p => ({ ...p, mafiaName: p.discordNick }));
                    }
                  }} // Proceed to new registration
                  style={btn("secondary")}
                >
                  No, I'm new
                </button>
              </div>
            </>
          )}

          {claimState.step === "input-id" && (
            <>
              <h2 style={{ fontSize: 20, marginBottom: 16 }}>Find Your Profile</h2>
              <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.8 }}>
                Please enter your numeric Member ID.
              </p>
              <input
                type="text"
                placeholder="e.g. 60"
                value={claimState.memberId}
                onChange={(e) => setClaimState(p => ({ ...p, memberId: e.target.value }))}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                  width: "100%",
                  marginBottom: 16
                }}
              />
              {claimState.error && <div style={{ color: "red", fontSize: 14, marginBottom: 16 }}>{claimState.error}</div>}
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={checkMemberId} style={btn("primary")}>
                  Search ID
                </button>
                <button
                  onClick={() => setClaimState(p => ({ ...p, step: "ask", error: null }))}
                  style={btn("secondary")}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {claimState.step === "input-pass" && (
            <>
              <h2 style={{ fontSize: 20, marginBottom: 16 }}>Claim Profile: {claimState.foundName}</h2>
              <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.8 }}>
                To verify this is you, please enter the claim password.
              </p>
              <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); submitClaim(String(fd.get("password"))); }}>
                <input
                  name="password"
                  type="password"
                  placeholder="Password"
                  autoFocus
                  style={{
                    padding: "10px 12px",
                    borderRadius: 8,
                    border: "1px solid #ccc",
                    fontSize: 16,
                    width: "100%",
                    marginBottom: 16
                  }}
                />
                {claimState.error && <div style={{ color: "red", fontSize: 14, marginBottom: 16 }}>{claimState.error}</div>}
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="submit" style={btn("primary")}>
                    Claim Profile
                  </button>
                  <button
                    type="button"
                    onClick={() => setClaimState(p => ({ ...p, step: "input-id", error: null }))}
                    style={btn("secondary")}
                  >
                    Back
                  </button>
                </div>
              </form>
            </>
          )}

          {claimState.step === "processing" && (
            <div style={{ textAlign: "center", padding: 20 }}>
              Checking...
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={card()}>
      {s.isUpdate && (
        <div style={{ ...alert("success"), marginBottom: 16, background: "rgba(0,0,0,0.05)", border: "2px solid black" }}>
          👋 <b>Existing Profile Found!</b> We've pre-filled your info. You can update anything below.
        </div>
      )}
      {/* Consolidated Selection Summary */}
      {(s.mafiaName || s.city || s.turtles.length > 0) && (
        <div style={{ opacity: 0.9, fontSize: 16, borderBottom: "1px solid rgba(0,0,0,0.06)", paddingBottom: 8, marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {s.mafiaName && <span>Name: <b>{s.mafiaName}</b></span>}
          {s.city && <span> • City: <b>{s.city}</b></span>}
          {s.turtles.length > 0 && <span> • Roles: <b>{s.turtles.join(", ")}</b></span>}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontWeight: 800 }}>{stepTitle}</h2>
          {s.step === 1 && s.isUpdate && s.existingData?.mafiaName && (
            <button
              onClick={() => pickName(s.existingData!.mafiaName!)}
              style={{ ...btn("primary"), padding: "4px 12px", fontSize: 13 }}
            >
              Keep <b>{s.existingData.mafiaName}</b>
            </button>
          )}
        </div>
        <button
          onClick={() => {
            try {
              localStorage.removeItem(LS_KEY);
              localStorage.removeItem(PENDING_CLAIM_KEY);
            } catch { }
            setS({
              step: 1,
              sessionId: uuidLike(),
              topping: "",
              mafiaMovieTitle: "",
              style: "balanced",
              city: "",
              turtles: [],
              crews: [],
              seenNames: [],
              discordId: undefined,
              discordJoined: false,
              submitting: false,
            });
          }}
          style={btn("secondary")}
        >
          Reset
        </button>
      </div>

      {s.error && (
        <div style={alert("error")}>
          <div style={{ fontWeight: 800 }}>{s.error}</div>
          {s.errorDetails && (
            <div style={{ marginTop: 8, fontSize: 13, opacity: 0.8, whiteSpace: "pre-wrap", fontFamily: "monospace", background: "rgba(0,0,0,0.05)", padding: 8, borderRadius: 8 }}>
              {s.errorDetails}
            </div>
          )}
        </div>
      )}

      {s.lookupLoading && (
        <div style={{ textAlign: "center", padding: "40px 0" }}>
          <div className="spinner" style={{
            width: 40,
            height: 40,
            border: "3px solid rgba(0,0,0,0.1)",
            borderTop: "3px solid #ff4d4d",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 20px"
          }} />
          <p style={{ fontSize: 18, opacity: 0.8 }}>Verifying member status...</p>
        </div>
      )}

      {!s.lookupLoading && s.step === 0 && (
        <div style={{ display: "grid", gap: 20, textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 18, lineHeight: 1.5, opacity: 0.9 }}>
            Join the world's largest pizza co-op. <br />
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <button
              onClick={() => setS((p) => ({ ...p, step: 1 }))}
              style={{ ...btn("primary"), padding: "16px 20px", fontSize: 18 }}
            >
              Join PizzaDAO
            </button>
            <button
              onClick={connectDiscord}
              style={{ ...btn("secondary"), padding: "16px 20px", fontSize: 18 }}
            >
              Already in our Discord? Login
            </button>
          </div>
        </div>
      )}
      {s.step === 1 && (
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Favorite pizza topping">
              <input
                value={s.topping}
                onChange={(e) => setS((p) => ({ ...p, topping: e.target.value }))}
                placeholder="Pepperoni"
                style={input()}
              />
            </Field>

            <Field label="Favorite mafia movie">
              <input
                value={s.mafiaMovieTitle}
                onChange={(e) => setS((p) => ({ ...p, mafiaMovieTitle: e.target.value }))}
                placeholder="Goodfellas"
                style={input()}
              />
            </Field>
          </div>

          <Field label="Vibe">
            <select
              value={s.style}
              onChange={(e) => setS((p) => ({ ...p, style: e.target.value as any }))}
              style={input()}
            >
              <option value="balanced">Balanced</option>
              <option value="serious">Serious</option>
              <option value="goofy">Goofy</option>
            </select>
          </Field>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={() => generateNames(false)}
              disabled={!canGenerate || s.submitting}
              style={btn("primary", !canGenerate || s.submitting)}
            >
              {s.submitting ? "Generating…" : "Generate 3 names"}
            </button>

            {s.suggestions && (
              <button
                onClick={() => generateNames(true)}
                disabled={!canGenerate || s.submitting}
                style={btn("secondary", !canGenerate || s.submitting)}
                title="Regenerate (won’t repeat anything you’ve already seen)"
              >
                {s.submitting ? "Regenerating…" : "Regenerate"}
              </button>
            )}

            {s.resolvedMovieTitle && (
              <span style={{ opacity: 0.75 }}>
                Matched: <b>{s.resolvedMovieTitle}</b> {s.releaseDate ? `(${s.releaseDate.slice(0, 4)})` : ""}
              </span>
            )}
          </div>

          {s.seenNames.length > 0 && (
            <div style={{ opacity: 0.65, fontSize: 13 }}>
              Seen this session: <b>{s.seenNames.length}</b>
            </div>
          )}

          {s.suggestions && (
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ fontWeight: 600 }}>Pick one:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
                {s.suggestions.map((name) => (
                  <button key={name} onClick={() => pickName(name)} style={choiceBtn()}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 0 }))} style={btn("secondary")}>
              Back
            </button>
          </div>
        </div>
      )}

      {s.step === 2 && (
        <div style={{ display: "grid", gap: 12 }}>


          <Field label="City">
            <CityAutocomplete value={s.city} onChange={(v) => setS((p) => ({ ...p, city: v }))} />
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 1 }))} style={btn("secondary")}>
              Back
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, step: 3 }))}
              disabled={s.city.trim().length === 0}
              style={btn("primary", s.city.trim().length === 0)}
            >
              Next
            </button>
          </div>
        </div>
      )}

      {s.step === 3 && (
        <div style={{ display: "grid", gap: 12 }}>


          <div style={{ opacity: 0.75, fontSize: 13 }}>Pick one or more:</div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {TURTLES.map((t) => {
              const selected = s.turtles.includes(t.id);
              return (
                <button key={t.id} onClick={() => toggleTurtle(t.id)} style={tile(selected)}>
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <img src={t.image} alt={t.label} style={{ width: 40, height: 40, objectFit: "contain" }} />

                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800 }}>{t.label}</div>
                      <div style={{ opacity: 0.7, fontSize: 13 }}>{t.role}</div>
                    </div>

                    {selected && <div style={{ fontSize: 12, opacity: 0.7 }}>Selected</div>}
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ opacity: 0.75 }}>
            Selected: <b>{s.turtles.length ? s.turtles.join(", ") : "(none)"}</b>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => setS((p) => ({ ...p, step: 2 }))} style={btn("secondary")}>
              Back
            </button>
            <button
              onClick={() => setS((p) => ({ ...p, step: p.isUpdate ? 5 : 4 }))}
              disabled={s.turtles.length === 0}
              style={btn("primary", s.turtles.length === 0)}
            >
              {s.isUpdate ? "Next" : "Next"}
            </button>
          </div>
        </div>
      )}

      {s.step === 4 && (
        <MemberIdPicker
          value={s.memberId || ""}
          onChange={(v) => setS((p) => ({ ...p, memberId: v }))}
          onNext={() => setS((p) => ({ ...p, step: 5 }))}
          onBack={() => setS((p) => ({ ...p, step: 3 }))}
        />
      )}

      {s.step === 5 && (
        <div style={{ display: "grid", gap: 12 }}>



          {crewsLoading && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
              <div style={{ opacity: 0.65, fontSize: 13 }}>Loading crews…</div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {crewOptions.map((c) => {
              const idStr = String(c.id);
              const checked = s.crews.includes(idStr);
              const recommended = recommendedCrewReasons.get(idStr);

              return (
                <label key={idStr} style={crewRow(checked)}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleCrew(idStr)}
                    style={{ transform: "scale(1.1)" }}
                  />

                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700 }}>
                        {c.emoji ? `${c.emoji} ` : ""}
                        {c.label}
                      </span>

                      {recommended && recommended.length > 0 && (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "2px 8px",
                            borderRadius: 999,
                            border: "1px solid rgba(0,0,0,0.18)",
                            background: "rgba(0,0,0,0.04)",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center" }}>
                            {recommended.map((tId, idx) => {
                              const img = TURTLES.find((t) => t.id === tId)?.image;
                              if (!img) return null;
                              return (
                                <img
                                  key={tId}
                                  src={img}
                                  alt={tId}
                                  style={{
                                    width: 16.8,
                                    height: 16.8,
                                    marginLeft: idx === 0 ? 0 : -4,
                                    objectFit: "contain",
                                    flexShrink: 0,
                                  }}
                                />
                              );
                            })}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 750 }}>Recommended</span>
                        </div>
                      )}
                    </div>

                    {(c.callTime || c.callLength) && (
                      <div style={{ opacity: 0.7, fontSize: 13 }}>
                        {c.callTime ? c.callTime : ""}
                        {c.callTime && c.callLength ? " • " : ""}
                        {c.callLength ? c.callLength : ""}
                      </div>
                    )}

                    {c.tasks && c.tasks.length > 0 && (
                      <div style={{ marginTop: 6, display: "grid", gap: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.5 }}>Top Tasks</div>
                        {c.tasks.map((t, idx) => (
                          <div key={idx} style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "baseline", gap: 4, minWidth: 0 }}>
                            <span style={{ flexShrink: 0 }}>•</span>
                            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.url ? (
                                <a
                                  href={t.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ color: "inherit", textDecoration: "underline", textUnderlineOffset: "2px" }}
                                >
                                  {t.label}
                                </a>
                              ) : (
                                <span>{t.label}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {c.sheet && (
                      <a
                        href={c.sheet}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          fontSize: 13,
                          fontWeight: 650,
                          opacity: 0.85,
                          textDecoration: "none",
                        }}
                        title={c.sheet}
                      >
                        Open crew sheet ↗
                      </a>
                    )}
                  </div>
                </label>
              );
            })}
          </div>


          {/* ✅ Combined final action */}
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setS((p) => ({ ...p, step: p.isUpdate ? 3 : 4 }))} style={btn("secondary")}>
                Back
              </button>
              <button onClick={s.isUpdate ? () => setS(p => ({ ...p, step: 6 })) : claimRoles} disabled={s.submitting} style={btn("primary", s.submitting)}>
                {s.submitting ? (s.isUpdate ? "Updating…" : "Claiming…") : (s.isUpdate ? "Update Profile" : "Claim Discord Roles")}
              </button>
            </div>


          </div>

          {s.success && (
            <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
              <div style={alert("success")}>
                Done ✅ You’re officially <b>{s.mafiaName}</b>.
              </div>

              <div style={{ lineHeight: 1.6 }}>
                <div>
                  <b>City:</b> {s.city}
                </div>
                <div>
                  <b>Turtles:</b> {s.turtles.length ? s.turtles.join(", ") : "(none)"}
                </div>
                <div>
                  <b>Crews:</b>{" "}
                  {s.crews.length
                    ? s.crews
                      .map((id) => {
                        const label = crewOptions.find((c) => c.id === id)?.label || id;
                        return label
                          .split(" ")
                          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                          .join(" ");
                      })
                      .join(", ")
                    : "(none)"}
                </div>
                <div>
                  <b>Movie:</b> {s.resolvedMovieTitle ?? s.mafiaMovieTitle}
                </div>
                {s.discordId && (
                  <div>
                    <b>Discord:</b> {s.discordJoined ? "Joined ✅" : "Linked ✅"} •{" "}
                    <span style={{ fontFamily: "monospace" }}>{s.discordId}</span>
                  </div>
                )}
              </div>


            </div>
          )}
        </div>
      )}

      {s.step === 6 && (
        <div style={{ display: "grid", gap: 16 }}>

          <div style={{ display: "grid", gap: 0, border: "1px solid rgba(0,0,0,0.1)", borderRadius: 10, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 10, background: "rgba(0,0,0,0.06)", padding: "12px 16px", fontWeight: 750, fontSize: 13, textTransform: "uppercase", letterSpacing: 0.6 }}>
              <div>Field</div>
              <div>New (Entered)</div>
              <div>Existing (In Sheet)</div>
            </div>

            {[
              { label: "Name", new: s.mafiaName, old: s.existingData?.mafiaName },
              { label: "City", new: s.city, old: s.existingData?.city },
              { label: "Roles", new: s.turtles.join(", "), old: (s.existingData?.turtles ?? []).join(", ") },
              {
                label: "Crews",
                new: (s.crews ?? []).map(id => crewOptions.find(c => c.id === id)?.label || id).join(", "),
                old: (s.existingData?.crews ?? []).join(", ")
              },
            ].map((row, i) => {
              const hasChange = String(row.new || "").trim().toLowerCase() !== String(row.old || "").trim().toLowerCase();
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "100px 1fr 1fr", gap: 10, padding: "12px 16px", background: i % 2 === 1 ? "rgba(0,0,0,0.01)" : "white", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "rgba(0,0,0,0.5)" }}>{row.label}</div>
                  <div style={{ fontWeight: hasChange ? 750 : 400, color: hasChange ? "#000" : "#777", fontSize: 14 }}>
                    {row.new || "—"}
                    {hasChange && <span style={{ marginLeft: 6, color: "#10b981", fontSize: 16 }} title="Modified">●</span>}
                  </div>
                  <div style={{ opacity: 0.6, fontSize: 14 }}>{row.old || "—"}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
            <button
              onClick={() => submitAll()}
              disabled={s.submitting}
              style={{ ...btn("primary", s.submitting), flex: 1 }}
            >
              {s.submitting ? "Updating Profile..." : "Yes, Update My Profile"}
            </button>
            <button
              onClick={() => router.push(`/dashboard/${s.memberId || s.discordId || s.sessionId}`)}
              disabled={s.submitting}
              style={{ ...btn("secondary"), flex: 1 }}
            >
              Don't Update
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MemberIdPicker({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [suggestions, setSuggestions] = useState<number[]>([]);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{ id: string; status: "available" | "taken" | "invalid" | null }>({
    id: "",
    status: null,
  });
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingSuggestions(true);
        const res = await fetch("/api/member-id");
        const data = await res.json();
        if (alive && data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } catch {
        // ignore
      } finally {
        if (alive) setLoadingSuggestions(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function checkAvailability(id: string) {
    if (!id.trim()) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/member-id?check=${id}`);
      const data = await res.json();
      if (data.error) {
        setAvailability({ id, status: "invalid" });
      } else {
        setAvailability({ id, status: data.available ? "available" : "taken" });
      }
    } catch {
      setAvailability({ id, status: "invalid" });
    } finally {
      setChecking(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {loadingSuggestions ? (
        <div style={{ opacity: 0.6 }}>Loading suggestions...</div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ opacity: 0.7, fontSize: 13 }}>Next available IDs:</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {suggestions.map((id) => (
              <button
                key={id}
                onClick={() => onChange(String(id))}
                style={{
                  ...btn(value === String(id) ? "primary" : "secondary"),
                  padding: "8px 16px",
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 16 }}>
        <Field label="Or check a specific number:">
          <div style={{ display: "flex", gap: 10 }}>
            <input
              type="number"
              value={availability.id}
              onChange={(e) => setAvailability({ id: e.target.value, status: null })}
              placeholder="Enter ID"
              style={input()}
            />
            <button
              onClick={() => checkAvailability(availability.id)}
              disabled={checking || !availability.id}
              style={btn("secondary", checking || !availability.id)}
            >
              {checking ? "Checking..." : "Check"}
            </button>
          </div>
        </Field>

        {availability.status && (
          <div
            style={{
              marginTop: 8,
              fontSize: 14,
              fontWeight: 600,
              color:
                availability.status === "available"
                  ? "green"
                  : availability.status === "taken"
                    ? "red"
                    : "orange",
            }}
          >
            {availability.status === "available" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>ID {availability.id} is available!</span>
                <button
                  onClick={() => onChange(availability.id)}
                  style={{
                    backgroundColor: "black",
                    color: "white",
                    border: "none",
                    padding: "4px 8px",
                    borderRadius: 4,
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Pick this
                </button>
              </div>
            )}
            {availability.status === "taken" && `ID ${availability.id} is already taken.`}
            {availability.status === "invalid" && "Invalid ID."}
          </div>
        )}
      </div>

      <div style={{ marginTop: 8 }}>
        Selected Member ID: <b>{value || "(none)"}</b>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button onClick={onBack} style={btn("secondary")}>
          Back
        </button>
        <button onClick={onNext} disabled={!value} style={btn("primary", !value)}>
          Next
        </button>
      </div>
    </div>
  );
}

function CityAutocomplete({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CityPrediction[]>([]);
  const [loading, setLoading] = useState(false);

  // ✅ If the user picked an item, we don't want the effect to re-open for that exact value.
  const suppressForValueRef = useRef<string>(value);

  useEffect(() => {
    const q = value.trim();

    // If this value was just selected from the dropdown, suppress fetching + reopening.
    if (q && q === suppressForValueRef.current) {
      setOpen(false);
      setItems([]);
      setLoading(false);
      return;
    }

    if (q.length < 2) {
      setItems([]);
      setOpen(false);
      return;
    }

    const t = window.setTimeout(async () => {
      try {
        setLoading(true);
        const res = await fetch("/api/city-autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: q }),
        });
        const data = await res.json();
        setItems(Array.isArray(data?.predictions) ? data.predictions : []);
        setOpen(true);
      } catch {
        // ignore UI errors; user can still type manually
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <div style={{ position: "relative" }}>
      <input
        value={value}
        onChange={(e) => {
          // user is typing again; allow future autocompletes
          suppressForValueRef.current = "";
          onChange(e.target.value);
        }}
        onFocus={() => value.trim().length >= 2 && items.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="New York, NY"
        style={input()}
        autoComplete="off"
      />

      {loading && (
        <div style={{ position: "absolute", right: 10, top: 10, opacity: 0.6, fontSize: 12 }}>…</div>
      )}

      {open && items.length > 0 && (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "100%",
            marginTop: 6,
            border: "1px solid rgba(0,0,0,0.18)",
            borderRadius: 12,
            background: "white",
            boxShadow: "0 10px 30px rgba(0,0,0,0.08)",
            overflow: "hidden",
            zIndex: 50,
          }}
        >
          {items.slice(0, 8).map((it) => (
            <button
              key={it.place_id}
              type="button"
              onMouseDown={(e) => e.preventDefault()} // keeps focus
              onClick={() => {
                suppressForValueRef.current = it.description; // ✅ prevent re-open on this selection
                onChange(it.description);
                setOpen(false);
                setItems([]); // ✅ nothing to show even if focused
              }}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                border: "none",
                background: "white",
                cursor: "pointer",
              }}
            >
              {it.description}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 650 }}>{label}</span>
      {children}
    </label>
  );
}

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
    display: "grid",
    gap: 14,
  };
}

function input(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
}

function btn(kind: "primary" | "secondary", disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
  if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
  return { ...base, background: "white" };
}

function choiceBtn(): React.CSSProperties {
  return {
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.18)",
    background: "white",
    textAlign: "left",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
  };
}

function tile(selected: boolean): React.CSSProperties {
  return {
    padding: 12,
    borderRadius: 12,
    border: selected ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: selected ? "rgba(0,0,0,0.04)" : "white",
    textAlign: "left",
    cursor: "pointer",
  };
}

function crewRow(checked: boolean): React.CSSProperties {
  return {
    display: "flex",
    gap: 10,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    border: checked ? "2px solid black" : "1px solid rgba(0,0,0,0.18)",
    background: checked ? "rgba(0,0,0,0.04)" : "white",
    cursor: "pointer",
  };
}

function alert(kind: "error" | "success" | "info"): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    background:
      kind === "error"
        ? "rgba(255,0,0,0.06)"
        : kind === "success"
          ? "rgba(0,200,0,0.08)"
          : "rgba(0,0,255,0.05)",
    fontWeight: 650,
  };
}
