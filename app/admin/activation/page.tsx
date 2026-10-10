"use client";
import { useEffect, useState } from "react";

type Report = { stages: { event: string; count: number }[]; failures: { code: string; count: number }[]; truncated: boolean };
const labels: Record<string, string> = { signup_started: "Signup started", dm_sent: "DM delivered", discord_verified: "Discord verified", profile_created: "Profile created", first_contribution: "First task claimed or mission submitted" };
export default function ActivationPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { let alive = true; fetch("/api/admin/activation", { cache: "no-store" }).then(async r => { if (!r.ok) throw new Error(r.status === 403 || r.status === 401 ? "Log in with an administrator account to view this report." : "Reporting is unavailable. Please retry."); return r.json(); }).then(r => { if (alive) setReport(r); }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, []);
  return <main className="mx-auto max-w-3xl px-5 py-10"><h1 className="font-display text-4xl font-bold">Member activation</h1><p className="my-4">Signups started in the last 30 days. Each stage counts distinct signup journeys from that cohort; optional steps and retries can make the funnel non-linear.</p>{error && <p role="alert">{error}</p>}{!report && !error && <p role="status">Loading report…</p>}{report && <>{report.truncated && <p role="alert">Showing a partial report: the event limit was reached.</p>}<table className="w-full text-left"><thead><tr><th className="py-3">Stage</th><th>Journeys</th></tr></thead><tbody>{report.stages.map(s => <tr key={s.event} className="border-t border-foreground/20"><td className="py-3">{labels[s.event]}</td><td>{s.count}</td></tr>)}</tbody></table><h2 className="mt-8 text-2xl font-bold">Errors in the last 30 days</h2><p className="my-3">Distinct affected journeys, including returning members. Raw names, cities, message text, tokens, and Discord IDs are excluded.</p>{report.failures.length ? <ul>{report.failures.map(f => <li key={f.code}>{f.code}: {f.count}</li>)}</ul> : <p>No recorded errors.</p>}</>}</main>;
}
