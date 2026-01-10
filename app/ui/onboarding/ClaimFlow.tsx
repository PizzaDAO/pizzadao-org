// app/ui/onboarding/ClaimFlow.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { card, btn } from "./styles";

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
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fafafa",
        padding: 20,
      }}
    >
      <div style={card()}>
        {step === "ask" && (
          <>
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>Welcome, Pizza Chef!</h2>
            <p style={{ marginBottom: 24, lineHeight: 1.5 }}>
              We authenticated your Discord, but we couldn't automatically find your Profile.
              <br />
              <br />
              <strong>Do you already have a PizzaDAO Member ID?</strong>
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={() => setStep("input-id")} style={btn("primary")}>
                Yes, I have an ID
              </button>
              <button onClick={onStartRegistration} style={btn("secondary")}>
                No, I'm new
              </button>
            </div>
          </>
        )}

        {step === "input-id" && (
          <>
            <h2 style={{ fontSize: 20, marginBottom: 16 }}>Find Your Profile</h2>
            <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.8 }}>
              Please enter your numeric Member ID.
            </p>
            <input
              type="text"
              placeholder="e.g. 60"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: "1px solid #ccc",
                fontSize: 16,
                width: "100%",
                marginBottom: 16,
              }}
            />
            {error && (
              <div style={{ color: "red", fontSize: 14, marginBottom: 16 }}>{error}</div>
            )}
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={checkMemberId} style={btn("primary")}>
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
            <h2 style={{ fontSize: 20, marginBottom: 16 }}>Claim Profile: {foundName}</h2>
            <p style={{ marginBottom: 16, fontSize: 14, opacity: 0.8 }}>
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
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: "1px solid #ccc",
                  fontSize: 16,
                  width: "100%",
                  marginBottom: 16,
                }}
              />
              {error && (
                <div style={{ color: "red", fontSize: 14, marginBottom: 16 }}>{error}</div>
              )}
              <div style={{ display: "flex", gap: 12 }}>
                <button type="submit" style={btn("primary")}>
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
          <div style={{ textAlign: "center", padding: 20 }}>Checking...</div>
        )}
      </div>
    </div>
  );
}
