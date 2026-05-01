export default function ProfileLoading() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: 'var(--color-page-bg)',
      color: 'var(--color-text)',
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 50,
          height: 50,
          border: '4px solid var(--color-spinner-track, #e5e7eb)',
          borderTop: '4px solid var(--color-spinner-active, #3b82f6)',
          borderRadius: "50%",
          animation: "spin 1s linear infinite",
          margin: "0 auto 20px"
        }} />
        <p style={{ fontSize: 18, opacity: 0.8 }}>Loading profile...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  )
}
