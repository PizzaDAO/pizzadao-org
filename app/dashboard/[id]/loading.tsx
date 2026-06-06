// app/dashboard/[id]/loading.tsx
//
// tomato-30368 — Editorial restyle. The loading screen now matches the
// onboarding wizard's print-shop chrome: paper grain, radial cream spotlight,
// overline label, and a tomato accent spinner. Functional shape is unchanged
// (a centered viewport-height block with a CSS-driven spinner).
export default function DashboardLoading() {
  return (
    <div
      className="relative grid min-h-screen place-items-center"
      style={{
        background: "hsl(var(--background))",
        color: "hsl(var(--foreground))",
        fontFamily: "var(--font-sans), system-ui, sans-serif",
        padding: "clamp(24px, 6vw, 40px) clamp(16px, 4vw, 20px)",
      }}
    >
      {/* Hero spotlight backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[60svh] opacity-60"
        style={{
          background:
            "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.20), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.08), transparent 65%)",
        }}
      />

      <div className="fade-up grid place-items-center text-center">
        <p className="overline text-tomato">§ 00 · loading the file</p>

        <div
          className="mt-6 grid h-14 w-14 place-items-center rounded-full"
          style={{
            border: "2px solid hsl(var(--rule-warm) / 0.55)",
            background: "hsl(var(--cream) / 0.5)",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              border: "3px solid hsl(var(--ink) / 0.10)",
              borderTop: "3px solid hsl(var(--tomato))",
              borderRadius: "50%",
              animation: "dashSpin 1s linear infinite",
            }}
          />
        </div>

        <h1
          className="font-[family-name:var(--font-display)] mt-8 max-w-xl font-black tracking-[-0.015em] text-foreground"
          style={{
            fontSize: "clamp(1.75rem, 4vw, 2.6rem)",
            lineHeight: 1,
            textWrap: "balance",
          }}
        >
          Pulling the ledger&hellip;
        </h1>
        <p className="ui mt-3 text-[12px] uppercase tracking-[0.24em] text-foreground/55">
          The Family is gathering your record
        </p>

        <style>{`@keyframes dashSpin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
