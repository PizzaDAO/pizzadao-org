export default function ArticlesLoading() {
  return (
    <div style={{
      minHeight: "100vh",
      background: 'var(--color-page-bg)',
      padding: "40px 20px",
    }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div style={{
          height: 40,
          width: 200,
          background: 'var(--color-surface, #f3f4f6)',
          borderRadius: 8,
          marginBottom: 32,
          animation: "pulse 2s ease-in-out infinite",
        }} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 20 }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{
              height: 200,
              borderRadius: 12,
              background: 'var(--color-surface, #f3f4f6)',
              animation: "pulse 2s ease-in-out infinite",
              animationDelay: `${i * 0.1}s`,
            }} />
          ))}
        </div>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`}</style>
      </div>
    </div>
  )
}
