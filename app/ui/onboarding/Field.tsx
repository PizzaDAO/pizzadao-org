// app/ui/onboarding/Field.tsx
"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  children: ReactNode;
};

export function Field({ label, children }: Props) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 650 }}>{label}</span>
      {children}
    </label>
  );
}
