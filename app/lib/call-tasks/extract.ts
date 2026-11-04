/**
 * The model pass behind the proposed crew task updates. Only redaction-filtered segments reach the
 * model, speakers as S1..Sn and tasks as T1..Tn (mapped back in code, so raw ids never leave the
 * app). The private summary addendum (`calls.summaryPromptExtra`) applies here too.
 */
import { generateText, Output, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { TranscriptSegment } from '@/app/lib/calls/ingest-schema'
import type { Settings } from '@/app/lib/settings'
import { buildTranscriptText, isFallbackWorthy, summaryFallbackModel, summaryModel } from '@/app/lib/calls/summarize'
import { buildSpeakerLabels } from '@/app/lib/followups/extract'
import { crewVocab, describeTask, parseProposals, PROPOSALS_SYSTEM_PROMPT, proposalsSchema, squashText, type ParseContext, type ProposalDraft, type TaskRef } from './proposals'
import type { PostFilter } from '@/app/lib/calls/post-filters'
import type { MemberRef } from '@/app/lib/followups/resolve'

const TRANSCRIPT_LIMIT = 400_000
const MIN_CALL_MS = 15_000

export interface ProposeInput {
  recordingId: string
  segments: TranscriptSegment[]
  speakers: Array<{ discordId: string; displayName: string | null }>
  actionItems: Array<{ text?: string; owner?: string | null }>
  tasks: TaskRef[]
  members: MemberRef[]
  filter: PostFilter
  today: Date
  max: number
}

export function buildProposalPrompt(input: ProposeInput): { prompt: string; ctx: ParseContext } {
  const { byLabel, names } = buildSpeakerLabels(input.segments, input.speakers)
  const transcript = buildTranscriptText(input.segments, names).slice(0, TRANSCRIPT_LIMIT)
  const tasksByRef = new Map<string, TaskRef>()
  input.tasks.forEach((t, i) => tasksByRef.set(`T${i + 1}`, t))
  const vocab = crewVocab(input.tasks)
  const taskLines = [...tasksByRef].map(([ref, t]) => describeTask(ref, t)).join('\n')
  const items = input.actionItems
    .filter((a) => a.text)
    .map((a, i) => `${i + 1}. ${a.text}${a.owner ? ` (owner: ${a.owner})` : ''}`)
    .join('\n')
  const prompt = [
    `Today is ${input.today.toISOString().slice(0, 10)}.`,
    `Stages this crew uses: ${vocab.stages.join(', ')}. Priorities: ${vocab.priorities.join(', ')}.`,
    `Crew tasks:\n${taskLines || '(none yet)'}`,
    items ? `Action items recorded for this call (context):\n${items}` : '',
    `Transcript:\n\n${transcript}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  const ctx: ParseContext = {
    recordingId: input.recordingId,
    tasksByRef,
    speakerByLabel: byLabel,
    members: input.members,
    vocab,
    now: input.today,
    max: input.max,
    filter: input.filter,
    // Quotes are checked against the text the model saw, without the "[mm:ss] Name:" prefixes.
    visibleText: squashText(input.segments.map((s) => s.text).join(' ')),
    actionItems: input.actionItems,
    openLabels: input.tasks.map((t) => t.label),
  }
  return { prompt, ctx }
}

/** Model call through the gateway (OpenAI fallback like the summary). Throws on failure. */
export async function proposeTaskUpdates(input: ProposeInput, settings: Settings, opts: { model?: string; budgetMs?: number; env?: Record<string, string | undefined> } = {}): Promise<ProposalDraft[]> {
  if (input.segments.length === 0) return []
  const env = opts.env ?? process.env
  const { prompt, ctx } = buildProposalPrompt(input)
  const extra = String(settings.get('calls.summaryPromptExtra') ?? '').trim()
  const system = extra ? `${PROPOSALS_SYSTEM_PROMPT}\n\n${extra}` : PROPOSALS_SYSTEM_PROMPT
  const deadline = Date.now() + (opts.budgetMs ?? 120_000)
  const run = async (m: LanguageModel | string, timeoutMs: number) => {
    const { output } = await generateText({
      model: m as LanguageModel,
      system,
      output: Output.object({ schema: proposalsSchema }),
      prompt,
      abortSignal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    })
    return output
  }
  const total = deadline - Date.now()
  if (total < MIN_CALL_MS) throw new Error('not enough time left to propose task updates')
  let raw: unknown
  try {
    raw = await run(opts.model || summaryModel(env, settings), Math.floor(total * 0.6))
  } catch (primaryErr) {
    const apiKey = env.OPENAI_API_KEY?.trim()
    const left = deadline - Date.now()
    if (!apiKey || !isFallbackWorthy(primaryErr) || left < MIN_CALL_MS) throw primaryErr
    raw = await run(createOpenAI({ apiKey })(summaryFallbackModel(env)) as unknown as LanguageModel, left)
  }
  return parseProposals(raw, ctx)
}
