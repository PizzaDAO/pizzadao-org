"use client";

import React, { useState, useEffect } from "react";
import { BountyCard } from "./BountyCard";
import { PepIcon } from "../economy/PepIcon";
import { card, btn, input } from "../shared-styles";

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
            <div
              key={i}
              style={{
                height: 80,
                background: "hsl(var(--muted))",
                borderRadius: "var(--radius)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...card(),
          background: "hsl(var(--tomato) / 0.06)",
          borderColor: "hsl(var(--tomato) / 0.30)",
        }}
      >
        <p style={{ color: "hsl(var(--tomato))", margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20, marginTop: 20 }}>
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 22,
                fontWeight: 700,
                margin: 0,
                fontFamily:
                  "var(--font-display), var(--font-sans), system-ui, sans-serif",
                letterSpacing: "-0.01em",
                color: "hsl(var(--foreground))",
              }}
            >
              Bounties
            </h2>
            <p
              style={{
                margin: "2px 0 0",
                fontSize: 13,
                color: "hsl(var(--muted-foreground))",
              }}
            >
              Post work, claim work, get paid.
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            style={
              showForm
                ? { ...btn("secondary"), padding: "8px 14px", fontSize: 13 }
                : { ...btn("accent"), padding: "8px 14px", fontSize: 13 }
            }
          >
            {showForm ? "Cancel" : "+ Post Bounty"}
          </button>
        </div>

        {/* Create bounty form */}
        {showForm && (
          <div style={{ ...card(), marginBottom: 16 }}>
            <form onSubmit={handleCreateBounty} style={{ display: "grid", gap: 12 }}>
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 6,
                  }}
                >
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
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 6,
                  }}
                >
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
                <label
                  style={{
                    display: "block",
                    fontSize: 13,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 6,
                  }}
                >
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
                <div
                  style={{
                    padding: 8,
                    background: "hsl(var(--tomato) / 0.06)",
                    border: "1px solid hsl(var(--tomato) / 0.30)",
                    borderRadius: "var(--radius)",
                    color: "hsl(var(--tomato))",
                    fontSize: 13,
                  }}
                >
                  {formError}
                </div>
              )}
              <button
                type="submit"
                disabled={formLoading || !formDescription.trim() || !formReward}
                style={btn(
                  "accent",
                  formLoading || !formDescription.trim() || !formReward,
                )}
              >
                {formLoading ? "Creating..." : "Post Bounty"}
              </button>
            </form>
          </div>
        )}

        {bounties.length === 0 ? (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
              No bounties posted yet
            </p>
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
