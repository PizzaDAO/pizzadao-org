import { requireAdmin } from "@/app/lib/auth-guards";
import { json, rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { internalError } from "@/app/lib/errors/error-response";
import { createQuestion, listAdminQuestions, setQuestionStatus, updateQuestion, type BankWriteResult } from "@/app/lib/trivia/bank-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The question bank editor (admin only). The bank holds every answer, so nothing here is ever public: both methods
 * check requireAdmin first, and writes also need a same-origin JSON request (rejectUnsafeWrite).
 *
 * GET ?status=&pool=&category=&exposed=true|false   every bank row (fresh from the database), filtered
 * POST, one JSON body each (the admin's Discord id is recorded in updatedBy):
 *   { action: "create", question }                                      a new question (schema + matcher lint)
 *   { action: "update", id, question, expectUpdatedAt?, exposed? }      replace it; editing the question text or the
 *                                                                        answer clears `exposed` unless it is given
 *   { action: "status", id, status, pool?, rejectedReason?, expectUpdatedAt? }   approve / flag / retire, or move pool
 */
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const p = new URL(request.url).searchParams;
  const exposed = p.get("exposed");
  try {
    const questions = await listAdminQuestions({
      status: p.get("status") || undefined,
      pool: p.get("pool") || undefined,
      category: p.get("category") || undefined,
      exposed: exposed === "true" ? true : exposed === "false" ? false : undefined,
    });
    return json({ questions });
  } catch (err) {
    return internalError(err, "admin/trivia/questions", "Could not read the question bank");
  }
}

function reply(r: BankWriteResult) {
  return r.ok ? json({ ok: true, row: r.row }) : json({ error: r.error, errors: r.errors }, r.status);
}

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const actor = auth.session.discordId;
  const id = str(body.id) ?? "";
  try {
    switch (body.action) {
      case "create":
        return reply(await createQuestion(body.question, actor));
      case "update":
        if (!id) return json({ error: "Unknown question" }, 404);
        return reply(
          await updateQuestion(id, body.question, actor, {
            expectUpdatedAt: str(body.expectUpdatedAt),
            exposed: typeof body.exposed === "boolean" ? body.exposed : undefined,
          }),
        );
      case "status":
        if (!id) return json({ error: "Unknown question" }, 404);
        return reply(
          await setQuestionStatus(id, { status: str(body.status) ?? "", pool: str(body.pool), rejectedReason: str(body.rejectedReason), expectUpdatedAt: str(body.expectUpdatedAt) }, actor),
        );
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return internalError(err, "admin/trivia/questions", "Could not save the question");
  }
}
