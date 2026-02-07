"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { NotificationItem, NotificationData } from "./NotificationItem";

type NotificationBellProps = {
  /** Polling interval in milliseconds. Default: 30000 (30 seconds) */
  pollInterval?: number;
};

function bellButton(hasUnread: boolean): React.CSSProperties {
  return {
    position: "relative",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    transition: "background 0.15s",
    color: hasUnread ? "#2563eb" : "#666",
  };
}

function badge(): React.CSSProperties {
  return {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    padding: "0 4px",
    borderRadius: 8,
    background: "#dc2626",
    color: "white",
    fontSize: 10,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transform: "translate(25%, -25%)",
  };
}

function dropdown(): React.CSSProperties {
  return {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 8,
    width: 320,
    maxHeight: 400,
    overflowY: "auto",
    background: "white",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 12,
    boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
    zIndex: 1000,
  };
}

function header(): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid rgba(0,0,0,0.08)",
  };
}

function headerTitle(): React.CSSProperties {
  return {
    fontSize: 14,
    fontWeight: 700,
    margin: 0,
  };
}

function markAllBtn(): React.CSSProperties {
  return {
    fontSize: 11,
    color: "#2563eb",
    background: "none",
    border: "none",
    cursor: "pointer",
    padding: 0,
    fontWeight: 600,
  };
}

function emptyState(): React.CSSProperties {
  return {
    padding: 24,
    textAlign: "center",
    color: "#999",
    fontSize: 13,
  };
}

export function NotificationBell({ pollInterval = 30000 }: NotificationBellProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationData[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Silent fail - notifications are non-critical
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Polling
  useEffect(() => {
    if (pollInterval <= 0) return;

    const interval = setInterval(fetchNotifications, pollInterval);
    return () => clearInterval(interval);
  }, [fetchNotifications, pollInterval]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleMarkRead = async (notificationId: string) => {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      // Optimistically update UI
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n
        )
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silent fail
    }
  };

  const handleMarkAllRead = async () => {
    if (loading || unreadCount === 0) return;
    setLoading(true);
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      // Optimistically update UI
      setNotifications((prev) =>
        prev.map((n) => ({ ...n, readAt: n.readAt || new Date().toISOString() }))
      );
      setUnreadCount(0);
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (url: string) => {
    setIsOpen(false);
    router.push(url);
  };

  const handleToggle = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={handleToggle}
        style={bellButton(unreadCount > 0)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(0,0,0,0.04)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "none";
        }}
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
      >
        <svg
          width={22}
          height={22}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span style={badge()}>{unreadCount > 99 ? "99+" : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div style={dropdown()}>
          <div style={header()}>
            <h3 style={headerTitle()}>Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                style={markAllBtn()}
                disabled={loading}
              >
                {loading ? "..." : "Mark all as read"}
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div style={emptyState()}>No notifications yet</div>
          ) : (
            <div>
              {notifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkRead={handleMarkRead}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
