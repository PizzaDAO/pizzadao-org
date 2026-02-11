"use client";

import React, { useState, useEffect } from "react";
import { BountyCard } from "./BountyCard";
import { PepIcon, PepAmount } from "../economy/PepIcon";

type Bounty = {
  id: number;
  description: string;
  link: string | null;
  reward: number;
  createdBy: string;
  claimedBy: string | null;
  status: "OPEN" | "CLAIMED";
  createdAt: string;
  commentCount: number;
};

function card(): React.CSSProperties {
  return {
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 20,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  };
}

function input(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: '1px solid var(--color-border-strong)',
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
  };
}

function btn(disabled?: boolean): React.CSSProperties {
  return {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "#8b5cf6",
    color: 'var(--color-btn-primary-text)',
    fontSize: 14,
  };
}

type BountyBoardProps = {
  currentUserId: string;
  onBountyAction?: () => void;
};

export function BountyBoard({ currentUserId, onBountyAction }: BountyBoardProps) {
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formDescription, setFormDescription] = useState("");
  const [formLink, setFormLink] = useState("");
  const [formReward, setFormReward] = useState("");
  const [formLoading, setFormLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchBounties = async () => {
    try {
      const res = await fetch("/api/bounties");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch bounties");
      setBounties(data.bounties);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBounties();
  }, []);

  const handleCreateBounty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formDescription.trim() || !formReward) return;

    setFormLoading(true);
    setFormError(null);

    try {
      const res = await fetch("/api/bounties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formDescription.trim(),
          link: formLink.trim() || undefined,
          reward: Number(formReward),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Reset form and refresh
      setFormDescription("");
      setFormLink("");
      setFormReward("");
      setShowForm(false);
      fetchBounties();
      onBountyAction?.();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create bounty");
    } finally {
      setFormLoading(false);
    }
  };

  const handleAction = () => {
    fetchBounties();
    onBountyAction?.();
  };

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {[...Array(2)].map((_, i) => (
            <div key={i} style={{ height: 80, background: 'var(--color-surface-hover)', borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00", margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Bounties</h2>
          <button
            onClick={() => setShowForm(!showForm)}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              border: "none",
              fontWeight: 650,
              cursor: "pointer",
              background: showForm ? "var(--color-surface-hover)" : "#8b5cf6",
              color: showForm ? "var(--color-text)" : "var(--color-btn-primary-text)",
              fontSize: 12,
            }}
          >
            {showForm ? "Cancel" : "+ Post Bounty"}
          </button>
        </div>

        {/* Create bounty form */}
        {showForm && (
          <div style={{ ...card(), marginBottom: 16 }}>
            <form onSubmit={handleCreateBounty} style={{ display: "grid", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  What do you need done?
                </label>
                <textarea
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Describe the bounty..."
                  style={{ ...input(), minHeight: 80, resize: "vertical" }}
                  disabled={formLoading}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  Link (optional)
                </label>
                <input
                  type="url"
                  value={formLink}
                  onChange={(e) => setFormLink(e.target.value)}
                  placeholder="https://..."
                  style={input()}
                  disabled={formLoading}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                  Reward amount (will be escrowed)
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PepIcon size={20} />
                  <input
                    type="number"
                    value={formReward}
                    onChange={(e) => setFormReward(e.target.value)}
                    placeholder="Amount"
                    style={{ ...input(), flex: 1 }}
                    disabled={formLoading}
                    min="1"
                  />
                </div>
              </div>
              {formError && (
                <div style={{ padding: 8, background: "rgba(255,0,0,0.05)", borderRadius: 6, color: "#c00", fontSize: 13 }}>
                  {formError}
                </div>
              )}
              <button
                type="submit"
                disabled={formLoading || !formDescription.trim() || !formReward}
                style={btn(formLoading || !formDescription.trim() || !formReward)}
              >
                {formLoading ? "Creating..." : "Post Bounty"}
              </button>
            </form>
          </div>
        )}

        {bounties.length === 0 ? (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>No bounties posted yet</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {bounties.map((bounty) => (
              <BountyCard
                key={bounty.id}
                bounty={bounty}
                currentUserId={currentUserId}
                onAction={handleAction}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
