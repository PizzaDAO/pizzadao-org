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
  /** Optimistic concurrency (the editor): only when the row's updatedAt is exactly this. */
  expectUpdatedAt?: Date;
  /** The import: only when the row was not changed after this instant. */
  notNewerThan?: Date;
}

/** Replace a question (same id). Returns null when the row is missing or the guard fails. */
export async function updateBankRow(q: TriviaQuestion, meta: { exposed: boolean; actor: string } & UpdateGuard): Promise<BankRow | null> {
  const where: Prisma.TriviaQuestionWhereInput = { id: q.id };
  if (meta.expectUpdatedAt) where.updatedAt = meta.expectUpdatedAt;
  else if (meta.notNewerThan) where.updatedAt = { lte: meta.notNewerThan };
  const res = await prisma.triviaQuestion.updateMany({ where, data: { ...columns(q), exposed: meta.exposed, updatedBy: meta.actor } });
  if (res.count !== 1) return null;
  return getBankRow(q.id);
}
