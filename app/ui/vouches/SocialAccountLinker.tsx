"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { input as inputStyle } from "../shared-styles";

type SocialAccount = {
  platform: "TWITTER" | "FARCASTER";
  handle: string;
  verified: boolean;
};

type SocialAccountLinkerProps = {
  memberId: string;
  onAccountChange?: (accounts: { platform: string; handle: string }[]) => void;
  /**
   * Hide the manual (unverified) X row. Set only when the verified X card is
   * available, so a member can still set X some way. Stored values are never
   * touched, and the collapsed chips keep showing them.
   */
  hideManualX?: boolean;
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

const BUTTON_BASE: React.CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  fontSize: 13,
};

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

// Same card chrome as the X and Telegram cards next to it.
function cardChrome(): React.CSSProperties {
  return {
    padding: 14,
    borderRadius: 16,
    border: "1px solid hsl(var(--rule-warm) / 0.55)",
    background: "hsl(var(--secondary))",
    color: "hsl(var(--foreground))",
  };
}

export function SocialAccountLinker({
  memberId,
  onAccountChange,
  hideManualX = false,
}: SocialAccountLinkerProps) {
  const t = useTranslations("profileEdit.social");
  const tRoot = useTranslations("profileEdit");
  const baseId = useId();
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [twitterHandle, setTwitterHandle] = useState("");
  const [farcasterHandle, setFarcasterHandle] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [savingAction, setSavingAction] = useState<"connect" | "disconnect">(
    "connect"
  );
  const [error, setError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch(
        `/api/social-accounts?memberId=${encodeURIComponent(memberId)}`
      );
      if (!res.ok) {
        setLoadState("error");
        return;
      }
      const data = await res.json();
      const accts = data.accounts || [];
      setAccounts(accts);
      onAccountChange?.(
        accts.map((a: SocialAccount) => ({
          platform: a.platform,
          handle: a.handle,
        }))
      );

      const twitter = accts.find((a: SocialAccount) => a.platform === "TWITTER");
      const farcaster = accts.find(
        (a: SocialAccount) => a.platform === "FARCASTER"
      );
      if (twitter) setTwitterHandle(twitter.handle);
      if (farcaster) setFarcasterHandle(farcaster.handle);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  // Load accounts on mount
  useEffect(() => {
    load();
  }, [load]);

  const failureMessage = (status: number, fallback: string) =>
    status === 401 || status === 403 ? tRoot("authFailed") : fallback;

  const saveAccount = async (
    platform: "TWITTER" | "FARCASTER",
    handle: string
  ) => {
    setSaving(platform);
    setSavingAction("connect");
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
        // Server text is English-only; show a translated message by status.
        setError(failureMessage(res.status, t("saveFailed")));
        return;
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
    } catch {
      setError(tRoot("networkError"));
    } finally {
      setSaving(null);
    }
  };

  const unlinkAccount = async (platform: "TWITTER" | "FARCASTER") => {
    setSaving(platform);
    setSavingAction("disconnect");
    setError(null);

    try {
      const res = await fetch("/api/social-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ memberId, platform, unlink: true }),
      });

      if (!res.ok) {
        setError(failureMessage(res.status, t("disconnectFailed")));
        return;
      }

      const newAccounts = accounts.filter((a) => a.platform !== platform);
      setAccounts(newAccounts);
      onAccountChange?.(
        newAccounts.map((a) => ({ platform: a.platform, handle: a.handle }))
      );
      if (platform === "TWITTER") setTwitterHandle("");
      if (platform === "FARCASTER") setFarcasterHandle("");
    } catch {
      setError(tRoot("networkError"));
    } finally {
      setSaving(null);
    }
  };

  if (loadState === "loading") {
    // Fixed-height skeleton so the section doesn't jump once it loads.
    return (
      <div
        role="status"
        style={{
          ...cardChrome(),
          gridColumn: "1 / -1",
          height: 74,
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          fontSize: 13,
          color: "hsl(var(--foreground) / 0.65)",
        }}
      >
        {t("loading")}
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div
        style={{
          ...cardChrome(),
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span
          role="alert"
          style={{ fontSize: 13, color: "hsl(var(--tomato-readable))" }}
        >
          {t("loadFailed")}
        </span>
        <button
          type="button"
          onClick={load}
          className="btn-pill btn-pill-secondary"
          style={BUTTON_BASE}
        >
          {tRoot("retry")}
        </button>
      </div>
    );
  }

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
  ) => {
    const inputId = `${baseId}-${platform}`;
    const busy = saving === platform;
    const connecting = busy && savingAction === "connect";
    const disconnecting = busy && savingAction === "disconnect";
    return (
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <label
          htmlFor={inputId}
          style={{
            fontFamily: displayFont,
            fontSize: 13,
            fontWeight: 600,
            minWidth: 80,
            color: "hsl(var(--foreground))",
          }}
        >
          {label}
        </label>
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          maxLength={100}
          style={{ ...inputStyle(), flex: 1, minWidth: 150 }}
        />
        <button
          type="button"
          onClick={() => saveAccount(platform, value)}
          disabled={busy || !value.trim()}
          className="btn-pill btn-pill-primary"
          style={BUTTON_BASE}
        >
          {connecting ? t("saving") : t("connect")}
        </button>
        {hasAccount && (
          <button
            type="button"
            onClick={() => unlinkAccount(platform)}
            disabled={busy}
            className="btn-pill btn-pill-secondary"
            style={BUTTON_BASE}
          >
            {disconnecting ? t("disconnecting") : t("disconnect")}
          </button>
        )}
      </div>
    );
  };

  const panelId = `${baseId}-panel`;

  return (
    <div style={{ ...cardChrome(), gridColumn: "1 / -1" }}>
      <h3 style={{ margin: 0 }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls={panelId}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            width: "100%",
            minHeight: 44,
            marginBottom: expanded ? 12 : 0,
            padding: 0,
            background: "none",
            border: "none",
            color: "inherit",
            font: "inherit",
            textAlign: "left",
            cursor: "pointer",
          }}
        >
          <span
            style={{
              fontFamily: displayFont,
              fontSize: 16,
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {t("title")}
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
                }}
              >
                {linkedCount}
              </span>
            )}
          </span>
          <span
            aria-hidden
            style={{
              fontSize: 12,
              color: "hsl(var(--foreground) / 0.65)",
              transition: "transform 200ms ease",
              transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </button>
      </h3>

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
              {a.platform === "TWITTER" ? t("xLabel") : t("farcasterLabel")}: @
              {a.handle}
            </span>
          ))}
        </div>
      )}

      <div
        id={panelId}
        hidden={!expanded}
        style={{ display: expanded ? "grid" : "none", gap: 12 }}
      >
        {error && (
          <div
            role="alert"
            style={{
              padding: 10,
              background: "hsl(var(--tomato) / 0.08)",
              border: "1px solid hsl(var(--tomato) / 0.30)",
              borderRadius: "var(--radius)",
              color: "hsl(var(--tomato-readable))",
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {(!hideManualX || hasTwitter) &&
          renderRow(
            "TWITTER",
            t("xManualLabel"),
            t("xPlaceholder"),
            twitterHandle,
            setTwitterHandle,
            hasTwitter
          )}
        {renderRow(
          "FARCASTER",
          t("farcasterLabel"),
          t("farcasterPlaceholder"),
          farcasterHandle,
          setFarcasterHandle,
          hasFarcaster
        )}
      </div>
    </div>
  );
}
