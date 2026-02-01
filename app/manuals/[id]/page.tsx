"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Manual = {
  title: string;
  url: string | null;
  crew: string;
  status: string;
  authorId: string;
  author: string;
  lastUpdated: string;
  notes: string;
};

type SheetContent = {
  headers: string[];
  rows: string[][];
};

function statusBadge(status: string) {
  const s = status.toLowerCase();
  let bg = "#888";
  let color = "white";

  if (s === "complete" || s === "completed") {
    bg = "#22c55e";
  } else if (s === "draft") {
    bg = "#f97316";
  } else if (s === "needed") {
    bg = "#ef4444";
  } else if (s === "backlog") {
    bg = "#8b5cf6";
  }

  return {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 500,
    background: bg,
    color,
  };
}

export default function ManualDetailPage() {
  const params = useParams();
  const id = params.id as string;

  const [manual, setManual] = useState<Manual | null>(null);
  const [sheetContent, setSheetContent] = useState<SheetContent | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchManual() {
      try {
        const res = await fetch(`/api/manuals/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            throw new Error("Manual not found");
          }
          throw new Error("Failed to fetch manual");
        }
        const data = await res.json();
        setManual(data.manual);
        setSheetContent(data.sheetContent);
        setContentError(data.contentError || null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    if (id) {
      fetchManual();
    }
  }, [id]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <Link
            href="/manuals"
            style={{
              fontSize: 14,
              color: "#666",
              textDecoration: "none",
              marginBottom: 8,
              display: "inline-flex",
              alignItems: "center",
              minHeight: 44,
            }}
          >
            &#8592; Back to Manuals
          </Link>
        </div>

        {/* Loading state */}
        {loading && (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.08)",
              padding: 24,
            }}
          >
            <div
              style={{
                height: 32,
                width: "60%",
                background: "#eee",
                borderRadius: 4,
                marginBottom: 16,
                animation: "pulse 1.5s infinite",
              }}
            />
            <div
              style={{
                height: 200,
                background: "#eee",
                borderRadius: 4,
                animation: "pulse 1.5s infinite",
              }}
            />
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              background: "white",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <p style={{ fontSize: 16, color: "#c00", marginBottom: 16 }}>
              {error}
            </p>
            <Link
              href="/manuals"
              style={{
                display: "inline-block",
                padding: "12px 20px",
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                color: "white",
                background: "#111",
                border: "none",
                borderRadius: 8,
                textDecoration: "none",
              }}
            >
              Back to Manuals
            </Link>
          </div>
        )}

        {/* Manual content */}
        {!loading && !error && manual && (
          <div
            style={{
              background: "white",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            {/* Manual header */}
            <div
              style={{
                padding: 24,
                borderBottom: "1px solid rgba(0,0,0,0.08)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 16,
                  marginBottom: 12,
                }}
              >
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111" }}>
                  {manual.title}
                </h1>
                {manual.status && (
                  <span style={statusBadge(manual.status)}>{manual.status}</span>
                )}
              </div>
              <div style={{ fontSize: 14, color: "#666", display: "flex", flexWrap: "wrap", gap: "8px 16px" }}>
                {manual.crew && <span>{manual.crew}</span>}
                {manual.author && <span>by {manual.author}</span>}
                {manual.lastUpdated && <span>Updated: {manual.lastUpdated}</span>}
              </div>
              {manual.url && (
                <div style={{ marginTop: 12 }}>
                  <a
                    href={manual.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 13,
                      color: "#2563eb",
                      textDecoration: "none",
                    }}
                  >
                    Open in Google Sheets &#8594;
                  </a>
                </div>
              )}
            </div>

            {/* Manual content - Sheet data displayed as table */}
            <div style={{ padding: 24 }}>
              {sheetContent && sheetContent.rows.length > 0 ? (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {sheetContent.headers.map((header, i) => (
                          <th
                            key={i}
                            style={{
                              textAlign: "left",
                              padding: "12px 16px",
                              borderBottom: "2px solid rgba(0,0,0,0.1)",
                              fontSize: 12,
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                              background: "#fafafa",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheetContent.rows.map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td
                              key={cellIndex}
                              style={{
                                padding: "12px 16px",
                                borderBottom: "1px solid rgba(0,0,0,0.06)",
                                fontSize: 14,
                                verticalAlign: "top",
                              }}
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: "#666",
                    background: "#fafafa",
                    borderRadius: 8,
                  }}
                >
                  <div style={{
                    fontSize: 48,
                    marginBottom: 16,
                    opacity: 0.5,
                  }}>
                    {contentError?.includes('private') ? '\uD83D\uDD12' :
                     contentError?.includes('not found') ? '\uD83D\uDD0D' :
                     contentError?.includes('No Google Sheet link') ? '\uD83D\uDCCB' : '\u26A0\uFE0F'}
                  </div>
                  <p style={{ marginBottom: 8, fontWeight: 500, color: "#333" }}>
                    {contentError?.includes('private') ? 'Private Sheet' :
                     contentError?.includes('not found') ? 'Sheet Not Found' :
                     contentError?.includes('No Google Sheet link') ? 'No Sheet Link' :
                     'Unable to Load Content'}
                  </p>
                  <p style={{ marginBottom: 20, fontSize: 14, maxWidth: 400, margin: "0 auto 20px" }}>
                    {contentError || "The sheet content could not be loaded."}
                  </p>
                  {manual.url && (
                    <a
                      href={manual.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-block",
                        padding: "12px 20px",
                        fontSize: 14,
                        fontWeight: 500,
                        color: "white",
                        background: "#111",
                        borderRadius: 8,
                        textDecoration: "none",
                      }}
                    >
                      Open in Google Sheets
                    </a>
                  )}
                  {!manual.url && manual.status?.toLowerCase() === 'needed' && (
                    <p style={{ fontSize: 13, color: "#888", marginTop: 12 }}>
                      This manual needs to be written. Check with the crew lead.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
