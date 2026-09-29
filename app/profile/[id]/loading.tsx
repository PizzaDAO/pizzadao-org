export default function ProfileLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <div
          className="mx-auto mb-5 h-12 w-12 rounded-full"
          style={{
            border: "4px solid hsl(var(--ink) / 0.10)",
            borderTopColor: "hsl(var(--tomato))",
            animation: "spin 1s linear infinite",
          }}
        />
        <p className="text-lg text-muted-foreground">Loading profile...</p>
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
