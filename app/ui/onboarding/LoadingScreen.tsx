// app/ui/onboarding/LoadingScreen.tsx
"use client";

import { card } from "./styles";
import type { FlowState } from "./types";

type Props = {
  message?: string;
  flow?: FlowState;
};

function getMessageFromFlow(flow: FlowState): string {
  switch (flow.type) {
    case "initializing":
      return "Loading...";
    case "checking_session":
      return "Checking session...";
    case "looking_up_member":
      return "Verifying member status...";
    case "submitting":
      return "Saving your profile...";
    case "success":
      return "Redirecting...";
    default:
      return "Loading...";
  }
}

export function LoadingScreen({ message, flow }: Props) {
  const displayMessage = message ?? (flow ? getMessageFromFlow(flow) : "Loading...");

  return (
    <div style={card()}>
      <div style={{ textAlign: "center", padding: "40px 0" }}>
        <div
          className="spinner"
          style={{
            width: 40,
            height: 40,
            border: "3px solid rgba(0,0,0,0.1)",
            borderTop: "3px solid #ff4d4d",
            borderRadius: "50%",
            animation: "spin 1s linear infinite",
            margin: "0 auto 20px",
          }}
        />
        <p style={{ fontSize: 18, opacity: 0.8 }}>{displayMessage}</p>
        <style jsx>{`
          @keyframes spin {
            0% {
              transform: rotate(0deg);
            }
            100% {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    </div>
  );
}
