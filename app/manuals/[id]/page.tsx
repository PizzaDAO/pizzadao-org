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
  const [content, setContent] = useState<string | null>(null);
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
        setContent(data.content);
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
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
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
            ← Back to Manuals
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
                    Open in Google Docs →
                  </a>
                </div>
              )}
            </div>

            {/* Manual content */}
            <div style={{ padding: 24 }}>
              {content ? (
                <div
                  className="manual-content"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              ) : (
                <div
                  style={{
                    padding: 40,
                    textAlign: "center",
                    color: "#666",
                  }}
                >
                  <p style={{ marginBottom: 16 }}>
                    Unable to load document content.
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
                      View in Google Docs
                    </a>
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

      <style jsx global>{`
        .manual-content {
          font-size: 15px;
          line-height: 1.7;
          color: #333;
        }
        .manual-content h1 {
          font-size: 24px;
          font-weight: 700;
          margin: 24px 0 16px 0;
          color: #111;
        }
        .manual-content h2 {
          font-size: 20px;
          font-weight: 600;
          margin: 20px 0 12px 0;
          color: #111;
        }
        .manual-content h3 {
          font-size: 17px;
          font-weight: 600;
          margin: 16px 0 8px 0;
          color: #111;
        }
        .manual-content p {
          margin: 0 0 16px 0;
        }
        .manual-content ul,
        .manual-content ol {
          margin: 0 0 16px 0;
          padding-left: 24px;
        }
        .manual-content li {
          margin-bottom: 8px;
        }
        .manual-content a {
          color: #2563eb;
          text-decoration: none;
        }
        .manual-content a:hover {
          text-decoration: underline;
        }
        .manual-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
        }
        .manual-content th,
        .manual-content td {
          border: 1px solid #ddd;
          padding: 8px 12px;
          text-align: left;
        }
        .manual-content th {
          background: #f5f5f5;
          font-weight: 600;
        }
        .manual-content img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          margin: 16px 0;
        }
        .manual-content hr {
          border: none;
          border-top: 1px solid #eee;
          margin: 24px 0;
        }
        .manual-content blockquote {
          margin: 16px 0;
          padding: 12px 16px;
          border-left: 4px solid #eab308;
          background: #fefce8;
          color: #666;
        }
        .manual-content code {
          background: #f5f5f5;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 14px;
        }
        .manual-content pre {
          background: #f5f5f5;
          padding: 16px;
          border-radius: 8px;
          overflow-x: auto;
          margin: 16px 0;
        }
        .manual-content pre code {
          background: none;
          padding: 0;
        }
      `}</style>
    </div>
  );
}
