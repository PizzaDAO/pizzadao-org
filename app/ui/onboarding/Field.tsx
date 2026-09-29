// app/ui/onboarding/Field.tsx
//
// truffle-11395 (Restyle Phase 2): label + hint + error styling now driven by
// the new semantic tokens (`--foreground`, `--muted-foreground`,
// `--destructive`). The component remains backwards-compatible — existing
// `<Field label="..."><input/></Field>` callers keep working unchanged; new
// `hint`/`error` props are optional and additive.
"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
  /** Optional helper text shown beneath the field. */
  hint?: string;
  /** Optional error message; takes precedence over `hint` when set. */
  error?: string;
};

export function Field({ label, children, hint, error }: Props) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span
        style={{
          fontWeight: 600,
          fontSize: 14,
          color: "hsl(var(--foreground))",
        }}
      >
        {label}
      </span>
      {children}
      {error ? (
        <span
          style={{
            fontSize: 13,
            color: "hsl(var(--destructive))",
          }}
        >
          {error}
        </span>
      ) : hint ? (
        <span
          style={{
            fontSize: 13,
            color: "hsl(var(--muted-foreground))",
          }}
        >
          {hint}
        </span>
      ) : null}
    </label>
  );
}
