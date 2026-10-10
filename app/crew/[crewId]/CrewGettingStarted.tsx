"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { calendarDownload, nextCrewCall } from "@/app/lib/crew-next-call";

type Task = { task: string; stage: string; lead?: string; leadId?: string; notes?: string; url?: string };
export function availableCrewTasks(tasks: Task[]) {
  return tasks.filter(t => typeof t.task === "string" && !!t.task.trim() && !/^(done|skip|skipped|complete|completed|later|backlog)$/i.test(t.stage?.trim()) && !t.leadId?.trim() && (!t.lead?.trim() || ["#N/A", "-", "—"].includes(t.lead.trim()))).sort((a, b) => Number(/beginner|good first|starter/i.test(b.task + " " + b.notes)) - Number(/beginner|good first|starter/i.test(a.task + " " + a.notes))).slice(0, 3);
}
const safeUrl = (url?: string) => url && /^https:\/\//i.test(url) ? url : undefined;
export function CrewGettingStarted({ crew, roster, goals, tasks, user, claimingTask, onClaim }: {
  crew: { id: string; label: string; callTime?: string; callTimeUrl?: string; callLength?: string; channel?: string; sheet?: string };
  roster: { id: string; name: string; status: string }[];
  goals: { description: string }[];
  tasks: Task[];
  user: boolean;
  claimingTask: string | null;
  onClaim: (task: string) => void;
}) {
  const t = useTranslations("crewGettingStarted");
  const locale = useLocale();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => { setNow(new Date()); const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer); }, []);
  const next = now ? nextCrewCall(crew.callTime, now) : null;
  const lead = roster.find(m => !!m.id && /lead|capo/i.test(m.status) && !/iced|inactive/i.test(m.status));
  const open = availableCrewTasks(tasks);
  const channel = safeUrl(crew.channel);
  const meeting = safeUrl(crew.callTimeUrl) || channel;
  const length = Number.parseInt(crew.callLength || "", 10);
  const duration = Number.isFinite(length) && length >= 15 && length <= 240 ? length : 60;
  return <section className="rounded-2xl border border-foreground/15 bg-card p-5 sm:p-6" aria-label={t("title")}>
    <h2 className="font-display text-2xl font-bold">{t("title")}</h2>
    {goals[0]?.description && <p className="mt-3"><strong>{t("focus")}</strong> {goals[0].description}</p>}
    <div className="mt-5 grid gap-6 sm:grid-cols-2">
      <div><h3 className="font-semibold">{t("nextCall")}</h3>{next ? <><p className="mt-2"><time dateTime={next.toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(next)}</time></p><p className="text-sm text-foreground/70">{t("localTime")} · {Intl.DateTimeFormat().resolvedOptions().timeZone}</p><a className="mt-2 inline-flex min-h-11 items-center underline" download={`${crew.id}-call.ics`} href={calendarDownload(`${crew.label} · PizzaDAO`, next, duration, meeting || "https://discord.gg/pizzadao")}>{t("calendar")}</a><p className="text-sm text-foreground/70">{t("scheduleNote", { schedule: crew.callTime || "" })}</p></> : <p className="mt-2">{crew.callTime || t("scheduleMissing")}</p>}{meeting && <a className="mt-2 inline-flex min-h-11 items-center underline" href={meeting} target="_blank" rel="noopener noreferrer">{t("meetingLink")}</a>}</div>
      <div><h3 className="font-semibold">{t("contact")}</h3>{lead ? <Link className="mt-2 inline-flex min-h-11 items-center underline" href={`/profile/${encodeURIComponent(lead.id)}`}>{lead.name}</Link> : <p className="mt-2">{t("contactFallback")}</p>}<a className="mt-2 flex min-h-11 items-center underline" href={channel || "https://discord.gg/pizzadao"} target="_blank" rel="noopener noreferrer">{t(channel ? "chat" : "discord")}</a>{crew.channel && !channel && <p className="text-sm text-foreground/70">#{crew.channel.replace(/^#/, "")}</p>}</div>
    </div>
    <h3 className="mt-6 font-semibold">{t("firstStep")}</h3><p className="mt-2 text-sm text-foreground/80">{t("intro")}</p>
    {open.length > 0 ? <ul className="mt-4 grid gap-3">{open.map(task => <li key={task.task} className="rounded-xl bg-background p-4"><p className="font-semibold break-words">{task.task}</p>{user && crew.sheet ? <button type="button" disabled={claimingTask !== null} className="btn-pill mt-3 min-h-11 bg-foreground text-background" onClick={() => onClaim(task.task)}>{claimingTask === task.task ? t("claiming") : t("claim")}</button> : crew.sheet ? <Link className="mt-2 inline-flex min-h-11 items-center underline" href={`/login?returnTo=${encodeURIComponent(`/crew/${crew.id}`)}`}>{t("login")}</Link> : safeUrl(task.url) ? <a className="mt-2 inline-flex min-h-11 items-center underline" href={safeUrl(task.url)} target="_blank" rel="noopener noreferrer">{t("taskDetails")}</a> : null}</li>)}</ul> : <p className="mt-3 text-sm">{t("noTasks")}</p>}
  </section>;
}
