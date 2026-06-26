// napoletana-41544 — Editorial restyle of the /articles loading skeleton.
// Mirrors the new masthead so the layout-shift on hydration is minimal.

export default function ArticlesLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground px-5 py-10">
      <div className="mx-auto max-w-[1100px]">
        <div
          className="h-4 w-32 mb-3 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
          style={{ animation: "pulse 1.5s ease-in-out infinite" }}
        />
        <div
          className="h-3 w-40 mb-5 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
          style={{ animation: "pulse 1.5s ease-in-out infinite" }}
        />
        <div
          className="h-14 w-3/4 mb-2 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
          style={{ animation: "pulse 1.5s ease-in-out infinite" }}
        />
        <div
          className="h-14 w-1/2 mb-8 rounded-md bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
          style={{ animation: "pulse 1.5s ease-in-out infinite" }}
        />
        <div className="rule-thick mb-8" />
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-64 paper-soft rounded-[--radius] border border-[hsl(var(--rule-warm)/0.55)] bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
              style={{ animation: "pulse 2s ease-in-out infinite", animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    </div>
  );
}
