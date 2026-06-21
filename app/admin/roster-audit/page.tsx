"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

interface RosterMismatch {
  memberId: string;
  name: string;
  crewId: string;
  crewLabel: string;
  attendanceCount: number;
  lastAttendedDate: string | null;
}

interface AuditData {
  missing: RosterMismatch[];
  inactive: RosterMismatch[];
  healthyCount: number;
}

export default function RosterAuditPage() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, "success" | "error">>({});

  useEffect(() => {
    fetch("/api/crew/roster-audit")
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleAction(memberId: string, crewId: string, action: "add" | "remove") {
    const key = `${memberId}:${crewId}:${action}`;
    if (!confirm(`Are you sure you want to ${action} ${crewId} for member ${memberId}?`)) return;

    setActionPending(key);
    try {
      const res = await fetch("/api/crew/roster-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, crewId, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setActionResults((prev) => ({ ...prev, [key]: "success" }));
    } catch {
      setActionResults((prev) => ({ ...prev, [key]: "error" }));
    } finally {
      setActionPending(null);
    }
  }

  if (loading) {
    return (
      <div style={{ ...pageStyle(), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ fontSize: 18, opacity: 0.7, fontFamily: inter.style.fontFamily }}>Loading audit data...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...pageStyle(), display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", fontFamily: inter.style.fontFamily }}>
          <h1 style={{ fontSize: 24, marginBottom: 12 }}>Access Denied</h1>
          <p style={{ opacity: 0.6 }}>{error}</p>
          <Link href="/" style={{ color: "var(--color-text-primary)", marginTop: 16, display: "inline-block" }}>
            ← Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={pageStyle()}>
      <div style={{ maxWidth: 1000, margin: "0 auto", fontFamily: inter.style.fontFamily, padding: "40px 20px" }}>
        <Link href="/" style={{ color: "var(--color-text-secondary)", textDecoration: "none", fontSize: 14 }}>
          ← Dashboard
        </Link>

        <h1 style={{ fontSize: 28, fontWeight: 700, marginTop: 12, marginBottom: 8 }}>Crew Roster Audit</h1>
        <p style={{ opacity: 0.6, fontSize: 14, marginBottom: 32 }}>
          Comparing roster membership against call attendance data. Healthy matches: <strong>{data.healthyCount}</strong>
        </p>

        {/* Missing from roster */}
        <section style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
            Missing from Roster ({data.missing.length})
          </h2>
          <p style={{ fontSize: 13, opacity: 0.5, marginBottom: 12 }}>
            Members who attended 3+ calls for a crew but are not listed on the roster.
          </p>
          {data.missing.length === 0 ? (
            <p style={{ opacity: 0.5, fontSize: 14 }}>None — all active attendees are on their crew rosters.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle()}>
                <thead>
                  <tr>
                    <th style={thStyle()}>Member</th>
                    <th style={thStyle()}>Crew</th>
                    <th style={thStyle()}>Calls</th>
                    <th style={thStyle()}>Last Attended</th>
                    <th style={thStyle()}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.missing.map((row) => {
                    const key = `${row.memberId}:${row.crewId}:add`;
                    const result = actionResults[key];
                    return (
                      <tr key={key}>
                        <td style={tdStyle()}>
                          <Link href={`/profile/${row.memberId}`} style={{ color: "inherit" }}>
                            {row.name}
                          </Link>
                          <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 6 }}>#{row.memberId}</span>
                        </td>
                        <td style={tdStyle()}>{row.crewLabel}</td>
                        <td style={tdStyle()}>{row.attendanceCount}</td>
                        <td style={tdStyle()}>{formatDate(row.lastAttendedDate)}</td>
                        <td style={tdStyle()}>
                          {result === "success" ? (
                            <span style={{ color: "#10b981", fontWeight: 600, fontSize: 13 }}>Added</span>
                          ) : result === "error" ? (
                            <span style={{ color: "#ef4444", fontWeight: 600, fontSize: 13 }}>Failed</span>
                          ) : (
                            <button
                              onClick={() => handleAction(row.memberId, row.crewId, "add")}
                              disabled={actionPending === key}
                              style={btnStyle("#10b981")}
                            >
                              {actionPending === key ? "..." : "+ Add"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Inactive on roster */}
        <section>
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
            Inactive on Roster ({data.inactive.length})
          </h2>
          <p style={{ fontSize: 13, opacity: 0.5, marginBottom: 12 }}>
            Members listed on a crew roster with 0 attendance or last attended &gt;6 months ago.
          </p>
          {data.inactive.length === 0 ? (
            <p style={{ opacity: 0.5, fontSize: 14 }}>None — all rostered members are active.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={tableStyle()}>
                <thead>
                  <tr>
                    <th style={thStyle()}>Member</th>
                    <th style={thStyle()}>Crew</th>
                    <th style={thStyle()}>Calls</th>
                    <th style={thStyle()}>Last Attended</th>
                    <th style={thStyle()}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.inactive.map((row) => {
                    const key = `${row.memberId}:${row.crewId}:remove`;
                    const result = actionResults[key];
                    return (
                      <tr key={key}>
                        <td style={tdStyle()}>
                          <Link href={`/profile/${row.memberId}`} style={{ color: "inherit" }}>
                            {row.name}
                          </Link>
                          <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 6 }}>#{row.memberId}</span>
                        </td>
                        <td style={tdStyle()}>{row.crewLabel}</td>
                        <td style={tdStyle()}>{row.attendanceCount}</td>
                        <td style={tdStyle()}>{formatDate(row.lastAttendedDate)}</td>
                        <td style={tdStyle()}>
                          {result === "success" ? (
                            <span style={{ color: "#10b981", fontWeight: 600, fontSize: 13 }}>Removed</span>
                          ) : result === "error" ? (
                            <span style={{ color: "#ef4444", fontWeight: 600, fontSize: 13 }}>Failed</span>
                          ) : (
                            <button
                              onClick={() => handleAction(row.memberId, row.crewId, "remove")}
                              disabled={actionPending === key}
                              style={btnStyle("#ef4444")}
                            >
                              {actionPending === key ? "..." : "- Remove"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatDate(d: string | null): string {
  if (!d) return "Never";
  return new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function pageStyle(): React.CSSProperties {
  return {
    minHeight: "100vh",
    background: "var(--color-page-bg)",
    color: "var(--color-text)",
  };
}

function tableStyle(): React.CSSProperties {
  return {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 14,
  };
}

function thStyle(): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "8px 12px",
    borderBottom: "2px solid var(--color-divider)",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    opacity: 0.6,
    fontWeight: 700,
  };
}

function tdStyle(): React.CSSProperties {
  return {
    padding: "10px 12px",
    borderBottom: "1px solid var(--color-divider)",
    verticalAlign: "middle",
  };
}

function btnStyle(color: string): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${color}`,
    color,
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
