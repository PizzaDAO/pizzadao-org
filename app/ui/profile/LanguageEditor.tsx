// app/ui/profile/LanguageEditor.tsx
//
// Language preference picker (i18n) — anchovy-65959 scaffold, extracted from
// app/profile/[id]/edit/EditClient.tsx so it can be reused on the dashboard.
//
// Reads + writes /api/profile-extras/[id] (owner-only). On success the
// server sets the NEXT_LOCALE cookie; router.refresh() lets in-tree server
// components pick up the new catalog.
"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/app/lib/i18n/locales";

const FONT_SANS = "var(--font-sans), system-ui, sans-serif";

const saveBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "10px 20px",
  borderRadius: 9999,
  background: "hsl(var(--ink))",
  color: "hsl(var(--cream))",
  border: "1px solid hsl(var(--ink))",
  fontWeight: 600,
  fontFamily: FONT_SANS,
  fontSize: 13.5,
  textAlign: "center",
  transition: "background-color 150ms ease, color 150ms ease, border-color 150ms ease",
};

function Spinner({ size = 12 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="animate-spin"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        border: "2px solid hsl(var(--cream) / 0.35)",
        borderTopColor: "hsl(var(--cream))",
        borderRadius: "50%",
      }}
    />
  );
}

export interface LanguageEditorProps {
  memberId: string;
  /** Render a visible label above the select (defaults to aria-label only). */
  showLabel?: boolean;
  /** Lay the select + save button out on one row where space allows. */
  inline?: boolean;
}

export function LanguageEditor({ memberId, showLabel = false, inline = false }: LanguageEditorProps) {
  const router = useRouter();
  const t = useTranslations("language");
  const tCommon = useTranslations("common");
  const selectId = useId();

  const [locale, setLocale] = useState<SupportedLocale>("en");
  const [initialLocale, setInitialLocale] = useState<SupportedLocale>("en");
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/profile-extras/${memberId}`, {
          credentials: "include",
        });
        if (!alive) return;
        if (res.ok) {
          const json = await res.json();
          const loaded = (SUPPORTED_LOCALES as readonly string[]).includes(json?.locale)
            ? (json.locale as SupportedLocale)
            : "en";
          setLocale(loaded);
          setInitialLocale(loaded);
        }
      } catch {
        // best-effort — stay on default
      } finally {
        if (alive) setLoadingInitial(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [memberId]);

  useEffect(() => {
    if (savedAt == null) return;
    const handle = setTimeout(() => setSavedAt(null), 1500);
    return () => clearTimeout(handle);
  }, [savedAt]);

  const dirty = locale !== initialLocale;
  const disabled = saving || !dirty || loadingInitial;

  const onSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/profile-extras/${memberId}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      if (!res.ok) {
        let msg = t("saveError");
        try {
          const body = await res.json();
          if (body?.error) msg = String(body.error);
        } catch {
          /* swallow */
        }
        setError(msg);
        return;
      }
      setInitialLocale(locale);
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {showLabel && (
        <label htmlFor={selectId} className="overline text-foreground/60">
          {t("selectLabel")}
        </label>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: inline ? "row" : "column",
          flexWrap: "wrap",
          alignItems: inline ? "center" : "stretch",
          gap: inline ? 10 : 8,
        }}
      >
        <select
          id={selectId}
          aria-label={showLabel ? undefined : t("selectLabel")}
          value={locale}
          onChange={(e) => setLocale(e.target.value as SupportedLocale)}
          disabled={loadingInitial || saving}
          style={{
            padding: inline ? "10px 12px" : 12,
            borderRadius: 12,
            border: "1px solid hsl(var(--rule-warm) / 0.55)",
            background: "hsl(var(--cream) / 0.4)",
            color: "hsl(var(--foreground))",
            fontSize: 14,
            fontFamily: FONT_SANS,
            appearance: "auto",
            minWidth: inline ? 160 : undefined,
            minHeight: 44,
          }}
        >
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(`names.${code}`)}
            </option>
          ))}
        </select>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={onSave}
            disabled={disabled}
            style={{
              ...saveBtn,
              minHeight: 44,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            {saving ? <Spinner /> : null}
            {saving ? tCommon("loading") : t("saveButton")}
          </button>
          {savedAt && !error ? (
            <span role="status" className="overline" style={{ color: "hsl(var(--ink) / 0.55)" }}>
              § {tCommon("saved")}
            </span>
          ) : null}
        </div>
      </div>

      {error ? (
        <div role="alert" style={{ fontSize: 13, color: "hsl(var(--destructive))" }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}
