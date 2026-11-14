"use client";

import { useEffect, useState } from "react";

/** The session time in the viewer's own zone; the server-rendered text (in the session's zone) shows first. */
export default function LocalTime({ iso, fallback }: { iso: string; fallback: string }) {
  const [text, setText] = useState(fallback);
  useEffect(() => {
    try {
      setText(
        new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso)),
      );
    } catch {
      /* keep the server text */
    }
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
