"use client";

import { useMemo, useState } from "react";
import SiteNav from "@/app/(marketing)/_site/components/SiteNav";
import Footer from "@/app/(marketing)/_site/components/Footer";
import { AUDIENCE_LABELS, type Audience, type PublicApp, type PublicCatalog, type PublicCodeRef, type PublicEntry, type PublicStatus } from "@/app/lib/features/types";

type Props = {
  catalog: PublicCatalog;
  intro: string;
  contributeUrl: string;
  /** Whether the machine-readable exports are live (their links are hidden otherwise). */
  exportEnabled: boolean;
};

const TABS: Audience[] = ["members", "hosts", "partners", "builders", "crews"];
const STATUSES: { key: PublicStatus; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "beta", label: "Beta" },
  { key: "soon", label: "Coming soon" },
];
const DEFAULT_INTRO =
  "Everything PizzaDAO has built for members, event hosts, pizzerias and builders, with a live link and the code behind each feature.";

function statusLabel(e: PublicEntry): string {
  if (e.status === "soon") return e.code.length > 0 && e.code.every((c) => c.private) ? "Private, coming soon" : "Coming soon";
  return e.status === "beta" ? "Beta" : "Live";
}

function LicenseChip({ license }: { license: string | null | undefined }) {
  return license ? (
    <span className="rounded-full border border-ink/25 px-2 py-0.5 text-[11px] text-ink/70">{license}</span>
  ) : (
    <span className="rounded-full border border-tomato/50 bg-tomato/10 px-2 py-0.5 text-[11px] text-tomato">No license, ask first</span>
  );
}

function CodeList({ code }: { code: PublicCodeRef[] }) {
  if (code.length === 0) return null;
  const allPrivate = code.every((c) => c.private);
  if (allPrivate) {
    return <p className="mt-3 text-[12.5px] text-ink/60">Private repositories: no public code yet.</p>;
  }
  return (
    <details className="mt-3 text-[13px]">
      <summary className="cursor-pointer select-none font-medium text-ink/80 hover:text-tomato">Code ({code.filter((c) => !c.private).length})</summary>
      <ul className="mt-2 grid gap-1.5">
        {code.map((c, i) =>
          c.private ? (
            <li key={i} className="text-ink/55">Private repository</li>
          ) : (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <a className="break-all underline decoration-ink/30 hover:text-tomato" href={c.url} target="_blank" rel="noopener noreferrer">
                {c.path ? `${c.repo.replace(/^PizzaDAO\//, "")}/${c.path}` : c.repo}
              </a>
              <LicenseChip license={c.license} />
            </li>
          ),
        )}
      </ul>
    </details>
  );
}

function Card({ e, app }: { e: PublicEntry; app: PublicApp | undefined }) {
  return (
    <li className="flex flex-col rounded-2xl border border-ink/15 bg-white/60 p-4 md:p-5" data-testid="feature-card">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded-full bg-ink px-2 py-0.5 text-cream">{app?.name ?? e.app}</span>
        <span className={`rounded-full px-2 py-0.5 ${e.status === "live" ? "bg-emerald-600/15 text-emerald-800" : "bg-butter/60 text-ink"}`}>{statusLabel(e)}</span>
      </div>
      <h3 className="font-serif mt-3 text-lg font-bold leading-snug text-ink">{e.title}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-ink/75">{e.summary}</p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-ink/60">
        {e.audiences.map((a) => (
          <span key={a} className="rounded-full border border-ink/15 px-2 py-0.5">{AUDIENCE_LABELS[a]}</span>
        ))}
        {e.access !== "public" && e.access !== "admin" && <span className="rounded-full border border-ink/15 px-2 py-0.5">Members only</span>}
      </div>
      {e.url && (
        <a className="mk-btn-pill mt-3 self-start bg-ink text-cream hover:bg-tomato" href={e.url} target="_blank" rel="noopener noreferrer">
          Open
        </a>
      )}
      <CodeList code={e.code} />
    </li>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-[13px] transition-colors ${on ? "border-ink bg-ink text-cream" : "border-ink/25 text-ink/75 hover:border-ink"}`}
    >
      {children}
    </button>
  );
}

export default function FeaturesView({ catalog, intro, contributeUrl, exportEnabled }: Props) {
  const [audience, setAudience] = useState<Audience | "all">("all");
  const [appFilter, setAppFilter] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Set<PublicStatus>>(new Set(["live", "beta", "soon"]));
  const [q, setQ] = useState("");

  const appBySlug = useMemo(() => new Map(catalog.apps.map((a) => [a.slug, a])), [catalog.apps]);
  const hasOps = catalog.entries.some((e) => e.ops);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return catalog.entries.filter((e) => {
      if (audience !== "all" && !e.audiences.includes(audience)) return false;
      if (appFilter && e.app !== appFilter) return false;
      if (!statuses.has(e.status)) return false;
      if (needle) {
        const hay = `${e.title} ${e.summary} ${appBySlug.get(e.app)?.name ?? ""} ${e.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [catalog.entries, audience, appFilter, statuses, q, appBySlug]);

  const isGame = (e: PublicEntry) => appBySlug.get(e.app)?.kind === "game";
  const isBuilderOnly = (e: PublicEntry) => !e.ops && e.audiences.length > 0 && e.audiences.every((a) => a === "builders");
  const games = visible.filter(isGame);
  const ops = visible.filter((e) => e.ops && !isGame(e));
  const builders = visible.filter((e) => isBuilderOnly(e) && !isGame(e));
  const main = visible.filter((e) => !isGame(e) && !e.ops && !isBuilderOnly(e));

  const toggleStatus = (s: PublicStatus) =>
    setStatuses((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  const grid = (list: PublicEntry[]) => (
    <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((e) => (
        <Card key={e.slug} e={e} app={appBySlug.get(e.app)} />
      ))}
    </ul>
  );

  return (
    <main className="relative min-h-[100svh] bg-cream text-ink">
      <SiteNav solid />
      <section className="pt-28 md:pt-36">
        <div className="container">
          <p className="mk-overline text-tomato">§ What we have built</p>
          <h1 className="font-serif mt-3 text-4xl font-bold leading-tight md:text-6xl">What we have built</h1>
          <p className="font-serif mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink/70 md:text-lg">{intro || DEFAULT_INTRO}</p>
          {exportEnabled && (
            <p className="mt-3 text-[13px] text-ink/60">
              For AI agents: <a className="underline" href="/llms.txt">llms.txt</a>, <a className="underline" href="/features.md">features.md</a>,{" "}
              <a className="underline" href="/features.json">features.json</a>.
            </p>
          )}

          <div className="mt-8 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Audience">
            <Chip on={audience === "all"} onClick={() => setAudience("all")}>Everyone</Chip>
            {TABS.map((t) => (
              <Chip key={t} on={audience === t} onClick={() => setAudience(t)}>{AUDIENCE_LABELS[t]}</Chip>
            ))}
            {hasOps && <Chip on={audience === "ops"} onClick={() => setAudience("ops")}>{AUDIENCE_LABELS.ops}</Chip>}
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="App">
            <Chip on={appFilter === null} onClick={() => setAppFilter(null)}>All apps</Chip>
            {catalog.apps.map((a) => (
              <Chip key={a.slug} on={appFilter === a.slug} onClick={() => setAppFilter(appFilter === a.slug ? null : a.slug)}>{a.name}</Chip>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex gap-2" role="group" aria-label="Status">
              {STATUSES.map((s) => (
                <Chip key={s.key} on={statuses.has(s.key)} onClick={() => toggleStatus(s.key)}>{s.label}</Chip>
              ))}
            </div>
            <label className="flex-1 min-w-[200px]">
              <span className="sr-only">Search features</span>
              <input
                type="search"
                value={q}
                onChange={(ev) => setQ(ev.target.value)}
                placeholder="Search features"
                className="w-full rounded-full border border-ink/25 bg-white/70 px-4 py-2 text-[14px] outline-none focus:border-ink"
              />
            </label>
          </div>
          <p className="mt-3 text-[12.5px] text-ink/55" aria-live="polite">{visible.length} {visible.length === 1 ? "feature" : "features"}</p>
        </div>
      </section>

      <section className="pb-20 pt-6">
        <div className="container grid gap-12">
          {visible.length === 0 && <p className="text-ink/60">Nothing matches. Try clearing a filter.</p>}

          {main.length > 0 && <div id="features">{grid(main)}</div>}

          {builders.length > 0 && (
            <div id="builders">
              <h2 className="font-serif text-2xl font-bold md:text-3xl">For builders</h2>
              <p className="mt-2 max-w-[62ch] text-[14.5px] text-ink/70">
                Pieces you can reuse. Check the license chip first: where a repo has no license file, ask before copying code.
                {contributeUrl && (
                  <>
                    {" "}
                    <a className="underline" href={contributeUrl} target="_blank" rel="noopener noreferrer">Want to contribute?</a>
                  </>
                )}
              </p>
              {grid(builders)}
            </div>
          )}

          {games.length > 0 && (
            <div id="games">
              <h2 className="font-serif text-2xl font-bold md:text-3xl">Games &amp; experiments</h2>
              {grid(games)}
            </div>
          )}

          {ops.length > 0 && (
            <div id="ops">
              <h2 className="font-serif text-2xl font-bold md:text-3xl">How we run the DAO</h2>
              <p className="mt-2 max-w-[62ch] text-[14.5px] text-ink/70">The admin and operations tools behind the scenes.</p>
              {grid(ops)}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </main>
  );
}
