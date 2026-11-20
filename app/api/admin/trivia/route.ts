import { requireAdmin } from "@/app/lib/auth-guards";
import { json, rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { internalError } from "@/app/lib/errors/error-response";
import { getQuestion } from "@/app/lib/trivia/bank";
import { closeReports, setQuestionDisabled } from "@/app/lib/trivia/reports";
import { addSuggestionToBank, closeSuggestion } from "@/app/lib/trivia/suggestions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trivia admin actions (admin only), one JSON body each:
 *   { action: "disable", questionId }   pull the question from every pool (trivia.disabledQuestionIds) and close its reports
 *   { action: "enable", questionId }    bring it back
 *   { action: "dismiss", questionId }   close its open reports without pulling it
 *   { action: "suggestion-add", suggestionId }   "Add to bank": create the suggestion's draft as a flagged bank row
 *     (not served until approved in the bank editor), then mark the suggestion added
 *   { action: "suggestion-added" | "suggestion-dismiss", suggestionId }   close an open community suggestion
 *     (marked added, or dismissed). Neither touches the bank or any setting.
 * Bank edits (create, edit, status, pool) are /api/admin/trivia/questions.
 * The setting is audited like any other (the admin's id is the actor).
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  let body: { action?: unknown; questionId?: unknown; suggestionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (body.action === "suggestion-add") {
    const id = typeof body.suggestionId === "number" && Number.isInteger(body.suggestionId) && body.suggestionId > 0 ? body.suggestionId : 0;
    if (!id) return json({ error: "Unknown suggestion" }, 400);
    try {
      const out = await addSuggestionToBank(id, auth.session.discordId);
      if (out.status === "added") return json({ ok: true, questionId: out.questionId, existed: out.existed });
      if (out.status === "not_open") return json({ error: "That suggestion is not open" }, 404);
      if (out.status === "unreadable") return json({ error: "That suggestion cannot be read" }, 400);
      return json({ error: out.error, errors: out.errors }, 400);
    } catch (err) {
      return internalError(err, "admin/trivia", "Could not add the suggestion to the bank");
    }
  }
  if (body.action === "suggestion-added" || body.action === "suggestion-dismiss") {
    const id = typeof body.suggestionId === "number" && Number.isInteger(body.suggestionId) && body.suggestionId > 0 ? body.suggestionId : 0;
    if (!id) return json({ error: "Unknown suggestion" }, 400);
    try {
      const closed = await closeSuggestion(id, body.action === "suggestion-added" ? "added" : "dismissed");
      return closed ? json({ ok: true }) : json({ error: "That suggestion is not open" }, 404);
    } catch (err) {
      return internalError(err, "admin/trivia", "Could not update the suggestion");
    }
  }
  const questionId = typeof body.questionId === "string" ? body.questionId : "";
  if (!(await getQuestion(questionId))) return json({ error: "Unknown question" }, 404);
  try {
    switch (body.action) {
      case "disable": {
        const changed = await setQuestionDisabled(questionId, true, auth.session.discordId);
        const closed = await closeReports(questionId);
        return json({ ok: true, changed, closed });
      }
      case "enable":
      {
        // A restore closes whatever is still open: only reports made after it count toward a later auto-pull.
        const changed = await setQuestionDisabled(questionId, false, auth.session.discordId);
        const closed = await closeReports(questionId);
        return json({ ok: true, changed, closed });
      }
      case "dismiss":
        return json({ ok: true, closed: await closeReports(questionId) });
      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (err) {
    return internalError(err, "admin/trivia", "Could not update the question");
  }
}
