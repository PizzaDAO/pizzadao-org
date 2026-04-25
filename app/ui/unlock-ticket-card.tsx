"use client";

import { useEffect, useState } from "react";

interface UnlockTicketCardProps {
  memberId: string;
}

interface TicketRecord {
  eventName: string;
  networkId: number;
  lockAddress: string;
  tokenId: string;
}

interface ClaimData {
  claimed: boolean;
  claimId?: number;
  ticketCount?: number;
  pointsAwarded?: number;
  claimedAt?: string;
  tickets?: TicketRecord[];
}

interface VerifyData {
  walletAddress: string;
  tickets: TicketRecord[];
  ticketCount: number;
  pointsAvailable: number;
}

type CardState =
  | "loading"
  | "already-claimed"
  | "own-unclaimed"
  | "verifying"
  | "tickets-found"
  | "claiming"
  | "success"
  | "error"
  | "hidden";

const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BSC",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

export function UnlockTicketCard({ memberId }: UnlockTicketCardProps) {
  const [state, setState] = useState<CardState>("loading");
  const [claimData, setClaimData] = useState<ClaimData | null>(null);
  const [verifyData, setVerifyData] = useState<VerifyData | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        // Fetch existing claim status
        const claimRes = await fetch(`/api/unlock-tickets/${memberId}`);
        const claim: ClaimData = await claimRes.json();

        if (claim.claimed) {
          setClaimData(claim);
          setState("already-claimed");
          return;
        }

        // Check if viewer is the profile owner via /api/me + /api/member-lookup
        const meRes = await fetch("/api/me");
        if (!meRes.ok) {
          setState("hidden");
          return;
        }
        const me = await meRes.json();
        if (!me.discordId) {
          setState("hidden");
          return;
        }

        // Look up the viewer's memberId
        const lookupRes = await fetch(`/api/member-lookup/${me.discordId}`);
        if (!lookupRes.ok) {
          setState("hidden");
          return;
        }
        const lookup = await lookupRes.json();
        if (String(lookup.memberId) !== String(memberId)) {
          setState("hidden");
          return;
        }
        setIsOwner(true);
        setState("own-unclaimed");
      } catch {
        setState("hidden");
      }
    }
    if (memberId) init();
  }, [memberId]);

  async function verifyTickets() {
    setState("verifying");
    try {
      const res = await fetch("/api/unlock-tickets/verify");
      if (!res.ok) {
        if (res.status === 401) {
          setState("own-unclaimed");
          return;
        }
        throw new Error("Verification failed");
      }
      const data: VerifyData = await res.json();
      setVerifyData(data);
      setState(data.ticketCount > 0 ? "tickets-found" : "error");
      if (data.ticketCount === 0) {
        setError("No GPP tickets found for this wallet.");
      }
    } catch {
      setError("Failed to verify tickets. Please try again.");
      setState("error");
    }
  }

  async function claimPoints() {
    setState("claiming");
    try {
      const res = await fetch("/api/unlock-tickets/claim", {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Claim failed");
      }
      const data = await res.json();
      setClaimData({
        claimed: true,
        claimId: data.claimId,
        ticketCount: data.ticketCount,
        pointsAwarded: data.pointsAwarded,
        tickets: verifyData?.tickets,
      });
      setState("success");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed");
      setState("error");
    }
  }

  async function handleConnectWallet() {
    const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setError("No wallet found. Please install MetaMask or another browser wallet.");
      setState("error");
      return;
    }

    try {
      setState("verifying");

      // Connect wallet
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
      const address = accounts[0];
      if (!address) throw new Error("No account selected");

      // Create and sign a verification message
      const message = `Verify wallet for PizzaDAO GPP ticket claim.\n\nWallet: ${address}\nTimestamp: ${Date.now()}`;
      const signature = await eth.request({
        method: "personal_sign",
        params: [message, address],
      }) as string;

      // Send to server to verify and store in session
      const res = await fetch("/api/unlock/verify-wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature, address }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Wallet verification failed");
      }

      // Now verify tickets with the stored wallet
      await verifyTickets();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Wallet connection failed";
      // User rejected the request — go back to unclaimed state
      if (msg.includes("rejected") || msg.includes("denied")) {
        setState("own-unclaimed");
        return;
      }
      setError(msg);
      setState("error");
    }
  }

  // Hidden states -- render nothing
  if (state === "loading" || state === "hidden") return null;

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
        Pizza Party Tickets
      </h3>

      {/* Already claimed -- visible to everyone */}
      {(state === "already-claimed" || state === "success") && claimData && (
        <div>
          <div
            style={{
              textAlign: "center",
              marginBottom: 20,
              padding: 16,
              borderRadius: 12,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                lineHeight: 1,
                color: "var(--color-text)",
              }}
            >
              {claimData.ticketCount}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                opacity: 0.5,
                marginTop: 6,
              }}
            >
              GPP Ticket{claimData.ticketCount !== 1 ? "s" : ""} Claimed
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#f59e0b",
                marginTop: 8,
              }}
            >
              +{claimData.pointsAwarded?.toLocaleString()} Pizza Points
            </div>
          </div>

          {claimData.tickets && claimData.tickets.length > 0 && (
            <div style={{ display: "grid", gap: 4 }}>
              {claimData.tickets.map((ticket, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "6px 10px",
                    borderRadius: 8,
                    background:
                      idx % 2 === 0 ? "transparent" : "var(--color-surface)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{ticket.eventName}</span>
                  <span style={{ opacity: 0.5, fontSize: 12 }}>
                    {NETWORK_NAMES[ticket.networkId] || `Chain ${ticket.networkId}`}
                  </span>
                </div>
              ))}
            </div>
          )}

          {state === "success" && (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: "#22c55e22",
                color: "#22c55e",
                fontSize: 13,
                fontWeight: 600,
                textAlign: "center",
              }}
            >
              Points claimed successfully!
            </div>
          )}
        </div>
      )}

      {/* Own profile, unclaimed -- show sign in button */}
      {state === "own-unclaimed" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>
            Connect your wallet to claim Pizza Points for your Global Pizza
            Party tickets.
          </p>
          <button
            onClick={handleConnectWallet}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "none",
              background: "#f59e0b",
              color: "#000",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Connect Wallet
          </button>
        </div>
      )}

      {/* Verifying */}
      {state === "verifying" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div
            style={{
              fontSize: 14,
              opacity: 0.7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: "2px solid var(--color-text)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            Checking for GPP tickets...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Tickets found -- show list and claim button */}
      {state === "tickets-found" && verifyData && (
        <div>
          <div
            style={{
              textAlign: "center",
              marginBottom: 16,
              padding: 16,
              borderRadius: 12,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>
              {verifyData.ticketCount}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                opacity: 0.5,
                marginTop: 6,
              }}
            >
              Ticket{verifyData.ticketCount !== 1 ? "s" : ""} Found
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: "#f59e0b",
                marginTop: 8,
              }}
            >
              {verifyData.pointsAvailable.toLocaleString()} Pizza Points
              Available
            </div>
          </div>

          <div style={{ display: "grid", gap: 4, marginBottom: 16 }}>
            {verifyData.tickets.map((ticket, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 8,
                  background:
                    idx % 2 === 0 ? "transparent" : "var(--color-surface)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500 }}>{ticket.eventName}</span>
                <span style={{ opacity: 0.5, fontSize: 12 }}>
                  {NETWORK_NAMES[ticket.networkId] || `Chain ${ticket.networkId}`}
                </span>
              </div>
            ))}
          </div>

          <div style={{ textAlign: "center" }}>
            <button
              onClick={claimPoints}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#22c55e",
                color: "#fff",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Claim {verifyData.pointsAvailable.toLocaleString()} Pizza Points
            </button>
          </div>
        </div>
      )}

      {/* Claiming spinner */}
      {state === "claiming" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div
            style={{
              fontSize: 14,
              opacity: 0.7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: "2px solid var(--color-text)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            Claiming points...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 16 }}>
            {error}
          </p>
          {isOwner && (
            <button
              onClick={handleConnectWallet}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#f59e0b",
                color: "#000",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
