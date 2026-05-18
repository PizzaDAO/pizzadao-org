// app/ui/onboarding/steps/WelcomeStep.tsx
"use client";

import { btn } from "../styles";

type Props = {
  onJoin: () => void;
  onLogin: () => void;
  onMagicLogin: () => void;
};

export function WelcomeStep({ onJoin, onLogin, onMagicLogin }: Props) {
  return (
    <div className="grid gap-8 text-center py-4 sm:py-6">
      <div className="flex justify-center">
        <img
          src="https://i.imgur.com/lRq8iK7.png"
          alt="PizzaDAO"
          className="h-16 w-auto max-w-full object-contain"
        />
      </div>

      <h1
        className="font-[family-name:var(--font-display)] uppercase tracking-tight text-4xl sm:text-5xl lg:text-6xl font-extrabold text-foreground"
        style={{ textWrap: "balance" } as React.CSSProperties}
      >
        Join the pizza mafia
      </h1>

      <p
        className="text-base sm:text-lg text-muted-foreground mx-auto max-w-md leading-relaxed"
        style={{ textWrap: "pretty" } as React.CSSProperties}
      >
        Mafia names, slice meet-ups, and a global crew of pizza chefs. Welcome to PizzaDAO.
      </p>

      <div className="grid gap-3 mt-2">
        <button
          onClick={onJoin}
          style={{ ...btn("accent"), padding: "16px 20px", fontSize: 18 }}
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

      <button
        onClick={onMagicLogin}
        className="text-muted-foreground/80 hover:text-foreground text-sm underline underline-offset-4 cursor-pointer transition-colors mx-auto"
        style={{ background: "none", border: "none", padding: 4 }}
      >
        Can&apos;t log in? Try Discord DM
      </button>
    </div>
  );
}
