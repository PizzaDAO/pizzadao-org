export default function DashboardLoading() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: 'hsl(var(--background))',
      color: 'hsl(var(--foreground))',
      fontFamily: "var(--font-sans), system-ui, sans-serif",
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 50,
          height: 50,
          border: '4px solid hsl(var(--ink) / 0.10)',
          borderTop: '4px solid hsl(var(--tomato))',
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          margin: "0 auto 20px"
        }} />
        <p style={{
          fontSize: 18,
          fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
          fontWeight: 600,
          color: "hsl(var(--muted-foreground))",
        }}>Loading dashboard...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
