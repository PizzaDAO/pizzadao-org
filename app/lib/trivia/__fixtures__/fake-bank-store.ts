// app/lib/trivia/__fixtures__/fake-bank-store.ts
//
// In-memory stand-in for bank-store.ts (the TriviaQuestion table), loaded with the MADE-UP fixture bank. vitest.setup.ts
// mocks bank-store with this module in every test file, so no test needs the real bank (which is never committed).
// Tests change it through `fakeBank` and must call invalidateBank() (bank.ts) afterwards, since bank.ts caches.
import fixture from "./questions.fixture.json";
import type { BankRow, ImportOp, UpdateGuard } from "../bank-store";
import type { TriviaQuestion } from "../schema";

const T0 = new Date("2026-01-01T00:00:00Z");

function seed(): Map<string, BankRow> {
  return new Map(
    (fixture.questions as unknown[]).map((d) => {
      const q = d as TriviaQuestion;
      return [q.id, { id: q.id, status: q.status, pool: q.pool ?? null, category: q.category, data: structuredClone(d), exposed: false, createdAt: T0, updatedAt: T0, updatedBy: "fixture" }];
    }),
  );
}

export const fakeBank = {
  rows: seed(),
  /** Make every read throw (an unreachable database). */
  fail: null as Error | null,
  /** Number of listBankRows calls (cache tests). */
  reads: 0,
  /** Called after getBankRow read a row (to simulate a write landing between a read and the write after it). */
  afterRead: null as ((id: string) => void) | null,
  /** Clock for updatedAt on writes. */
  now: () => new Date(),
  reset() {
    this.rows = seed();
    this.fail = null;
    this.reads = 0;
    this.afterRead = null;
    this.now = () => new Date();
  },
  /** Replace the whole bank (empty array: an empty bank). */
  set(rows: BankRow[]) {
    this.rows = new Map(rows.map((r) => [r.id, r]));
  },
  setExposed(ids: Iterable<string>, exposed = true) {
    for (const id of ids) {
      const r = this.rows.get(id);
      if (r) r.exposed = exposed;
    }
  },
};

const copy = (r: BankRow): BankRow => ({ ...r, data: structuredClone(r.data) });

export async function listBankRows(): Promise<BankRow[]> {
  fakeBank.reads++;
  if (fakeBank.fail) throw fakeBank.fail;
  return [...fakeBank.rows.values()].sort((a, b) => a.id.localeCompare(b.id)).map(copy);
}

export async function getBankRow(id: string): Promise<BankRow | null> {
  if (fakeBank.fail) throw fakeBank.fail;
  const r = fakeBank.rows.get(id);
  const out = r ? copy(r) : null;
  fakeBank.afterRead?.(id);
  return out;
}

export async function insertBankRow(q: TriviaQuestion, meta: { exposed: boolean; actor: string }): Promise<BankRow | null> {
  if (fakeBank.fail) throw fakeBank.fail;
  if (fakeBank.rows.has(q.id)) return null;
  const now = fakeBank.now();
  const row: BankRow = { id: q.id, status: q.status, pool: q.pool ?? null, category: q.category, data: structuredClone(q), exposed: meta.exposed, createdAt: now, updatedAt: now, updatedBy: meta.actor };
  fakeBank.rows.set(q.id, row);
  return copy(row);
}

export async function updateBankRow(q: TriviaQuestion, meta: { exposed: boolean; actor: string } & UpdateGuard): Promise<BankRow | null> {
  if (fakeBank.fail) throw fakeBank.fail;
  const r = fakeBank.rows.get(q.id);
  if (!r) return null;
  if (r.updatedAt.getTime() !== meta.expectUpdatedAt.getTime()) return null;
  const next: BankRow = { ...r, status: q.status, pool: q.pool ?? null, category: q.category, data: structuredClone(q), exposed: meta.exposed, updatedAt: fakeBank.now(), updatedBy: meta.actor };
  fakeBank.rows.set(q.id, next);
  return copy(next);
}

/** All or nothing, like the real transaction. */
export async function applyImportOps(ops: ImportOp[], actor: string): Promise<{ ok: true } | { ok: false; conflict: string }> {
  if (fakeBank.fail) throw fakeBank.fail;
  const staged = new Map(fakeBank.rows);
  for (const op of ops) {
    const r = staged.get(op.q.id);
    if (op.kind === "create" ? !!r : !r || r.updatedAt.getTime() !== op.expectUpdatedAt.getTime()) return { ok: false, conflict: op.q.id };
    const now = fakeBank.now();
    staged.set(op.q.id, {
      id: op.q.id,
      status: op.q.status,
      pool: op.q.pool ?? null,
      category: op.q.category,
      data: structuredClone(op.q),
      exposed: op.exposed,
      createdAt: r?.createdAt ?? now,
      updatedAt: now,
      updatedBy: actor,
    });
  }
  fakeBank.rows = staged;
  return { ok: true };
}

export async function markRowsExposed(ids: string[], actor: string): Promise<number> {
  if (fakeBank.fail) throw fakeBank.fail;
  let n = 0;
  for (const id of ids) {
    const r = fakeBank.rows.get(id);
    if (r && !r.exposed) {
      fakeBank.rows.set(id, { ...r, exposed: true, updatedBy: actor, updatedAt: fakeBank.now() });
      n++;
    }
  }
  return n;
}
