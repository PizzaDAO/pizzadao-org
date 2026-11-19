import { requireAdmin } from "@/app/lib/auth-guards";
import { json, rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { internalError } from "@/app/lib/errors/error-response";
import { getQuestion } from "@/app/lib/trivia/bank";
import { closeReports, setQuestionDisabled } from "@/app/lib/trivia/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trivia admin actions (admin only), one JSON body each:
 *   { action: "disable", questionId }   pull the question from every pool (trivia.disabledQuestionIds) and close its reports
 *   { action: "enable", questionId }    bring it back
 *   { action: "dismiss", questionId }   close its open reports without pulling it
 * The setting is audited like any other (the admin's id is the actor).
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  let body: { action?: unknown; questionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!getQuestion(questionId)) return json({ error: "Unknown question" }, 404);
  try {
    switch (body.action) {
      case "disable": {
        const changed = await setQuestionDisabled(questionId, true, auth.session.discordId);
        const closed = await closeReports(questionId);
        return json({ ok: true, changed, closed });
      }
      case "enable":
        return json({ ok: true, changed: await setQuestionDisabled(questionId, false, auth.session.discordId) });
      case "dismiss":
        return json({ ok: true, closed: await closeReports(questionId) });
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return internalError(err, "admin/trivia", "Could not update the question");
  }
}
