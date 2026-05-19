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
      <div className="text-center py-10">
        <div
          className="spinner mx-auto mb-5 w-10 h-10 rounded-full border-[3px] border-rule"
          style={{
            borderTopColor: "hsl(var(--tomato))",
            animation: "spin 1s linear infinite",
          }}
        />
        <p className="text-lg text-muted-foreground font-[family-name:var(--font-display)]">
          {displayMessage}
        </p>
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
