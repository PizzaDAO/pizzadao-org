"use client";

import { useEffect, useState } from "react";

type SocialAccount = {
  platform: "TWITTER" | "FARCASTER";
  handle: string;
  verified: boolean;
};

type SocialAccountLinkerProps = {
  memberId: string;
};

export function SocialAccountLinker({ memberId }: SocialAccountLinkerProps) {
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

      setAccounts(accounts.filter((a) => a.platform !== platform));
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
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "1px",
            opacity: 0.5,
            margin: 0,
            fontWeight: 700,
          }}
        >
          Social Accounts
          {linkedCount > 0 && (
            <span style={{ marginLeft: 4, opacity: 0.8 }}>
              ({linkedCount})
            </span>
          )}
        </h3>
        <span
          style={{
            fontSize: 12,
            opacity: 0.4,
            transition: "transform 0.2s",
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
            <span
              key={a.platform}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 10px",
                borderRadius: 8,
                border: "1px solid var(--color-border)",
                fontSize: 13,
                color: "var(--color-text-secondary)",
              }}
            >
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
                background: "rgba(255,0,0,0.05)",
                borderRadius: 8,
                color: "var(--color-danger)",
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* X (Twitter) */}
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
                fontSize: 13,
                fontWeight: 600,
                minWidth: 70,
                color: "var(--color-text-secondary)",
              }}
            >
              X
            </span>
            <input
              type="text"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value)}
              placeholder="@handle"
              style={{
                flex: 1,
                minWidth: 150,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-input-border)",
                fontSize: 14,
                outline: "none",
                background: "var(--color-input-bg)",
                color: "var(--color-input-text)",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => saveAccount("TWITTER", twitterHandle)}
              disabled={
                saving === "TWITTER" || !twitterHandle.trim()
              }
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-btn-primary-border)",
                background: "var(--color-btn-primary-bg)",
                color: "var(--color-btn-primary-text)",
                fontSize: 13,
                fontWeight: 650,
                cursor:
                  saving === "TWITTER" || !twitterHandle.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  saving === "TWITTER" || !twitterHandle.trim() ? 0.5 : 1,
                fontFamily: "inherit",
              }}
            >
              {saving === "TWITTER" ? "..." : "Save"}
            </button>
            {hasTwitter && (
              <button
                onClick={() => unlinkAccount("TWITTER")}
                disabled={saving === "TWITTER"}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Unlink
              </button>
            )}
          </div>

          {/* Farcaster */}
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
                fontSize: 13,
                fontWeight: 600,
                minWidth: 70,
                color: "var(--color-text-secondary)",
              }}
            >
              Farcaster
            </span>
            <input
              type="text"
              value={farcasterHandle}
              onChange={(e) => setFarcasterHandle(e.target.value)}
              placeholder="username"
              style={{
                flex: 1,
                minWidth: 150,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-input-border)",
                fontSize: 14,
                outline: "none",
                background: "var(--color-input-bg)",
                color: "var(--color-input-text)",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={() => saveAccount("FARCASTER", farcasterHandle)}
              disabled={
                saving === "FARCASTER" || !farcasterHandle.trim()
              }
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-btn-primary-border)",
                background: "var(--color-btn-primary-bg)",
                color: "var(--color-btn-primary-text)",
                fontSize: 13,
                fontWeight: 650,
                cursor:
                  saving === "FARCASTER" || !farcasterHandle.trim()
                    ? "not-allowed"
                    : "pointer",
                opacity:
                  saving === "FARCASTER" || !farcasterHandle.trim()
                    ? 0.5
                    : 1,
                fontFamily: "inherit",
              }}
            >
              {saving === "FARCASTER" ? "..." : "Save"}
            </button>
            {hasFarcaster && (
              <button
                onClick={() => unlinkAccount("FARCASTER")}
                disabled={saving === "FARCASTER"}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Unlink
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
