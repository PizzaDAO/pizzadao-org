"use client";

import React from "react";

export type NotificationData = {
  id: string;
  type: "BOUNTY_CLAIMED" | "BOUNTY_COMPLETED" | "BOUNTY_COMMENT" | "TASK_ASSIGNED" | "TASK_DUE_SOON" | "VOUCH_ADDED";
  title: string;
  message: string;
  linkUrl: string | null;
  createdAt: string;
  readAt: string | null;
};

type NotificationItemProps = {
  notification: NotificationData;
  onMarkRead: (id: string) => void;
  onNavigate: (url: string) => void;
};

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

function getIcon(type: NotificationData["type"]): React.ReactNode {
  switch (type) {
    case "BOUNTY_CLAIMED":
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "BOUNTY_COMPLETED":
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      );
    case "TASK_ASSIGNED":
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
          <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
        </svg>
      );
    case "TASK_DUE_SOON":
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      );
    case "VOUCH_ADDED":
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      );
    default:
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
  }
}

// Icon palettes — all mapped to design tokens so light/dark mode stays consistent.
function getIconBg(type: NotificationData["type"]): string {
  switch (type) {
    case "BOUNTY_CLAIMED":
    case "TASK_DUE_SOON":
      return "hsl(var(--tomato) / 0.12)";
    case "BOUNTY_COMPLETED":
    case "TASK_ASSIGNED":
      return "hsl(var(--butter) / 0.35)";
    case "VOUCH_ADDED":
      return "hsl(var(--muted))";
    default:
      return "hsl(var(--muted))";
  }
}

function getIconColor(type: NotificationData["type"]): string {
  switch (type) {
    case "BOUNTY_CLAIMED":
    case "TASK_DUE_SOON":
      return "hsl(var(--tomato))";
    case "BOUNTY_COMPLETED":
    case "TASK_ASSIGNED":
    case "VOUCH_ADDED":
      return "hsl(var(--foreground))";
    default:
      return "hsl(var(--muted-foreground))";
  }
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function itemContainer(isRead: boolean): React.CSSProperties {
  return {
    display: "flex",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    transition: "background-color 150ms ease",
    background: isRead ? "transparent" : "hsl(var(--cream-warm))",
    borderBottom: "1px solid hsl(var(--rule) / 0.12)",
    borderLeft: isRead ? "3px solid transparent" : "3px solid hsl(var(--tomato))",
  };
}

function iconWrapper(bg: string, color: string): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: bg,
    color,
  };
}

function contentWrapper(): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
  };
}

function titleStyle(isRead: boolean): React.CSSProperties {
  return {
    fontFamily: "var(--font-sans), system-ui, sans-serif",
    fontSize: 13,
    fontWeight: isRead ? 500 : 700,
    color: isRead
      ? "hsl(var(--muted-foreground))"
      : "hsl(var(--foreground))",
    margin: 0,
    marginBottom: 2,
  };
}

function messageStyle(): React.CSSProperties {
  return {
    fontSize: 12,
    color: "hsl(var(--muted-foreground))",
    margin: 0,
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical" as const,
  };
}

function timeStyle(): React.CSSProperties {
  return {
    fontSize: 10,
    color: "hsl(var(--muted-foreground))",
    marginTop: 4,
    fontFamily: displayFont,
    letterSpacing: "0.02em",
  };
}

export function NotificationItem({ notification, onMarkRead, onNavigate }: NotificationItemProps) {
  const isRead = notification.readAt !== null;
  const iconColor = getIconColor(notification.type);
  const iconBg = getIconBg(notification.type);

  const handleClick = () => {
    if (!isRead) {
      onMarkRead(notification.id);
    }
    if (notification.linkUrl) {
      onNavigate(notification.linkUrl);
    }
  };

  return (
    <div
      style={itemContainer(isRead)}
      onClick={handleClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = isRead
          ? "hsl(var(--muted))"
          : "hsl(var(--cream-warm))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isRead
          ? "transparent"
          : "hsl(var(--cream-warm))";
      }}
    >
      <div style={iconWrapper(iconBg, iconColor)}>{getIcon(notification.type)}</div>
      <div style={contentWrapper()}>
        <p style={titleStyle(isRead)}>{notification.title}</p>
        <p style={messageStyle()}>{notification.message}</p>
        <div style={timeStyle()}>{formatRelativeTime(notification.createdAt)}</div>
      </div>
      {!isRead && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "hsl(var(--tomato))",
            flexShrink: 0,
            alignSelf: "center",
          }}
        />
      )}
    </div>
  );
}
