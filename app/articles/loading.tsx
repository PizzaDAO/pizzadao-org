export default function ArticlesLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground px-5 py-10">
      <div className="mx-auto max-w-[900px]">
        <div
          className="h-10 w-52 mb-8 rounded-[--radius] bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
          style={{ animation: "pulse 2s ease-in-out infinite" }}
        />
        <div
          className="grid gap-5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-52 rounded-[--radius] bg-[hsl(var(--ink)/0.06)] dark:bg-[hsl(var(--cream)/0.06)]"
              style={{ animation: "pulse 2s ease-in-out infinite", animationDelay: `${i * 0.1}s` }}
            />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    </div>
  );
}
