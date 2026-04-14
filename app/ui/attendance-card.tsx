"use client";

import { useEffect, useState } from "react";
import type { AttendanceResult } from "@/app/lib/attendance";

interface AttendanceCardProps {
  memberId: string;
}

export function AttendanceCard({ memberId }: AttendanceCardProps) {
  const [data, setData] = useState<AttendanceResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAttendance() {
      try {
        const res = await fetch(`/api/attendance/${memberId}`);
        if (res.ok) {
          const json: AttendanceResult = await res.json();
          setData(json);
        }
      } catch {
        // silently fail — attendance is supplementary info
      } finally {
        setLoading(false);
      }
    }
    if (memberId) {
      fetchAttendance();
    }
  }, [memberId]);

  // Don't render anything if loading, error, or zero calls
  if (loading || !data || data.totalCalls === 0) {
    return null;
  }

  const crewEntries = Object.entries(data.crewBreakdown).sort(
    (a, b) => b[1].count - a[1].count
  );

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
        Crew Call Attendance
      </h3>

      {/* Total calls — big number */}
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
          {data.totalCalls}
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
          Total Calls Attended
        </div>
      </div>

      {/* Per-crew breakdown */}
      {crewEntries.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 8,
            marginBottom: 20,
          }}
        >
          {crewEntries.map(([crewId, info]) => (
            <div
              key={crewId}
              style={{
                padding: 12,
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: "var(--color-text)",
                }}
              >
                {info.count}
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: 0.7,
                  marginTop: 2,
                }}
              >
                {info.crewLabel}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent calls list */}
      {data.recentCalls.length > 0 && (
        <div>
          <h4
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "1px",
              opacity: 0.5,
              marginTop: 0,
              marginBottom: 8,
              fontWeight: 700,
            }}
          >
            Recent Calls
          </h4>
          <div style={{ display: "grid", gap: 4 }}>
            {data.recentCalls.map((call, idx) => (
              <div
                key={idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "6px 10px",
                  borderRadius: 8,
                  background:
                    idx % 2 === 0
                      ? "transparent"
                      : "var(--color-surface)",
                  fontSize: 13,
                }}
              >
                <span style={{ fontWeight: 500 }}>{call.crew}</span>
                <span style={{ opacity: 0.5, fontSize: 12 }}>
                  {new Date(call.date).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
