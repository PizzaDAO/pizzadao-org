// app/lib/trivia/bank-store.ts
//
// The only module that touches the TriviaQuestion table: raw rows in and out, no validation and no cache (bank.ts
// validates and caches every read; bank-admin.ts and bank-import.ts validate every write). Tests replace this module
// with an in-memory fake over the fixture bank (vitest.setup.ts).
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/db";
import type { TriviaQuestion } from "./schema";

export interface BankRow {
  id: string;
  status: string;
  pool: string | null;
  category: string;
  /** The question object (unvalidated as read: bank.ts parses it). */
  data: unknown;
  exposed: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
}

const SELECT = { id: true, status: true, pool: true, category: true, data: true, exposed: true, createdAt: true, updatedAt: true, updatedBy: true } as const;

/** The indexed columns are copies of the question's own fields, so they can never disagree with `data`. */
function columns(q: TriviaQuestion) {
  return { status: q.status, pool: q.pool ?? null, category: q.category, data: q as unknown as Prisma.InputJsonValue };
}

export async function listBankRows(): Promise<BankRow[]> {
  return prisma.triviaQuestion.findMany({ select: SELECT, orderBy: { id: "asc" } });
}

export async function getBankRow(id: string): Promise<BankRow | null> {
  return prisma.triviaQuestion.findUnique({ where: { id }, select: SELECT });
}

/** Insert a new question. Returns null when the id is taken. */
export async function insertBankRow(q: TriviaQuestion, meta: { exposed: boolean; actor: string }): Promise<BankRow | null> {
  try {
    return await prisma.triviaQuestion.create({ data: { id: q.id, ...columns(q), exposed: meta.exposed, updatedBy: meta.actor }, select: SELECT });
  } catch (e) {
    if ((e as { code?: string } | null)?.code === "P2002") return null;
    throw e;
  }
}

export interface UpdateGuard {
  /**
   * Optimistic concurrency, always required: the write only happens when the row's updatedAt is exactly this (the
   * updatedAt of the row the caller read). A row changed in between is never overwritten.
   */
  expectUpdatedAt: Date;
}

/** Replace a question (same id). Returns null when the row is missing or changed since it was read. */
export async function updateBankRow(q: TriviaQuestion, meta: { exposed: boolean; actor: string } & UpdateGuard): Promise<BankRow | null> {
  const res = await prisma.triviaQuestion.updateMany({
    where: { id: q.id, updatedAt: meta.expectUpdatedAt },
    data: { ...columns(q), exposed: meta.exposed, updatedBy: meta.actor },
  });
  if (res.count !== 1) return null;
  return getBankRow(q.id);
}

export type ImportOp = { kind: "create"; q: TriviaQuestion; exposed: boolean } | { kind: "update"; q: TriviaQuestion; exposed: boolean; expectUpdatedAt: Date };

class ImportConflict extends Error {
  constructor(readonly id: string) {
    super(`conflict on ${id}`);
  }
}

/**
 * Apply an import in ONE transaction: every write or none. A create whose id appeared meanwhile, or an update of a row
 * changed since it was read, rolls the whole import back and is reported as the conflict.
 */
export async function applyImportOps(ops: ImportOp[], actor: string): Promise<{ ok: true } | { ok: false; conflict: string }> {
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const op of ops) {
          if (op.kind === "create") {
            const res = await tx.triviaQuestion.createMany({ data: [{ id: op.q.id, ...columns(op.q), exposed: op.exposed, updatedBy: actor }], skipDuplicates: true });
            if (res.count !== 1) throw new ImportConflict(op.q.id);
          } else {
            const res = await tx.triviaQuestion.updateMany({
              where: { id: op.q.id, updatedAt: op.expectUpdatedAt },
              data: { ...columns(op.q), exposed: op.exposed, updatedBy: actor },
            });
            if (res.count !== 1) throw new ImportConflict(op.q.id);
          }
        }
      },
      { maxWait: 15_000, timeout: 120_000 },
    );
    return { ok: true };
  } catch (e) {
    if (e instanceof ImportConflict) return { ok: false, conflict: e.id };
    throw e;
  }
}

/**
 * Mark questions exposed because their answer has been revealed publicly (a Discord round closed, a web daily was
 * served). Only rows not already exposed change. Returns how many changed.
 */
export async function markRowsExposed(ids: string[], actor: string): Promise<number> {
  if (ids.length === 0) return 0;
  const res = await prisma.triviaQuestion.updateMany({ where: { id: { in: ids }, exposed: false }, data: { exposed: true, updatedBy: actor } });
  return res.count;
}
