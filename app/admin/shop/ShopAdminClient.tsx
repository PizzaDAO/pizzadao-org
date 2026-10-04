"use client";

// app/admin/shop/ShopAdminClient.tsx
//
// /admin/shop UI: item list (stock, sold, held), create / edit, restock /
// adjust, hide / show, delete (only for items with no history), grant /
// remove items to / from members, and the audit log. All writes go through
// /api/admin/shop/*, which re-checks shop-admin access and validates input.

import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Eye, EyeOff, Gift, Minus, PackagePlus, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import type { ShopAdminEventView, ShopAdminItem } from "@/app/lib/shop-admin";
import type { PeopleLabels } from "@/app/lib/shop-admin-people";
import { SHOP_LIMITS } from "@/app/lib/shop-admin-shared";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  FilterChip,
  SectionHeading,
  paperCard,
  pillInk,
  pillOutline,
  pillTomato,
} from "@/app/ui/shared/Editorial";

type Overview = { items: ShopAdminItem[]; events: ShopAdminEventView[]; people: PeopleLabels };
type Filter = "all" | "sale" | "hidden" | "collectible";

const fieldClass =
  "w-full min-h-11 rounded-[var(--radius)] border border-[hsl(var(--rule)/0.22)] bg-background text-foreground px-3 py-2 text-base outline-none focus:border-[hsl(var(--ring))] focus:shadow-[0_0_0_3px_hsl(var(--ring)/0.2)]";

const fmt = (n: number) => n.toLocaleString("en-US");
const stockLabel = (q: number) => (q === -1 ? "∞" : fmt(q));

async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data?.error || `Request failed (${res.status})`));
  return data as T;
}

function newRequestId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

// ------------------------------------------------------------ bits ---

function Badge({ tone, children }: { tone: "ok" | "muted" | "butter" | "tomato"; children: ReactNode }) {
  const tones = {
    ok: "bg-[hsl(142_71%_35%/0.12)] text-[hsl(142_60%_30%)] dark:text-[hsl(142_60%_70%)] border-[hsl(142_71%_35%/0.35)]",
    muted: "bg-[hsl(var(--foreground)/0.06)] text-foreground/65 border-[hsl(var(--foreground)/0.18)]",
    butter: "bg-[hsl(var(--butter)/0.35)] text-foreground border-[hsl(var(--butter)/0.8)]",
    tomato: "bg-[hsl(var(--tomato)/0.10)] text-tomato border-[hsl(var(--tomato)/0.35)]",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.06em] ${tones[tone]}`}>
      {children}
    </span>
  );
}

function Notice({ kind, children, onClose }: { kind: "error" | "ok"; children: ReactNode; onClose?: () => void }) {
  const cls =
    kind === "error"
      ? "bg-[hsl(var(--tomato)/0.08)] border-[hsl(var(--tomato)/0.3)] text-tomato"
      : "bg-[hsl(142_71%_35%/0.10)] border-[hsl(142_71%_35%/0.3)] text-[hsl(142_60%_28%)] dark:text-[hsl(142_60%_70%)]";
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`flex items-start justify-between gap-3 rounded-[var(--radius)] border p-3 text-sm ${cls}`}>
      <span>{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="bg-transparent border-0 cursor-pointer text-current p-0">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-semibold text-foreground">{label}</span>
      {children}
      {hint && <span className="text-xs text-foreground/55">{hint}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`flex items-center gap-2.5 text-sm font-semibold ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input type="checkbox" className="h-5 w-5 accent-[hsl(var(--tomato))]" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Thumb({ src, name, size = 56 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) {
    return (
      <div
        aria-hidden
        className="grid shrink-0 place-items-center rounded-xl border border-[hsl(var(--rule-warm)/0.55)] bg-[hsl(var(--butter)/0.25)] font-display font-black text-foreground/60"
        style={{ width: size, height: size, fontSize: size / 2.6 }}
      >
        {name.slice(0, 1).toUpperCase()}
      </div>
    );
  }
  return (
    // Arbitrary admin-supplied hosts, so a plain <img> (next/image would reject them).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setBroken(true)}
      className="shrink-0 rounded-xl border border-[hsl(var(--rule-warm)/0.55)] object-cover bg-card"
      style={{ width: size, height: size }}
    />
  );
}

function Modal({ title, overline, onClose, children }: { title: string; overline: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[hsl(var(--ink)/0.45)] px-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className={`${paperCard} w-full max-w-lg p-6 shadow-[var(--shadow-lifted)]`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="overline text-tomato m-0">§ ··· {overline}</p>
            <h2 className="font-display text-2xl font-black tracking-tight mt-1 mb-0">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="bg-transparent border-0 cursor-pointer text-foreground/60 hover:text-foreground p-1">
            <X size={20} />
          </button>
        </div>
        <div className="rule-warm my-4" />
        {children}
      </div>
    </div>
  );
}

// --------------------------------------------------------- item form ---

type ItemForm = {
  name: string;
  description: string;
  price: string;
  unlimited: boolean;
  stock: string;
  image: string;
  isAvailable: boolean;
  isCollectible: boolean;
  reason: string;
};

const blankForm: ItemForm = {
  name: "",
  description: "",
  price: "",
  unlimited: true,
  stock: "0",
  image: "",
  isAvailable: true,
  isCollectible: false,
  reason: "",
};

const formFrom = (i: ShopAdminItem): ItemForm => ({
  name: i.name,
  description: i.description ?? "",
  price: String(i.price),
  unlimited: i.quantity === -1,
  stock: i.quantity === -1 ? "0" : String(i.quantity),
  image: i.image ?? "",
  isAvailable: i.isAvailable,
  isCollectible: i.isCollectible,
  reason: "",
});

function ItemEditor({ item, onDone, onClose }: { item: ShopAdminItem | null; onDone: (msg: string) => void; onClose: () => void }) {
  const [form, setForm] = useState<ItemForm>(item ? formFrom(item) : blankForm);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof ItemForm>(k: K, v: ItemForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { url } = await api<{ url: string }>("/api/admin/shop/upload", { method: "POST", body: fd });
      set("image", url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name,
      description: form.description,
      price: form.price.trim() === "" ? null : Number(form.price),
      quantity: form.unlimited ? -1 : form.stock.trim() === "" ? null : Number(form.stock),
      image: form.image,
      isAvailable: form.isCollectible ? false : form.isAvailable,
      isCollectible: form.isCollectible,
      ...(item ? { expectedQuantity: item.quantity, reason: form.reason } : {}),
    };
    try {
      if (item) {
        await api(`/api/admin/shop/items/${item.id}`, { method: "PATCH", json: body });
        onDone(`Saved ${form.name.trim()}.`);
      } else {
        await api(`/api/admin/shop/items`, { method: "POST", json: body });
        onDone(`Created ${form.name.trim()}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item ? `Edit ${item.name}` : "New item"} overline={item ? "Edit item" : "Create"} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        {error && <Notice kind="error">{error}</Notice>}
        <Field label="Name" hint={item ? "Renaming is fine: holdings and history follow the item, not the name." : undefined}>
          <input className={fieldClass} value={form.name} maxLength={SHOP_LIMITS.nameMax} required onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Description" hint={`${form.description.length}/${SHOP_LIMITS.descriptionMax}`}>
          <textarea className={fieldClass} rows={3} value={form.description} maxLength={SHOP_LIMITS.descriptionMax} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Price ($PEP)" hint={item ? "Affects future purchases only." : "A positive whole number."}>
            <input className={fieldClass} type="number" inputMode="numeric" min={1} max={SHOP_LIMITS.priceMax} step={1} required value={form.price} onChange={(e) => set("price", e.target.value)} />
          </Field>
          <Field label="Stock" hint={form.unlimited ? "Unlimited (∞)." : item ? "Use Restock / Adjust for +/- changes with a reason." : "0 or more."}>
            <div className="grid gap-2">
              <Toggle checked={form.unlimited} onChange={(v) => set("unlimited", v)} label="Unlimited" />
              {!form.unlimited && (
                <input className={fieldClass} type="number" inputMode="numeric" min={0} max={SHOP_LIMITS.stockMax} step={1} required value={form.stock} onChange={(e) => set("stock", e.target.value)} aria-label="Stock count" />
              )}
            </div>
          </Field>
        </div>
        <Field label="Image URL" hint="https:// link, or upload a PNG / JPEG / WebP / GIF (max 5 MB).">
          <div className="flex items-center gap-3">
            <Thumb src={form.image || null} name={form.name || "?"} size={44} />
            <input className={fieldClass} type="url" placeholder="https://…" value={form.image} maxLength={SHOP_LIMITS.imageUrlMax} onChange={(e) => set("image", e.target.value)} />
          </div>
          <div className="mt-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <button type="button" className={`${pillOutline} !min-h-9 text-sm`} disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Upload size={14} aria-hidden /> {uploading ? "Uploading…" : "Upload image"}
            </button>
          </div>
        </Field>
        <div className="grid gap-2 rounded-[var(--radius)] border border-[hsl(var(--rule-warm)/0.55)] p-3">
          <Toggle checked={form.isCollectible ? false : form.isAvailable} disabled={form.isCollectible} onChange={(v) => set("isAvailable", v)} label="On sale (shown in the shop and /shop)" />
          <Toggle checked={form.isCollectible} onChange={(v) => set("isCollectible", v)} label="Collectible (can be held or granted, never bought)" />
          {form.isCollectible && <p className="m-0 text-xs text-foreground/60">Collectibles are never purchasable, so they are always off sale.</p>}
        </div>
        {item && (
          <Field label="Reason (optional)" hint="Saved in the audit log.">
            <input className={fieldClass} value={form.reason} maxLength={SHOP_LIMITS.reasonMax} onChange={(e) => set("reason", e.target.value)} />
          </Field>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={pillOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={pillInk} disabled={busy || uploading}>
            {busy ? "Saving…" : item ? "Save changes" : "Create item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------- stock form ---

function StockEditor({ item, onDone, onClose }: { item: ShopAdminItem; onDone: (msg: string) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(amount);
  const next = Number.isInteger(n) && n > 0 ? item.quantity + (mode === "add" ? n : -n) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const delta = mode === "add" ? Number(amount) : -Number(amount);
      const { item: updated } = await api<{ item: { quantity: number } }>(`/api/admin/shop/items/${item.id}/stock`, {
        method: "POST",
        json: { delta, reason },
      });
      onDone(`${item.name}: stock ${fmt(item.quantity)} → ${fmt(updated.quantity)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stock change failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={item.name} overline="Restock / adjust" onClose={onClose}>
      {item.quantity === -1 ? (
        <p className="m-0 text-sm text-foreground/70">This item has unlimited stock. To track a count, edit it and turn off Unlimited.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          {error && <Notice kind="error">{error}</Notice>}
          <p className="m-0 text-sm">
            In stock now: <strong className="tabular-nums">{fmt(item.quantity)}</strong>
          </p>
          <div className="flex gap-2">
            <FilterChip label="Restock (+)" active={mode === "add"} onClick={() => setMode("add")} />
            <FilterChip label="Adjust down (−)" active={mode === "remove"} onClick={() => setMode("remove")} />
          </div>
          <Field label="Units" hint={next !== null ? `New stock: ${next < 0 ? "below 0 (not allowed)" : fmt(next)}` : `1 to ${fmt(SHOP_LIMITS.qtyMax)}`}>
            <input className={fieldClass} type="number" inputMode="numeric" min={1} max={SHOP_LIMITS.qtyMax} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Reason" hint={`Required, ${SHOP_LIMITS.reasonMin}-${SHOP_LIMITS.reasonMax} characters.`}>
            <input className={fieldClass} required minLength={SHOP_LIMITS.reasonMin} maxLength={SHOP_LIMITS.reasonMax} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === "add" ? "New batch arrived" : "Damaged in shipping"} />
          </Field>
          <div className="flex justify-end gap-2">
            <button type="button" className={pillOutline} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className={pillInk} disabled={busy}>
              {busy ? "Saving…" : mode === "add" ? "Restock" : "Adjust down"}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ------------------------------------------------- grant / remove form ---

function MemberItemPanel({ items, preset, onDone }: { items: ShopAdminItem[]; preset: number | null; onDone: (msg: string) => void }) {
  const [recipient, setRecipient] = useState("");
  const [itemId, setItemId] = useState<string>(preset ? String(preset) : "");
  const [qty, setQty] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"grant" | "remove" | "check" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [holding, setHolding] = useState<{ discordId: string; hasAccount: boolean; held: number; pending: number } | null>(null);
  // One idempotency key per intended grant: a double click or retry lands once.
  const requestId = useRef(newRequestId());

  const [lastPreset, setLastPreset] = useState(preset);
  if (preset !== lastPreset) {
    setLastPreset(preset);
    if (preset) setItemId(String(preset));
  }

  const ready = recipient.trim() && itemId;

  const check = async () => {
    if (!ready) return;
    setBusy("check");
    setError(null);
    try {
      const q = new URLSearchParams({ recipient: recipient.trim(), itemId });
      setHolding(await api(`/api/admin/shop/holding?${q}`));
    } catch (e) {
      setHolding(null);
      setError(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setBusy(null);
    }
  };

  const act = async (kind: "grant" | "remove") => {
    setBusy(kind);
    setError(null);
    try {
      const body = { recipient: recipient.trim(), itemId: Number(itemId), quantity: Number(qty), reason };
      if (kind === "grant") {
        const r = await api<{ status: string; itemName: string; quantity: number; discordId: string }>("/api/admin/shop/grants", {
          method: "POST",
          json: { ...body, requestId: requestId.current },
        });
        onDone(
          r.status === "held"
            ? `Granted ${r.quantity} × ${r.itemName} to ${r.discordId}. They have no app account yet, so it's held until they sign up.`
            : r.status === "duplicate"
              ? `That grant was already recorded (no change).`
              : `Granted ${r.quantity} × ${r.itemName} to ${r.discordId}.`,
        );
      } else {
        const r = await api<{ itemName: string; removed: number; remaining: number; discordId: string }>("/api/admin/shop/removals", {
          method: "POST",
          json: body,
        });
        onDone(`Removed ${r.removed} × ${r.itemName} from ${r.discordId} (${r.remaining} left).`);
      }
      requestId.current = newRequestId();
      setReason("");
      setHolding(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  const valid = ready && Number.isInteger(Number(qty)) && Number(qty) > 0 && reason.trim().length >= SHOP_LIMITS.reasonMin;

  return (
    <section id="grant" className={`${paperCard} p-5 md:p-6`} aria-labelledby="grant-heading">
      <p className="overline text-tomato m-0">§ ··· Members</p>
      <h2 id="grant-heading" className="font-display text-2xl font-black tracking-tight mt-1 mb-1">
        Grant or remove an item
      </h2>
      <p className="m-0 mb-4 text-sm text-foreground/65">
        Any item, including hidden ones and collectibles. Grants don&apos;t use shop stock or anyone&apos;s $PEP. A member with no app account yet gets the
        grant held until they sign up.
      </p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          act("grant");
        }}
      >
        {error && <Notice kind="error" onClose={() => setError(null)}>{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Member" hint="PizzaDAO member ID or Discord ID.">
            <input
              className={fieldClass}
              value={recipient}
              inputMode="numeric"
              maxLength={20}
              onChange={(e) => {
                setRecipient(e.target.value);
                setHolding(null);
              }}
              onBlur={check}
              placeholder="e.g. 1234 or 81234567890123456"
            />
          </Field>
          <Field label="Item">
            <select
              className={fieldClass}
              value={itemId}
              onChange={(e) => {
                setItemId(e.target.value);
                setHolding(null);
              }}
            >
              <option value="">Choose an item…</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.isCollectible ? " (collectible)" : !i.isAvailable ? " (hidden)" : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input className={fieldClass} type="number" inputMode="numeric" min={1} max={SHOP_LIMITS.qtyMax} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </Field>
          <Field label="Reason" hint="Required. Saved with the grant and in the audit log.">
            <input className={fieldClass} value={reason} minLength={SHOP_LIMITS.reasonMin} maxLength={SHOP_LIMITS.reasonMax} onChange={(e) => setReason(e.target.value)} placeholder="Event prize" />
          </Field>
        </div>
        {holding && (
          <p className="m-0 text-sm text-foreground/75" role="status">
            Discord {holding.discordId}: holds <strong>{fmt(holding.held)}</strong>
            {holding.pending > 0 && <> (+{fmt(holding.pending)} pending signup)</>}
            {!holding.hasAccount && <> · no app account yet</>}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={pillInk} disabled={!valid || !!busy}>
            <Gift size={16} aria-hidden /> {busy === "grant" ? "Granting…" : "Grant"}
          </button>
          <button type="button" className={pillOutline} disabled={!valid || !!busy} onClick={() => act("remove")}>
            <Minus size={16} aria-hidden /> {busy === "remove" ? "Removing…" : "Remove"}
          </button>
          <button type="button" className={`${pillOutline} !border-transparent`} disabled={!ready || !!busy} onClick={check}>
            {busy === "check" ? "Checking…" : "Check holding"}
          </button>
        </div>
      </form>
    </section>
  );
}

// ------------------------------------------------------------ audit ---

const ACTION_LABEL: Record<ShopAdminEventView["action"], string> = {
  CREATE: "Created",
  UPDATE: "Edited",
  HIDE: "Hidden",
  SHOW: "Shown",
  DELETE: "Deleted",
  RESTOCK: "Restocked",
  ADJUST_STOCK: "Adjusted down",
  GRANT: "Granted",
  REMOVE: "Removed",
};

const ACTION_TONE: Record<ShopAdminEventView["action"], "ok" | "muted" | "butter" | "tomato"> = {
  CREATE: "ok",
  UPDATE: "butter",
  HIDE: "muted",
  SHOW: "ok",
  DELETE: "tomato",
  RESTOCK: "ok",
  ADJUST_STOCK: "tomato",
  GRANT: "ok",
  REMOVE: "tomato",
};

const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : v === -1 ? "∞" : typeof v === "string" ? v : JSON.stringify(v));

function diffLines(e: ShopAdminEventView): string[] {
  const before = (e.before ?? {}) as Record<string, unknown>;
  const after = (e.after ?? {}) as Record<string, unknown>;
  if (e.action === "CREATE" || e.action === "DELETE" || e.action === "GRANT") return [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((k) => `${k}: ${show(before[k])} → ${show(after[k])}`);
}

function Person({ id, people }: { id: string; people: PeopleLabels }) {
  const p = people[id];
  return p ? (
    <span title={`Discord ${id}`}>
      {p.memberId ? (
        <Link href={`/profile/${p.memberId}`} className="underline decoration-[hsl(var(--rule-warm))]">
          {p.name || "Member"}
        </Link>
      ) : (
        p.name || "Member"
      )}{" "}
      <span className="text-foreground/50">{p.memberId ? `member #${p.memberId}` : p.handle ?? ""}</span>
    </span>
  ) : (
    <span className="font-mono text-xs">{id}</span>
  );
}

function AuditLog({ events, people }: { events: ShopAdminEventView[]; people: PeopleLabels }) {
  if (events.length === 0) return <EmptyState title="Nothing logged yet">Every change made on this page shows up here.</EmptyState>;
  return (
    <ol className="m-0 grid list-none gap-0 p-0">
      {events.map((e) => {
        const lines = diffLines(e);
        return (
          <li key={e.id} className="grid gap-1 border-b border-[hsl(var(--rule-warm)/0.45)] py-3 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Badge tone={ACTION_TONE[e.action]}>{ACTION_LABEL[e.action]}</Badge>
              <strong>{e.itemName}</strong>
              {e.quantity !== null && <span className="tabular-nums">× {fmt(e.quantity)}</span>}
              {e.targetId && (
                <span className="text-foreground/70">
                  {e.action === "REMOVE" ? "from" : "to"} <Person id={e.targetId} people={people} />
                </span>
              )}
              {e.action === "GRANT" && (e.after as { status?: string } | null)?.status === "PENDING" && <Badge tone="butter">held until signup</Badge>}
            </div>
            {lines.length > 0 && (
              <ul className="m-0 list-none p-0 text-xs text-foreground/70">
                {lines.map((l) => (
                  <li key={l} className="break-words">
                    {l}
                  </li>
                ))}
              </ul>
            )}
            {e.reason && <p className="m-0 text-sm italic text-foreground/80">“{e.reason}”</p>}
            <p className="m-0 text-xs text-foreground/50">
              <Person id={e.actorId} people={people} /> · <time dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleString()}</time>
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ------------------------------------------------------------- page ---

export default function ShopAdminClient({ initial }: { initial: Overview }) {
  const [data, setData] = useState<Overview>(initial);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<ShopAdminItem | "new" | null>(null);
  const [stocking, setStocking] = useState<ShopAdminItem | null>(null);
  const [grantPreset, setGrantPreset] = useState<number | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<{ kind: "hide" | "delete"; item: ShopAdminItem } | null>(null);
  const [hideReason, setHideReason] = useState("");

  const reload = async () => {
    try {
      setData(await api<Overview>("/api/admin/shop"));
    } catch (e) {
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Could not reload" });
    }
  };

  const done = (text: string) => {
    setEditing(null);
    setStocking(null);
    setNotice({ kind: "ok", text });
    void reload();
  };

  const setVisible = async (item: ShopAdminItem, visible: boolean, reason = "") => {
    setRowBusy(item.id);
    try {
      await api(`/api/admin/shop/items/${item.id}/visibility`, { method: "POST", json: { visible, reason } });
      setConfirming(null);
      done(`${item.name} is now ${visible ? "on sale" : "hidden"}.`);
    } catch (e) {
      setConfirming(null);
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Failed" });
    } finally {
      setRowBusy(null);
    }
  };

  const remove = async (item: ShopAdminItem) => {
    setRowBusy(item.id);
    try {
      await api(`/api/admin/shop/items/${item.id}`, { method: "DELETE" });
      setConfirming(null);
      done(`Deleted ${item.name}.`);
    } catch (e) {
      setConfirming(null);
      setNotice({ kind: "error", text: e instanceof Error ? e.message : "Delete failed" });
    } finally {
      setRowBusy(null);
    }
  };

  const counts = useMemo(
    () => ({
      all: data.items.length,
      sale: data.items.filter((i) => i.isAvailable && !i.isCollectible).length,
      hidden: data.items.filter((i) => !i.isAvailable && !i.isCollectible).length,
      collectible: data.items.filter((i) => i.isCollectible).length,
    }),
    [data.items],
  );
  const visibleItems = data.items.filter((i) =>
    filter === "all" ? true : filter === "sale" ? i.isAvailable && !i.isCollectible : filter === "hidden" ? !i.isAvailable && !i.isCollectible : i.isCollectible,
  );

  return (
    <EditorialPage>
      <EditorialMasthead
        overline="Admin · $PEP shop"
        title="Shop admin"
        dek="Add and edit items, restock, hide what's off sale, and give or take items from members. Every change is logged below."
        aside={
          <button type="button" className={pillTomato} onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden /> New item
          </button>
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter items">
          <FilterChip label={`All · ${counts.all}`} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterChip label={`On sale · ${counts.sale}`} active={filter === "sale"} onClick={() => setFilter("sale")} />
          <FilterChip label={`Hidden · ${counts.hidden}`} active={filter === "hidden"} onClick={() => setFilter("hidden")} />
          <FilterChip label={`Collectibles · ${counts.collectible}`} active={filter === "collectible"} onClick={() => setFilter("collectible")} />
        </div>
      </EditorialMasthead>

      {notice && (
        <div className="mb-6">
          <Notice kind={notice.kind} onClose={() => setNotice(null)}>
            {notice.text}
          </Notice>
        </div>
      )}

      <section aria-labelledby="items-heading" className="mb-12">
        <SectionHeading overline="Inventory" title={<span id="items-heading">Items</span>} count={visibleItems.length} />
        {visibleItems.length === 0 ? (
          <EmptyState title="No items here">{filter === "all" ? "Create the first item with New item." : "Try another filter."}</EmptyState>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0">
            {visibleItems.map((item) => (
              <li key={item.id} className={`${paperCard} p-4`}>
                <div className="flex flex-wrap items-start gap-4">
                  <Thumb src={item.image} name={item.name} />
                  <div className="min-w-0 flex-1 basis-[220px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-black tracking-tight m-0 break-words">{item.name}</h3>
                      {item.isCollectible ? (
                        <Badge tone="butter">Collectible</Badge>
                      ) : item.isAvailable ? (
                        <Badge tone="ok">On sale</Badge>
                      ) : (
                        <Badge tone="muted">Hidden</Badge>
                      )}
                      {!item.isCollectible && item.quantity === 0 && <Badge tone="tomato">Sold out</Badge>}
                    </div>
                    {item.description && <p className="m-0 mt-1 text-sm text-foreground/70 line-clamp-2">{item.description}</p>}
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="overline text-foreground/45">Price</dt>
                        <dd className="m-0 font-semibold tabular-nums">{fmt(item.price)} $PEP</dd>
                      </div>
                      <div>
                        <dt className="overline text-foreground/45">Stock</dt>
                        <dd className="m-0 font-semibold tabular-nums">{stockLabel(item.quantity)}</dd>
                      </div>
                      <div>
                        <dt className="overline text-foreground/45">Sold</dt>
                        <dd className="m-0 font-semibold tabular-nums">{fmt(item.sold)}</dd>
                      </div>
                      <div>
                        <dt className="overline text-foreground/45">Held</dt>
                        <dd className="m-0 font-semibold tabular-nums">
                          {fmt(item.held)}
                          {item.pending > 0 && <span className="font-normal text-foreground/55"> +{fmt(item.pending)} pending</span>}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex w-full flex-wrap gap-2 md:w-auto md:max-w-[250px] md:justify-end">
                    <button type="button" className={`${pillOutline} !min-h-9 text-sm`} onClick={() => setEditing(item)}>
                      <Pencil size={14} aria-hidden /> Edit
                    </button>
                    {item.quantity !== -1 && (
                      <button type="button" className={`${pillOutline} !min-h-9 text-sm`} onClick={() => setStocking(item)}>
                        <PackagePlus size={14} aria-hidden /> Stock
                      </button>
                    )}
                    {!item.isCollectible && (
                      <button
                        type="button"
                        className={`${pillOutline} !min-h-9 text-sm`}
                        disabled={rowBusy === item.id}
                        onClick={() => {
                          if (item.isAvailable) {
                            setHideReason("");
                            setConfirming({ kind: "hide", item });
                          } else void setVisible(item, true);
                        }}
                      >
                        {item.isAvailable ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />} {item.isAvailable ? "Hide" : "Show"}
                      </button>
                    )}
                    <button
                      type="button"
                      className={`${pillOutline} !min-h-9 text-sm`}
                      onClick={() => {
                        setGrantPreset(item.id);
                        document.getElementById("grant")?.scrollIntoView({ behavior: "smooth", block: "start" });
                      }}
                    >
                      <Gift size={14} aria-hidden /> Grant
                    </button>
                    {item.canDelete && (
                      <button
                        type="button"
                        className={`${pillOutline} !min-h-9 text-sm !text-tomato`}
                        disabled={rowBusy === item.id}
                        onClick={() => setConfirming({ kind: "delete", item })}
                        title="Only items never bought, held or granted can be deleted"
                      >
                        <Trash2 size={14} aria-hidden /> Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 mb-0 text-xs text-foreground/55">
          Items that were ever bought, held or granted can only be hidden, never deleted, so inventories and the ledger keep pointing at them.
        </p>
      </section>

      <div className="mb-12">
        <MemberItemPanel items={data.items} preset={grantPreset} onDone={done} />
      </div>

      <section aria-labelledby="audit-heading" className="mb-8">
        <SectionHeading overline="Audit log" title={<span id="audit-heading">Recent changes</span>} count={data.events.length} />
        <div className={`${paperCard} px-5 py-2`}>
          <AuditLog events={data.events} people={data.people} />
        </div>
      </section>

      {editing && <ItemEditor item={editing === "new" ? null : editing} onDone={done} onClose={() => setEditing(null)} />}
      {stocking && <StockEditor item={stocking} onDone={done} onClose={() => setStocking(null)} />}
      {confirming?.kind === "hide" && (
        <Modal title={`Hide ${confirming.item.name}?`} overline="Hide item" onClose={() => setConfirming(null)}>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void setVisible(confirming.item, false, hideReason);
            }}
          >
            <p className="m-0 text-sm text-foreground/75">
              It comes off the web shop and Discord /shop and /buy. Members keep what they hold, and the history stays. You can show it again any time.
            </p>
            <Field label="Reason (optional)" hint="Saved in the audit log.">
              <input className={fieldClass} value={hideReason} maxLength={SHOP_LIMITS.reasonMax} onChange={(e) => setHideReason(e.target.value)} autoFocus />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className={pillOutline} onClick={() => setConfirming(null)}>
                Cancel
              </button>
              <button type="submit" className={pillInk} disabled={rowBusy === confirming.item.id}>
                <EyeOff size={16} aria-hidden /> Hide item
              </button>
            </div>
          </form>
        </Modal>
      )}
      {confirming?.kind === "delete" && (
        <Modal title={`Delete ${confirming.item.name}?`} overline="Delete item" onClose={() => setConfirming(null)}>
          <p className="m-0 text-sm text-foreground/75">
            It has never been bought, held or granted, so it can be deleted for good. This can&apos;t be undone (the audit log keeps a record).
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={pillOutline} onClick={() => setConfirming(null)}>
              Cancel
            </button>
            <button type="button" className={pillTomato} disabled={rowBusy === confirming.item.id} onClick={() => remove(confirming.item)}>
              <Trash2 size={16} aria-hidden /> Delete item
            </button>
          </div>
        </Modal>
      )}
    </EditorialPage>
  );
}
