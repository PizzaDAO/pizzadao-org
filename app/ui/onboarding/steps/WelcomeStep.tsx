// app/ui/onboarding/steps/WelcomeStep.tsx
"use client";

import { btn } from "../styles";

type Props = {
  onJoin: () => void;
  onLogin: () => void;
};

export function WelcomeStep({ onJoin, onLogin }: Props) {
  return (
    <div style={{ display: "grid", gap: 20, textAlign: "center", padding: "20px 0" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
        <img
          src="https://i.imgur.com/lRq8iK7.png"
          alt="PizzaDAO"
          style={{ height: 60, width: "auto", maxWidth: "100%", objectFit: "contain" }}
        />
      </div>
      <div style={{ fontSize: 18, lineHeight: 1.5, opacity: 0.9 }}>
        Join the world's largest pizza co-op.
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <button
          onClick={onJoin}
          style={{ ...btn("primary"), padding: "16px 20px", fontSize: 18 }}
        >
          Join PizzaDAO
        </button>
        <button
          onClick={onLogin}
          style={{ ...btn("secondary"), padding: "16px 20px", fontSize: 18 }}
        >
          Already in our Discord? Login
        </button>
      </div>
    </div>
  );
}
