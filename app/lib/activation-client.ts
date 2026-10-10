"use client";
export function trackActivation(event: "signup_started" | "client_error", actor: string, code = "") {
  void fetch("/api/activation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, actor, code }), keepalive: true }).catch(() => {});
}
