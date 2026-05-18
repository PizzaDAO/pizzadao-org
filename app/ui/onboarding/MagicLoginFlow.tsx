"use client";

import { useState } from "react";
import { btn, input, alert } from "./styles";

const DISCORD_INVITE = process.env.NEXT_PUBLIC_DISCORD_INVITE || "https://discord.gg/pizzadao";

type State =
  | { step: "form" }
  | { step: "sending" }
  | { step: "sent"; username: string }
  | { step: "error"; code: string; message: string; username: string };

type Props = {
  onBack: () => void;
  loginError?: string | null;
};

export function MagicLoginFlow({ onBack, loginError }: Props) {
  const [username, setUsername] = useState("");
  const [state, setState] = useState<State>({ step: "form" });

  async function handleSubmit(retryUsername?: string) {
    const name = retryUsername || username.trim();
    if (name.length < 2) return;

    setState({ step: "sending" });

    try {
      const res = await fetch("/api/auth/magic-login/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });

      const data = await res.json();

      if (res.ok) {
        setState({ step: "sent", username: name });
        return;
      }

      setState({
        step: "error",
        code: data.status || "unknown",
        message: data.error || "Something went wrong",
        username: name,
      });
    } catch {
      setState({
        step: "error",
        code: "network",
        message: "Network error. Please check your connection and try again.",
        username: name,
      });
    }
  }

  // Login error from redirect (expired/used link)
  if (loginError) {
    const errorMessages: Record<string, string> = {
      invalid_token: "That login link is invalid.",
      link_expired: "That login link has expired. Request a new one.",
      link_already_used: "That login link has already been used. Request a new one.",
      missing_token: "No login token provided.",
    };

    return (
      <div className="grid gap-4 py-5">
        <div style={alert("error")}>
          {errorMessages[loginError] || "Login failed. Please try again."}
        </div>
        <button onClick={() => onBack()} style={btn("secondary")}>
          Back
        </button>
      </div>
    );
  }

  // Sent state — check your DMs
  if (state.step === "sent") {
    return (
      <div className="grid gap-4 text-center py-5">
        <div style={alert("success")}>
          Check your Discord DMs!
        </div>
        <div className="text-sm text-muted-foreground">
          We sent a login link to <strong className="text-foreground">{state.username}</strong> on Discord.
          The link expires in 10 minutes.
        </div>
        <div className="grid gap-2.5">
          <button
            onClick={() => handleSubmit(state.username)}
            style={btn("secondary")}
          >
            Resend
          </button>
          <button onClick={onBack} style={{ ...btn("secondary"), opacity: 0.7 }}>
            Back
          </button>
        </div>
      </div>
    );
  }

  // Error states
  if (state.step === "error") {
    // Not in server
    if (state.code === "not_found") {
      return (
        <div className="grid gap-4 py-5">
          <div style={alert("info")}>
            You need to be in the PizzaDAO Discord to use this.
          </div>
          <div className="text-sm text-muted-foreground">
            Our bot can only DM members of the server. Join first, then try again.
          </div>
          <a
            href={DISCORD_INVITE}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...btn("accent"),
              textAlign: "center",
              textDecoration: "none",
              display: "block",
            }}
          >
            Join PizzaDAO Discord
          </a>
          <button
            onClick={() => handleSubmit(state.username)}
            style={btn("secondary")}
          >
            I&apos;ve joined, try again
          </button>
          <button onClick={onBack} style={{ ...btn("secondary"), opacity: 0.7 }}>
            Back
          </button>
        </div>
      );
    }

    // DMs disabled
    if (state.code === "dm_failed") {
      return (
        <div className="grid gap-4 py-5">
          <div style={alert("error")}>
            Couldn&apos;t send you a DM
          </div>
          <div className="text-sm text-muted-foreground leading-relaxed">
            To receive the login link, enable DMs from server members:
          </div>
          <ol className="text-sm text-muted-foreground leading-loose m-0 pl-5">
            <li>Open Discord and go to the PizzaDAO server</li>
            <li>Click the server name at the top</li>
            <li>Privacy Settings → Enable &quot;Direct Messages&quot;</li>
          </ol>
          <button
            onClick={() => handleSubmit(state.username)}
            style={btn("accent")}
          >
            Try again
          </button>
          <button onClick={onBack} style={{ ...btn("secondary"), opacity: 0.7 }}>
            Back
          </button>
        </div>
      );
    }

    // Rate limited
    if (state.code === "rate_limited") {
      return (
        <div className="grid gap-4 py-5">
          <div style={alert("error")}>
            Too many requests. Please try again in a few minutes.
          </div>
          <button onClick={onBack} style={btn("secondary")}>
            Back
          </button>
        </div>
      );
    }

    // Generic error
    return (
      <div className="grid gap-4 py-5">
        <div style={alert("error")}>{state.message}</div>
        <button
          onClick={() => handleSubmit(state.username)}
          style={btn("accent")}
        >
          Try again
        </button>
        <button onClick={onBack} style={{ ...btn("secondary"), opacity: 0.7 }}>
          Back
        </button>
      </div>
    );
  }

  // Form / sending state
  return (
    <div className="grid gap-4 py-5">
      <div className="text-base leading-relaxed text-muted-foreground">
        Enter your Discord username and we&apos;ll DM you a login link.
      </div>
      <input
        type="text"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        placeholder="Discord username"
        autoFocus
        disabled={state.step === "sending"}
        style={input()}
      />
      <button
        onClick={() => handleSubmit()}
        disabled={state.step === "sending" || username.trim().length < 2}
        style={btn("accent", state.step === "sending" || username.trim().length < 2)}
      >
        {state.step === "sending" ? "Sending..." : "Send Login Link"}
      </button>
      <button onClick={onBack} style={{ ...btn("secondary"), opacity: 0.7 }}>
        Back
      </button>
    </div>
  );
}
