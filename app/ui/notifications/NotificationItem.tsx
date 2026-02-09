"use client";

import React from "react";

export type NotificationData = {
  id: string;
  type: "BOUNTY_CLAIMED" | "BOUNTY_COMPLETED" | "TASK_ASSIGNED" | "TASK_DUE_SOON";
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
    default:
      return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      );
  }
}

function getIconColor(type: NotificationData["type"]): string {
  switch (type) {
    case "BOUNTY_CLAIMED":
      return "#ca8a04"; // Yellow
    case "BOUNTY_COMPLETED":
      return "#16a34a"; // Green
    case "TASK_ASSIGNED":
      return "#2563eb"; // Blue
    case "TASK_DUE_SOON":
      return "#dc2626"; // Red
    default:
      return "#666";
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
    transition: "background 0.15s",
    background: isRead ? "transparent" : "rgba(37,99,235,0.04)",
    borderBottom: '1px solid var(--color-divider)',
  };
}

function iconWrapper(color: string): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    background: `${color}15`,
    color: color,
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
    fontSize: 13,
    fontWeight: isRead ? 500 : 650,
    color: isRead ? "#666" : "#111",
    margin: 0,
    marginBottom: 2,
  };
}

function messageStyle(isRead: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    color: isRead ? "#999" : "#666",
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
    color: "#9ca3af",
    marginTop: 4,
  };
}

export function NotificationItem({ notification, onMarkRead, onNavigate }: NotificationItemProps) {
  const isRead = notification.readAt !== null;
  const iconColor = getIconColor(notification.type);

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
        e.currentTarget.style.background = isRead ? "rgba(0,0,0,0.02)" : "rgba(37,99,235,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isRead ? "transparent" : "rgba(37,99,235,0.04)";
      }}
    >
      <div style={iconWrapper(iconColor)}>{getIcon(notification.type)}</div>
      <div style={contentWrapper()}>
        <p style={titleStyle(isRead)}>{notification.title}</p>
        <p style={messageStyle(isRead)}>{notification.message}</p>
        <div style={timeStyle()}>{formatRelativeTime(notification.createdAt)}</div>
      </div>
      {!isRead && (
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#2563eb",
            flexShrink: 0,
            alignSelf: "center",
          }}
        />
      )}
    </div>
  );
}
