"use client";

// The member meme folder (bellpepper-80127): tabs, a cursor-paged grid, an upload dialog, report and delete.
// Plain <img loading="lazy"> on purpose: memes are already size-capped, GIFs must animate, and this keeps
// image-optimizer usage at zero.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { loginHrefFrom } from "@/app/lib/login-return";
import { EmptyState, FilterChip, LoadingLine, paperCard, pillInk, pillOutline } from "@/app/ui/shared/Editorial";

type Tab = "all" | "benny" | "pizzadao" | "mine";
const TABS: Tab[] = ["all", "benny", "pizzadao", "mine"];

export interface MemeItemDto {
  id: string;
  category: string;
  caption: string | null;
  tags: string[];
  status: string;
  url: string | null;
  downloadUrl: string | null;
  width: number | null;
  height: number | null;
  uploader: string;
  mine: boolean;
  note?: string | null;
  createdAt: string;
}
interface Meta {
  canUpload: boolean;
  uploadBlockedReason: "level" | "disavowed" | null;
  minLevel: number | null;
  reviewer: boolean;
  pending: number | null;
}
interface ListReply {
  enabled: boolean;
  items?: MemeItemDto[];
  nextCursor?: string | null;
  meta?: Meta;
}

const inputClass =
  "w-full min-h-11 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.65)] bg-background px-3 py-2 text-base text-foreground placeholder:text-foreground/45 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring)/0.4)]";

const STATUS_KEY: Record<string, string> = { PENDING: "statusPending", APPROVED: "statusApproved", HIDDEN: "statusHidden", REJECTED: "statusRejected", DELETED: "statusDeleted" };

export default function MemeFolder() {
  const t = useTranslations("memes");
  const pathname = usePathname() || "/memes";
  const [tab, setTab] = useState<Tab>("all");
  const [items, setItems] = useState<MemeItemDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signedOut" | "off" | "error">("loading");
  const [more, setMore] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [flash, setFlash] = useState("");
  const seq = useRef(0);

  const load = useCallback(
    async (which: Tab, after: string | null) => {
      const mine = ++seq.current;
      if (!after) setState("loading");
      try {
        const qs = new URLSearchParams({ tab: which });
        if (after) qs.set("cursor", after);
        else qs.set("meta", "1");
        const res = await fetch(`/api/memes?${qs}`, { cache: "no-store" });
        if (mine !== seq.current) return;
        if (res.status === 401) return setState("signedOut");
        if (!res.ok) return setState("error");
        const data = (await res.json()) as ListReply;
        if (!data.enabled) return setState("off");
        setItems((prev) => (after ? [...prev, ...(data.items ?? [])] : (data.items ?? [])));
        setCursor(data.nextCursor ?? null);
        if (data.meta) setMeta(data.meta);
        setState("ready");
      } catch {
        if (mine === seq.current) setState("error");
      } finally {
        if (mine === seq.current) setMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(tab, null);
  }, [tab, load]);

  async function report(item: MemeItemDto) {
    const reason = window.prompt(t("reportPrompt")) ?? null;
    if (reason === null) return;
    const res = await fetch(`/api/memes/${item.id}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
    setFlash(res.ok || res.status === 409 ? t("reportSent") : t("reportFailed"));
  }

  async function remove(item: MemeItemDto) {
    if (!window.confirm(t("deleteConfirm"))) return;
    const res = await fetch(`/api/memes/${item.id}`, { method: "DELETE" });
    if (res.ok) setItems((prev) => prev.filter((m) => m.id !== item.id));
    else setFlash(t("actionFailed"));
  }

  if (state === "loading") return <LoadingLine label={t("loading")} />;
  if (state === "signedOut") {
    return (
      <EmptyState title={t("signIn")}>
        <Link href={loginHrefFrom(pathname)} className={pillInk}>
          {t("signInLink")}
        </Link>
      </EmptyState>
    );
  }
  if (state === "off") return <EmptyState title={t("notAvailable")} />;
  if (state === "error") return <EmptyState title={t("failed")} />;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {TABS.map((id) => (
          <FilterChip key={id} label={t(id === "all" ? "tabAll" : id === "benny" ? "tabBenny" : id === "pizzadao" ? "tabPizzadao" : "tabMine")} active={tab === id} onClick={() => setTab(id)} />
        ))}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {meta?.reviewer && (
            <Link href="/memes/review" className={pillOutline}>
              {meta.pending ? t("reviewQueueCount", { count: meta.pending }) : t("reviewQueue")}
            </Link>
          )}
          {meta?.canUpload && (
            <button type="button" className={pillInk} onClick={() => setUploadOpen(true)}>
              {t("upload")}
            </button>
          )}
        </span>
      </div>

      {meta && !meta.canUpload && (
        <p className="mb-4 text-sm text-muted-foreground">{meta.uploadBlockedReason === "level" ? t("uploadLocked", { level: meta.minLevel ?? 1 }) : t("uploadLockedAccount")}</p>
      )}
      {flash && (
        <p role="status" className="mb-4 text-sm font-semibold">
          {flash}
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState title={tab === "mine" ? t("emptyMine") : t("empty")} />
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-4 p-0 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((m) => (
            <li key={m.id} className={`${paperCard} overflow-hidden`}>
              {m.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.caption ?? ""} width={m.width ?? undefined} height={m.height ?? undefined} loading="lazy" className="block h-auto w-full bg-foreground/5" />
              ) : (
                <div className="grid aspect-square place-items-center text-sm text-muted-foreground">{t(STATUS_KEY[m.status] ?? "statusDeleted")}</div>
              )}
              <div className="p-3 text-sm">
                {m.caption && <p className="m-0 font-semibold">{m.caption}</p>}
                <p className="m-0 text-muted-foreground">{t("by", { name: m.uploader })}</p>
                {m.tags.length > 0 && <p className="m-0 text-muted-foreground">{m.tags.map((x) => `#${x}`).join(" ")}</p>}
                {tab === "mine" && (
                  <p className="m-0 mt-1 font-semibold">
                    {t(STATUS_KEY[m.status] ?? "statusDeleted")}
                    {m.status === "REJECTED" && m.note ? `: ${m.note}` : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-3">
                  {m.downloadUrl && (
                    <a href={m.downloadUrl} download className="inline-block min-h-11 py-2 underline">
                      {t("download")}
                    </a>
                  )}
                  {m.status === "APPROVED" && !m.mine && (
                    <button type="button" className="min-h-11 cursor-pointer bg-transparent py-2 underline" onClick={() => void report(m)}>
                      {t("report")}
                    </button>
                  )}
                  {m.mine && m.status !== "DELETED" && m.status !== "REJECTED" && (
                    <button type="button" className="min-h-11 cursor-pointer bg-transparent py-2 underline" onClick={() => void remove(m)}>
                      {t("delete")}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className="mt-6 text-center">
          <button
            type="button"
            className={pillOutline}
            disabled={more}
            onClick={() => {
              setMore(true);
              void load(tab, cursor);
            }}
          >
            {t("loadMore")}
          </button>
        </div>
      )}

      {uploadOpen && (
        <UploadDialog
          onClose={() => setUploadOpen(false)}
          onDone={(status) => {
            setUploadOpen(false);
            setFlash(status === "APPROVED" ? t("uploadedLive") : t("uploadedPending"));
            setTab("mine");
            void load("mine", null);
          }}
        />
      )}
    </div>
  );
}

function UploadDialog({ onClose, onDone }: { onClose: () => void; onDone: (status: string) => void }) {
  const t = useTranslations("memes");
  const [category, setCategory] = useState<"benny" | "pizzadao">("pizzadao");
  const [caption, setCaption] = useState("");
  const [tags, setTags] = useState("");
  const [rights, setRights] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !rights) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("category", category);
      body.set("caption", caption);
      body.set("tags", tags);
      body.set("rights", "true");
      const res = await fetch("/api/memes/upload", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { status?: string; error?: string };
      if (res.ok) return onDone(data.status ?? "PENDING");
      setError(data.error || t("uploadFailed"));
    } catch {
      setError(t("uploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={t("uploadTitle")} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <form onSubmit={submit} className={`${paperCard} max-h-[90vh] w-full max-w-md overflow-y-auto p-5`}>
        <h2 className="font-display m-0 mb-4 text-xl font-black">{t("uploadTitle")}</h2>
        <label className="mb-3 block text-sm font-semibold">
          {t("file")}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" required className={`${inputClass} mt-1`} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <fieldset className="mb-3 border-0 p-0">
          <legend className="text-sm font-semibold">{t("category")}</legend>
          <div className="mt-1 flex gap-4">
            {(["pizzadao", "benny"] as const).map((c) => (
              <label key={c} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="category" checked={category === c} onChange={() => setCategory(c)} />
                {t(c === "benny" ? "categoryBenny" : "categoryPizzadao")}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="mb-3 block text-sm font-semibold">
          {t("caption")}
          <input type="text" maxLength={200} value={caption} onChange={(e) => setCaption(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="mb-3 block text-sm font-semibold">
          {t("tags")}
          <input type="text" maxLength={200} value={tags} onChange={(e) => setTags(e.target.value)} className={`${inputClass} mt-1`} />
        </label>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} className="mt-1 h-5 w-5" />
          {t("rights")}
        </label>
        <p className="mb-3 text-xs text-muted-foreground">{t("metadataNote")}</p>
        {error && (
          <p role="alert" className="mb-3 text-sm font-semibold text-tomato-readable">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className={pillOutline} onClick={onClose} disabled={busy}>
            {t("cancel")}
          </button>
          <button type="submit" className={pillInk} disabled={busy || !file || !rights}>
            {busy ? t("uploading") : t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
