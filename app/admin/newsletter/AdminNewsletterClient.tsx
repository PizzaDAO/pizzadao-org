"use client";

import { useCallback, useEffect, useState } from "react";

type Overview = {
  counts: { confirmed: number; pending: number; legacyUnconfirmed: number; unsubscribed: number };
  senderConfigured: boolean;
  resendConfigured: boolean;
  production: boolean;
  confirmEmailsEnabled: boolean;
  memberOptInEnabled: boolean;
};

export function AdminNewsletterClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/newsletter/subscribers", { cache: "no-store" });
      if (!res.ok) throw new Error("load failed");
      setData(await res.json());
    } catch {
      setError("Couldn't load the newsletter overview.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const c = data?.counts;
  return (
    <main className="min-h-screen bg-background text-foreground p-5 max-w-2xl mx-auto grid gap-6 content-start">
      <h1 className="text-2xl font-black m-0">Newsletter</h1>
      {error ? <p role="alert" className="m-0 text-destructive">{error}</p> : null}
      {data ? (
        <>
          {!data.senderConfigured ? (
            <p role="status" className="m-0 rounded-xl border p-3">
              No sender address is configured, so no newsletter email is sent (confirmation emails stay unsent and signups remain
              pending). Set the sender name, address and reply-to under Settings, Newsletter.
            </p>
          ) : null}
          <section className="grid gap-1">
            <h2 className="text-lg font-bold m-0">Subscribers</h2>
            <p className="m-0">Confirmed (mailable): {c!.confirmed}</p>
            <p className="m-0">Pending confirmation: {c!.pending}</p>
            <p className="m-0">Legacy, never confirmed (never mailed; they can re-subscribe from the form): {c!.legacyUnconfirmed}</p>
            <p className="m-0">Unsubscribed: {c!.unsubscribed}</p>
          </section>
          <section className="grid gap-1">
            <h2 className="text-lg font-bold m-0">Switches</h2>
            <p className="m-0">Confirmation emails: {data.confirmEmailsEnabled ? "on" : "off"}</p>
            <p className="m-0">Member checkbox: {data.memberOptInEnabled ? "on" : "off"}</p>
          </section>
        </>
      ) : error ? null : (
        <p className="m-0">Loading…</p>
      )}
    </main>
  );
}
