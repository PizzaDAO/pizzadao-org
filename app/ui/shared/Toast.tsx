"use client";

// Lightweight toast notifications — replaces native alert() popups.
//
// Usage:
//   const toast = useToast();
//   toast.error("Could not join crew");
//   toast.success("Saved");
//
// <ToastProvider> is mounted once in app/providers.tsx. Toasts stack at the
// bottom-centre of the viewport (clear of CornerLinks at bottom-right) and
// auto-dismiss after a few seconds. Announced to screen readers via
// role="status" / role="alert".

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export type ToastKind = "error" | "success" | "info";

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  show: (message: string, kind?: ToastKind) => void;
  error: (message: string) => void;
  success: (message: string) => void;
  info: (message: string) => void;
}

const noop = () => {};
const ToastContext = createContext<ToastApi>({ show: noop, error: noop, success: noop, info: noop });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

const DURATION_MS = 5000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, kind: ToastKind = "info") => {
      const id = nextId.current++;
      setToasts((t) => [...t.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      error: (m) => show(m, "error"),
      success: (m) => show(m, "success"),
      info: (m) => show(m, "info"),
    }),
    [show]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-20 z-[1100] flex flex-col items-center gap-2 px-4"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className="fade-up pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-sm"
            style={{
              background: "hsl(var(--card))",
              color: "hsl(var(--card-foreground))",
              borderColor:
                t.kind === "error"
                  ? "hsl(var(--tomato) / 0.55)"
                  : t.kind === "success"
                    ? "var(--color-success)"
                    : "hsl(var(--rule-warm) / 0.55)",
              boxShadow: "var(--shadow-lifted)",
              animationDuration: "0.35s",
            }}
          >
            <span
              className="overline mt-0.5 shrink-0"
              style={{
                color:
                  t.kind === "error"
                    ? "hsl(var(--tomato))"
                    : t.kind === "success"
                      ? "var(--color-success)"
                      : "hsl(var(--foreground) / 0.55)",
              }}
            >
              {t.kind === "error" ? "Oops" : t.kind === "success" ? "Done" : "Note"}
            </span>
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 shrink-0 rounded-full p-1 text-foreground/50 hover:text-foreground"
              style={{ background: "transparent", border: "none", cursor: "pointer" }}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
