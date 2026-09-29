"use client";

import { useEffect, useState } from "react";
import { btn, input as inputStyle } from "../shared-styles";

type SocialAccount = {
  platform: "TWITTER" | "FARCASTER";
  handle: string;
  verified: boolean;
};

type SocialAccountLinkerProps = {
  memberId: string;
  onAccountChange?: (accounts: { platform: string; handle: string }[]) => void;
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

function chip(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid hsl(var(--rule) / 0.22)",
    background: "hsl(var(--secondary))",
    fontSize: 13,
    color: "hsl(var(--foreground))",
    fontFamily: "var(--font-sans), system-ui, sans-serif",
  };
}

export function SocialAccountLinker({
  memberId,
  onAccountChange,
}: SocialAccountLinkerProps) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [twitterHandle, setTwitterHandle] = useState("");
  const [farcasterHandle, setFarcasterHandle] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Load accounts on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(
          `/api/social-accounts?memberId=${encodeURIComponent(memberId)}`
        );
        if (res.ok) {
          const data = await res.json();
          const accts = data.accounts || [];
          setAccounts(accts);
          onAccountChange?.(
            accts.map((a: SocialAccount) => ({
              platform: a.platform,
              handle: a.handle,
            }))
          );

          const twitter = accts.find(
            (a: SocialAccount) => a.platform === "TWITTER"
          );
          const farcaster = accts.find(
            (a: SocialAccount) => a.platform === "FARCASTER"
          );
          if (twitter) setTwitterHandle(twitter.handle);
          if (farcaster) setFarcasterHandle(farcaster.handle);
        }
      } catch {
        // Silently fail
      } finally {
        setLoaded(true);
      }
    })();
  }, [memberId]);

  const saveAccount = async (
    platform: "TWITTER" | "FARCASTER",
    handle: string
  ) => {
    setSaving(platform);
    setError(null);

    try {
      const res = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          memberId,
          platform,
          handle: handle.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      // Update local state
      const newAccounts = accounts.filter((a) => a.platform !== platform);
      if (handle.trim()) {
        newAccounts.push({
          platform,
          handle: handle.trim().replace(/^@/, ""),
          verified: false,
        });
      }
      setAccounts(newAccounts);
      onAccountChange?.(
        newAccounts.map((a) => ({ platform: a.platform, handle: a.handle }))
      );
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const unlinkAccount = async (platform: "TWITTER" | "FARCASTER") => {
    setSaving(platform);
    setError(null);

    try {
      const res = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId, platform, unlink: true }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to unlink");
      }

      const newAccounts = accounts.filter((a) => a.platform !== platform);
      setAccounts(newAccounts);
      onAccountChange?.(
        newAccounts.map((a) => ({ platform: a.platform, handle: a.handle }))
      );
      if (platform === "TWITTER") setTwitterHandle("");
      if (platform === "FARCASTER") setFarcasterHandle("");
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to unlink");
    } finally {
      setSaving(null);
    }
  };

  if (!loaded) return null;

  const hasTwitter = accounts.some((a) => a.platform === "TWITTER");
  const hasFarcaster = accounts.some((a) => a.platform === "FARCASTER");
  const linkedCount = accounts.length;

  const renderRow = (
    platform: "TWITTER" | "FARCASTER",
    label: string,
    placeholder: string,
    value: string,
    setValue: (s: string) => void,
    hasAccount: boolean
  ) => (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <span
        style={{
          fontFamily: displayFont,
          fontSize: 13,
          fontWeight: 600,
          minWidth: 80,
          color: "hsl(var(--foreground))",
        }}
      >
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        style={{ ...inputStyle(), flex: 1, minWidth: 150 }}
      />
      <button
        onClick={() => saveAccount(platform, value)}
        disabled={saving === platform || !value.trim()}
        style={{
          ...btn("primary", saving === platform || !value.trim()),
          padding: "8px 14px",
          fontSize: 13,
        }}
      >
        {saving === platform ? "…" : hasAccount ? "Connect" : "Connect"}
      </button>
      {hasAccount && (
        <button
          onClick={() => unlinkAccount(platform)}
          disabled={saving === platform}
          style={{
            ...btn("secondary", saving === platform),
            padding: "8px 12px",
            fontSize: 12,
          }}
        >
          Disconnect
        </button>
      )}
    </div>
  );

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: expanded ? 12 : 0,
          cursor: "pointer",
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <h3
          style={{
            fontFamily: displayFont,
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "hsl(var(--muted-foreground))",
            margin: 0,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          Social Accounts
          {linkedCount > 0 && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                background: "hsl(var(--butter) / 0.35)",
                color: "hsl(var(--foreground))",
                border: "1px solid hsl(var(--butter) / 0.60)",
                padding: "1px 8px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "none",
                letterSpacing: 0,
              }}
            >
              {linkedCount}
            </span>
          )}
        </h3>
        <span
          style={{
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            transition: "transform 200ms ease",
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          ▼
        </span>
      </div>

      {!expanded && linkedCount > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 8,
            flexWrap: "wrap",
          }}
        >
          {accounts.map((a) => (
            <span key={a.platform} style={chip()}>
              {a.platform === "TWITTER" ? "X" : "Farcaster"}: @{a.handle}
            </span>
          ))}
        </div>
      )}

      {expanded && (
        <div style={{ display: "grid", gap: 12 }}>
          {error && (
            <div
              style={{
                padding: 10,
                background: "hsl(var(--tomato) / 0.08)",
                border: "1px solid hsl(var(--tomato) / 0.30)",
                borderRadius: "var(--radius)",
                color: "hsl(var(--tomato))",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {renderRow(
            "TWITTER",
            "X",
            "@handle",
            twitterHandle,
            setTwitterHandle,
            hasTwitter
          )}
          {renderRow(
            "FARCASTER",
            "Farcaster",
            "username",
            farcasterHandle,
            setFarcasterHandle,
            hasFarcaster
          )}
        </div>
      )}
    </div>
  );
}
