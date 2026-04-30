"use client";

import { useState } from "react";
import { AddVouchButton } from "./AddVouchButton";
import Link from "next/link";

type PizzaDAOMember = {
  fid: number;
  fcUsername: string;
  fcDisplayName: string;
  fcPfp: string;
  memberId: string;
  memberName: string;
  memberCity: string;
  memberCrews: string;
};

type FarcasterProfile = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
};

type DiscoveryState = "idle" | "loading" | "results" | "error";

export function FarcasterDiscovery({
  currentMemberId,
}: {
  currentMemberId: string;
}) {
  const [state, setState] = useState<DiscoveryState>("idle");
  const [onPizzaDAO, setOnPizzaDAO] = useState<PizzaDAOMember[]>([]);
  const [notOnPizzaDAO, setNotOnPizzaDAO] = useState<FarcasterProfile[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const discover = async () => {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/farcaster/discover");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Discovery failed");
      }
      const data = await res.json();
      setOnPizzaDAO(data.onPizzaDAO || []);
      setNotOnPizzaDAO(data.notOnPizzaDAO || []);
      setState("results");
    } catch (err: unknown) {
      setError((err as Error).message);
      setState("error");
    }
  };

  const toggleSelect = (username: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(username)) next.delete(username);
      else next.add(username);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === notOnPizzaDAO.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(notOnPizzaDAO.map((u) => u.username)));
    }
  };

  const openInvite = () => {
    const usernames = Array.from(selected);
    const baseText = "Join the party on PizzaDAO! \uD83C\uDF55 pizzadao.org";

    // Batch into casts that fit within ~900 chars
    const batches: string[][] = [];
    let currentBatch: string[] = [];
    let currentLen = baseText.length;

    for (const u of usernames) {
      const tag = ` @${u}`;
      if (currentLen + tag.length > 900 && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [u];
        currentLen = baseText.length + tag.length;
      } else {
        currentBatch.push(u);
        currentLen += tag.length;
      }
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    for (const batch of batches) {
      const tags = batch.map((u) => `@${u}`).join(" ");
      const text = `${baseText} ${tags}`;
      window.open(
        `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}`,
        "_blank"
      );
    }
  };

  // Idle state: show discover button
  if (state === "idle") {
    return (
      <div style={{ textAlign: "center" }}>
        <h3
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "1px",
            opacity: 0.5,
            margin: "0 0 12px",
            fontWeight: 700,
          }}
        >
          Farcaster Discovery
        </h3>
        <p
          style={{
            fontSize: 14,
            color: "var(--color-text-secondary)",
            margin: "0 0 16px",
          }}
        >
          Find which of your Farcaster followees are on PizzaDAO.
        </p>
        <button
          onClick={discover}
          style={{
            padding: "10px 20px",
            borderRadius: 10,
            border: "1px solid var(--color-btn-primary-border)",
            background: "var(--color-btn-primary-bg)",
            color: "var(--color-btn-primary-text)",
            fontSize: 14,
            fontWeight: 650,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Discover Farcaster Vouches
        </button>
      </div>
    );
  }

  // Loading state
  if (state === "loading") {
    return (
      <div style={{ textAlign: "center", padding: 20 }}>
        <div
          style={{
            width: 36,
            height: 36,
            border: "3px solid var(--color-spinner-track)",
            borderTop: "3px solid var(--color-spinner-active)",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 12px",
          }}
        />
        <p style={{ fontSize: 14, opacity: 0.7 }}>
          Scanning your Farcaster following list...
        </p>
        <style jsx>{`
          @keyframes spin {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  // Error state
  if (state === "error") {
    return (
      <div style={{ textAlign: "center" }}>
        <h3
          style={{
            fontSize: 12,
            textTransform: "uppercase",
            letterSpacing: "1px",
            opacity: 0.5,
            margin: "0 0 12px",
            fontWeight: 700,
          }}
        >
          Farcaster Discovery
        </h3>
        <div
          style={{
            padding: 12,
            background: "rgba(255,0,0,0.05)",
            borderRadius: 10,
            color: "var(--color-danger)",
            fontSize: 14,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
        <button
          onClick={discover}
          style={{
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid var(--color-btn-primary-border)",
            background: "var(--color-btn-primary-bg)",
            color: "var(--color-btn-primary-text)",
            fontSize: 13,
            fontWeight: 650,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Results state
  const hasResults = onPizzaDAO.length > 0 || notOnPizzaDAO.length > 0;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
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
          Farcaster Discovery
        </h3>
        <button
          onClick={discover}
          style={{
            padding: "4px 10px",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            background: "transparent",
            color: "var(--color-text-muted)",
            fontSize: 12,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Refresh
        </button>
      </div>

      {!hasResults && (
        <div
          style={{
            padding: 24,
            borderRadius: 10,
            border: "1px dashed var(--color-border)",
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 14,
              color: "var(--color-text-muted)",
              margin: 0,
            }}
          >
            None of your Farcaster followees are on PizzaDAO yet. Invite them!
          </p>
        </div>
      )}

      {/* On PizzaDAO section */}
      {onPizzaDAO.length > 0 && (
        <div style={{ marginBottom: notOnPizzaDAO.length > 0 ? 20 : 0 }}>
          <h4
            style={{
              fontSize: 14,
              fontWeight: 650,
              margin: "0 0 10px",
              color: "var(--color-text-primary)",
            }}
          >
            On PizzaDAO ({onPizzaDAO.length})
          </h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: 10,
            }}
          >
            {onPizzaDAO.map((m) => (
              <div
                key={m.memberId}
                style={{
                  padding: 14,
                  borderRadius: 12,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-surface)",
                  display: "grid",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <Link
                      href={`/profile/${m.memberId}`}
                      style={{
                        fontSize: 15,
                        fontWeight: 650,
                        color: "var(--color-text-primary)",
                        textDecoration: "none",
                      }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.textDecoration = "underline")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.textDecoration = "none")
                      }
                    >
                      {m.memberName}
                    </Link>
                    {m.memberCity && (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-secondary)",
                          margin: "2px 0 0",
                        }}
                      >
                        {m.memberCity}
                      </p>
                    )}
                    <p
                      style={{
                        fontSize: 12,
                        color: "#8A63D2",
                        margin: "2px 0 0",
                      }}
                    >
                      @{m.fcUsername}
                    </p>
                  </div>
                  <AddVouchButton
                    targetMemberId={m.memberId}
                    currentMemberId={currentMemberId}
                  />
                </div>
                {m.memberCrews && m.memberCrews !== "None" && (
                  <p
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.memberCrews}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Not on PizzaDAO section */}
      {notOnPizzaDAO.length > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <h4
              style={{
                fontSize: 14,
                fontWeight: 650,
                margin: 0,
                color: "var(--color-text-primary)",
              }}
            >
              Not on PizzaDAO ({notOnPizzaDAO.length})
            </h4>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={toggleAll}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {selected.size === notOnPizzaDAO.length
                  ? "Deselect All"
                  : "Select All"}
              </button>
              {selected.size > 0 && (
                <button
                  onClick={openInvite}
                  style={{
                    padding: "6px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--color-btn-primary-border)",
                    background: "var(--color-btn-primary-bg)",
                    color: "var(--color-btn-primary-text)",
                    fontSize: 13,
                    fontWeight: 650,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  Invite Selected ({selected.size})
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              overflow: "hidden",
            }}
          >
            {notOnPizzaDAO.map((u, i) => (
              <div
                key={u.fid}
                onClick={() => toggleSelect(u.username)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 12px",
                  cursor: "pointer",
                  background: selected.has(u.username)
                    ? "var(--color-btn-primary-bg)10"
                    : "transparent",
                  borderBottom:
                    i < notOnPizzaDAO.length - 1
                      ? "1px solid var(--color-border)"
                      : "none",
                  transition: "background 0.1s",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(u.username)}
                  onChange={() => toggleSelect(u.username)}
                  style={{ flexShrink: 0, cursor: "pointer" }}
                />
                {u.pfpUrl ? (
                  <img
                    src={u.pfpUrl}
                    alt=""
                    width={32}
                    height={32}
                    style={{
                      borderRadius: "50%",
                      flexShrink: 0,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: "50%",
                      background: "var(--color-border)",
                      flexShrink: 0,
                    }}
                  />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {u.displayName}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--color-text-muted)",
                    }}
                  >
                    @{u.username}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
