"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

type Voucher = { memberId: string; name: string; city: string };

type VouchedByProps = { memberId: string };

/**
 * Profile block: how many members vouched for this member, and who. Renders nothing while the
 * setting vouches.showVouchersEnabled is off (the API then answers { enabled: false }) or if the
 * list cannot be loaded.
 */
export function VouchedBy({ memberId }: VouchedByProps) {
  const t = useTranslations("dashboard.vouches");
  const [data, setData] = useState<{ total: number; vouchers: Voucher[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/vouches/vouchers?memberId=${encodeURIComponent(memberId)}`);
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && body?.enabled === true) {
          setData({ total: Number(body.total) || 0, vouchers: Array.isArray(body.vouchers) ? body.vouchers : [] });
        }
      } catch {
        // Silently fail: the block is optional.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  if (!data) return null;
  const more = Math.max(0, data.total - data.vouchers.length);

  return (
    <div style={{ marginBottom: 16 }} data-testid="vouched-by">
      <h3
        className="font-[family-name:var(--font-display)]"
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "hsl(var(--muted-foreground))",
          margin: "0 0 8px",
          fontWeight: 700,
        }}
      >
        {t("vouchedByTitle")}
        <span style={{ marginLeft: 8, textTransform: "none", letterSpacing: 0, color: "hsl(var(--foreground))" }}>
          {t("vouchedByCount", { count: data.total })}
        </span>
      </h3>
      {data.vouchers.length === 0 ? (
        <p style={{ fontSize: 14, margin: 0, color: "hsl(var(--muted-foreground))" }}>{t("vouchedByEmpty")}</p>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {data.vouchers.map((v) => (
            <Link
              key={v.memberId}
              href={`/profile/${v.memberId}`}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid hsl(var(--rule) / 0.18)",
                background: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
                fontSize: 13,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              {v.name || t("unknownName")}
            </Link>
          ))}
          {more > 0 && (
            <span style={{ alignSelf: "center", fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
              {t("vouchedByMore", { count: more })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
