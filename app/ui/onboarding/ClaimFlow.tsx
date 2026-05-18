// app/ui/onboarding/ClaimFlow.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { card, btn, input as inputStyle, alert } from "./styles";

type ClaimStep = "ask" | "input-id" | "input-pass" | "processing";

type Props = {
  discordId: string;
  discordNick?: string;
  onStartRegistration: () => void;
};

export function ClaimFlow({ discordId, discordNick, onStartRegistration }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<ClaimStep>("ask");
  const [memberId, setMemberId] = useState("");
  const [foundName, setFoundName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkMemberId() {
    if (!memberId.trim()) {
      setError("Please enter an ID");
      return;
    }
    setStep("processing");
    setError(null);
    try {
      const res = await fetch(`/api/user-data/${memberId}`);
      if (res.ok) {
        const data = await res.json();
        const name = data["Name"] || data["Mafia Name"] || "Unknown";
        setFoundName(name);
        setStep("input-pass");
      } else {
        setError("ID not found in our records.");
        setStep("input-id");
      }
    } catch {
      setError("Failed to check ID.");
      setStep("input-id");
    }
  }

  async function submitClaim(password: string) {
    setStep("processing");
    setError(null);
    try {
      const res = await fetch("/api/claim-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          discordId,
          password,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        router.push(`/dashboard/${memberId}`);
      } else {
        setError(json.error || "Claim failed");
        setStep("input-pass");
      }
    } catch {
      setError("Network error");
      setStep("input-pass");
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-5">
      <div style={card()} className="w-full max-w-lg">
        {step === "ask" && (
          <>
            <h2
              className="font-[family-name:var(--font-display)] uppercase tracking-tight text-3xl sm:text-4xl font-extrabold text-foreground mb-2"
              style={{ textWrap: "balance" } as React.CSSProperties}
            >
              Welcome, Pizza Chef!
            </h2>
            <p className="mb-6 leading-relaxed text-muted-foreground">
              We authenticated your Discord, but we couldn&apos;t automatically find your Profile.
              <br />
              <br />
              <strong className="text-foreground">
                Do you already have a PizzaDAO Member ID?
              </strong>
            </p>
            <div className="flex gap-3">
              <button onClick={() => setStep("input-id")} style={btn("accent")}>
                Yes, I have an ID
              </button>
              <button onClick={onStartRegistration} style={btn("secondary")}>
                No, I&apos;m new
              </button>
            </div>
          </>
        )}

        {step === "input-id" && (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold text-foreground mb-3">
              Find Your Profile
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Please enter your numeric Member ID.
            </p>
            <input
              type="text"
              placeholder="e.g. 60"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              style={{ ...inputStyle(), marginBottom: 16 }}
            />
            {error && (
              <div style={alert("error")} className="mb-3">
                {error}
              </div>
            )}
            <div className="flex gap-3">
              <button onClick={checkMemberId} style={btn("accent")}>
                Search ID
              </button>
              <button
                onClick={() => {
                  setStep("ask");
                  setError(null);
                }}
                style={btn("secondary")}
              >
                Back
              </button>
            </div>
          </>
        )}

        {step === "input-pass" && (
          <>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold text-foreground mb-3">
              Claim Profile: {foundName}
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              To verify this is you, please enter the claim password.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                submitClaim(String(fd.get("password")));
              }}
            >
              <input
                name="password"
                type="password"
                placeholder="Password"
                autoFocus
                style={{ ...inputStyle(), marginBottom: 16 }}
              />
              {error && (
                <div style={alert("error")} className="mb-3">
                  {error}
                </div>
              )}
              <div className="flex gap-3">
                <button type="submit" style={btn("accent")}>
                  Claim Profile
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep("input-id");
                    setError(null);
                  }}
                  style={btn("secondary")}
                >
                  Back
                </button>
              </div>
            </form>
          </>
        )}

        {step === "processing" && (
          <div className="text-center py-5 text-muted-foreground">Checking...</div>
        )}
      </div>
    </div>
  );
}
