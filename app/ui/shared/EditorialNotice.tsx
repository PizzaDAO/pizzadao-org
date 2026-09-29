// Shared editorial "notice card" shell used by app/not-found.tsx and
// app/error.tsx — paper card, tomato overline, display headline.

export function EditorialNotice({
  overline,
  headline,
  body,
  children,
}: {
  overline: string;
  headline: string;
  body: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <main
      className="relative grid place-items-center bg-background text-foreground"
      style={{ minHeight: "calc(100svh - 3.5rem)", padding: "clamp(24px, 6vw, 48px) 16px" }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
        style={{
          background:
            "radial-gradient(70% 60% at 50% 0%, hsl(var(--tomato) / 0.10), transparent 65%)",
        }}
      />
      <div
        className="paper-soft fade-up relative w-full max-w-lg rounded-[24px] border p-7 text-center md:p-10"
        style={{
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          background: "hsl(var(--card))",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p className="overline text-tomato">{overline}</p>
        <h1
          className="mt-3 font-black tracking-[-0.015em] text-foreground"
          style={{
            fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
            fontSize: "clamp(1.9rem, 5vw, 2.8rem)",
            lineHeight: 1,
          }}
        >
          {headline}
        </h1>
        <div className="mt-4 text-foreground/70" style={{ fontSize: 15, lineHeight: 1.55 }}>
          {body}
        </div>
        {children && (
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">{children}</div>
        )}
        <div className="rule-warm mt-8 pt-4">
          <p className="overline m-0 text-foreground/40">§ pizzadao · est. 2021</p>
        </div>
      </div>
    </main>
  );
}
