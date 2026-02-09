"use client";

import { useEffect, useState, useRef } from "react";
import { Pencil, Plus, Trash2, GripVertical, X, Check } from "lucide-react";

type ProfileLink = {
  emoji: string;
  url: string;
  label: string;
};

const MAX_LINKS = 8;

// Common emojis grouped by category for quick picking
const EMOJI_GRID = [
  // Social & Web
  "🔗", "🌐", "💬", "📧", "📱",
  // Creative
  "🎨", "🎵", "📸", "🎬", "✍️",
  // Work & Code
  "💻", "🛠️", "📊", "📝", "🏢",
  // Social platforms (abstract)
  "🐦", "📺", "🎮", "🤖", "👾",
  // Fun / Pizza
  "🍕", "🔥", "⭐", "💎", "🚀",
  // More
  "❤️", "🌟", "📌", "🎯", "🏠",
];

function EmojiPicker({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (emoji: string) => void;
  onClose: () => void;
}) {
  const [customEmoji, setCustomEmoji] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 100,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 12,
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
        padding: 12,
        width: 240,
        marginTop: 4,
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 4,
          marginBottom: 8,
        }}
      >
        {EMOJI_GRID.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => {
              onChange(emoji);
              onClose();
            }}
            style={{
              fontSize: 20,
              padding: 6,
              border: value === emoji ? "2px solid #111" : "2px solid transparent",
              borderRadius: 8,
              background: value === emoji ? "rgba(0,0,0,0.05)" : "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div style={{ borderTop: "1px solid rgba(0,0,0,0.08)", paddingTop: 8 }}>
        <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
          Or type any emoji
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <input
            type="text"
            value={customEmoji}
            onChange={(e) => setCustomEmoji(e.target.value)}
            placeholder="Paste emoji..."
            maxLength={10}
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: 6,
              border: '1px solid var(--color-border-strong)',
              fontSize: 16,
              outline: "none",
              textAlign: "center",
              width: "100%",
            }}
          />
          <button
            type="button"
            onClick={() => {
              if (customEmoji.trim()) {
                onChange(customEmoji.trim());
                onClose();
              }
            }}
            disabled={!customEmoji.trim()}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: '1px solid var(--color-border-strong)',
              background: customEmoji.trim() ? "#111" : "rgba(0,0,0,0.05)",
              color: customEmoji.trim() ? "white" : "rgba(0,0,0,0.3)",
              cursor: customEmoji.trim() ? "pointer" : "not-allowed",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Use
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Editable links section for the dashboard.
 * Allows adding, removing, and reordering links with emoji + URL.
 */
export function ProfileLinksEditor({ memberId }: { memberId: string }) {
  const [links, setLinks] = useState<ProfileLink[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [emojiPickerIdx, setEmojiPickerIdx] = useState<number | null>(null);

  // Store original links for cancel
  const [originalLinks, setOriginalLinks] = useState<ProfileLink[]>([]);

  // Load links on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/profile-links?memberId=${encodeURIComponent(memberId)}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.links)) {
            const loaded = data.links.map((l: any) => ({
              emoji: l.emoji || "",
              url: l.url || "",
              label: l.label || "",
            }));
            setLinks(loaded);
            setOriginalLinks(loaded);
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoaded(true);
      }
    })();
  }, [memberId]);

  const startEditing = () => {
    setOriginalLinks(links.map((l) => ({ ...l })));
    setEditing(true);
    setError(null);
  };

  const cancelEditing = () => {
    setLinks(originalLinks.map((l) => ({ ...l })));
    setEditing(false);
    setError(null);
    setEmojiPickerIdx(null);
  };

  const addLink = () => {
    if (links.length >= MAX_LINKS) return;
    setLinks([...links, { emoji: "🔗", url: "", label: "" }]);
  };

  const removeLink = (idx: number) => {
    setLinks(links.filter((_, i) => i !== idx));
    if (emojiPickerIdx === idx) setEmojiPickerIdx(null);
  };

  const updateLink = (idx: number, field: keyof ProfileLink, value: string) => {
    setLinks(links.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const moveLink = (idx: number, direction: -1 | 1) => {
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= links.length) return;
    const newLinks = [...links];
    [newLinks[idx], newLinks[newIdx]] = [newLinks[newIdx], newLinks[idx]];
    setLinks(newLinks);
  };

  const saveLinks = async () => {
    // Filter out empty links
    const toSave = links.filter((l) => l.url.trim());

    // Validate URLs
    for (let i = 0; i < toSave.length; i++) {
      try {
        const url = new URL(toSave[i].url);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
          setError(`Link ${i + 1}: URL must start with http:// or https://`);
          return;
        }
      } catch {
        setError(`Link ${i + 1}: Invalid URL`);
        return;
      }
      if (!toSave[i].emoji.trim()) {
        setError(`Link ${i + 1}: Please select an emoji`);
        return;
      }
    }

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/profile-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          memberId,
          links: toSave.map((l) => ({
            emoji: l.emoji,
            url: l.url.trim(),
            label: l.label.trim() || null,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save");
      }

      const data = await res.json();
      const saved = (data.links || []).map((l: any) => ({
        emoji: l.emoji || "",
        url: l.url || "",
        label: l.label || "",
      }));
      setLinks(saved);
      setOriginalLinks(saved);
      setEditing(false);
      setEmojiPickerIdx(null);
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to save links");
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return null;

  // Read-only display mode
  if (!editing) {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
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
            Links
          </h3>
          <button
            onClick={startEditing}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              opacity: 0.4,
              padding: 0,
              display: "flex",
              alignItems: "center",
            }}
            title="Edit links"
          >
            <Pencil size={12} />
          </button>
        </div>
        {links.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {links.map((link, idx) => {
              let displayText = link.label;
              if (!displayText) {
                try {
                  displayText = new URL(link.url).hostname.replace(/^www\./, "");
                } catch {
                  displayText = link.url;
                }
              }
              return (
                <a
                  key={idx}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "6px 12px",
                    borderRadius: 10,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 500,
                    transition: "border-color 0.15s, box-shadow 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,0,0,0.3)";
                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,0,0,0.12)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <span style={{ fontSize: 16 }}>{link.emoji}</span>
                  <span>{displayText}</span>
                </a>
              );
            })}
          </div>
        ) : (
          <p
            style={{
              fontSize: 14,
              opacity: 0.5,
              margin: 0,
            }}
          >
            No links added yet
          </p>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
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
          Edit Links
        </h3>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: 10,
            background: "rgba(255,0,0,0.05)",
            borderRadius: 8,
            color: "#c00",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        {links.map((link, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              padding: 8,
              borderRadius: 10,
              border: '1px solid var(--color-border)',
              background: "rgba(0,0,0,0.02)",
            }}
          >
            {/* Reorder buttons */}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button
                type="button"
                onClick={() => moveLink(idx, -1)}
                disabled={idx === 0}
                style={{
                  background: "none",
                  border: "none",
                  cursor: idx === 0 ? "default" : "pointer",
                  opacity: idx === 0 ? 0.2 : 0.5,
                  padding: 0,
                  fontSize: 10,
                  lineHeight: 1,
                }}
                title="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={() => moveLink(idx, 1)}
                disabled={idx === links.length - 1}
                style={{
                  background: "none",
                  border: "none",
                  cursor: idx === links.length - 1 ? "default" : "pointer",
                  opacity: idx === links.length - 1 ? 0.2 : 0.5,
                  padding: 0,
                  fontSize: 10,
                  lineHeight: 1,
                }}
                title="Move down"
              >
                ▼
              </button>
            </div>

            {/* Emoji picker button */}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setEmojiPickerIdx(emojiPickerIdx === idx ? null : idx)}
                style={{
                  fontSize: 20,
                  padding: "4px 8px",
                  borderRadius: 8,
                  border: '1px solid var(--color-border-strong)',
                  background: 'var(--color-surface)',
                  cursor: "pointer",
                  minWidth: 44,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                title="Pick emoji"
              >
                {link.emoji || "?"}
              </button>
              {emojiPickerIdx === idx && (
                <EmojiPicker
                  value={link.emoji}
                  onChange={(emoji) => updateLink(idx, "emoji", emoji)}
                  onClose={() => setEmojiPickerIdx(null)}
                />
              )}
            </div>

            {/* URL + Label inputs */}
            <div style={{ flex: 1, display: "grid", gap: 4 }}>
              <input
                type="url"
                value={link.url}
                onChange={(e) => updateLink(idx, "url", e.target.value)}
                placeholder="https://..."
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: '1px solid var(--color-border-strong)',
                  fontSize: 13,
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                }}
              />
              <input
                type="text"
                value={link.label}
                onChange={(e) => updateLink(idx, "label", e.target.value)}
                placeholder="Label (optional)"
                maxLength={50}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  border: '1px solid var(--color-border)',
                  fontSize: 12,
                  outline: "none",
                  width: "100%",
                  boxSizing: "border-box",
                  fontFamily: "inherit",
                  opacity: 0.8,
                }}
              />
            </div>

            {/* Remove button */}
            <button
              type="button"
              onClick={() => removeLink(idx)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                opacity: 0.4,
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
              title="Remove link"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Add link button */}
      {links.length < MAX_LINKS && (
        <button
          type="button"
          onClick={addLink}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 14px",
            borderRadius: 8,
            border: "1px dashed rgba(0,0,0,0.2)",
            background: "transparent",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
            color: "#555",
            marginBottom: 12,
            fontFamily: "inherit",
          }}
        >
          <Plus size={14} /> Add Link
        </button>
      )}

      {/* Save / Cancel buttons */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={saveLinks}
          disabled={saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 10,
            border: "1px solid black",
            background: 'var(--color-btn-primary-bg)',
            color: 'var(--color-btn-primary-text)',
            fontWeight: 650,
            cursor: saving ? "wait" : "pointer",
            fontSize: 13,
            fontFamily: "inherit",
            opacity: saving ? 0.6 : 1,
          }}
        >
          <Check size={14} />
          {saving ? "Saving..." : "Save Links"}
        </button>
        <button
          onClick={cancelEditing}
          disabled={saving}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 16px",
            borderRadius: 10,
            border: '1px solid var(--color-border-strong)',
            background: 'var(--color-surface)',
            color: 'var(--color-text)',
            fontWeight: 650,
            cursor: "pointer",
            fontSize: 13,
            fontFamily: "inherit",
          }}
        >
          <X size={14} />
          Cancel
        </button>
      </div>
    </div>
  );
}
