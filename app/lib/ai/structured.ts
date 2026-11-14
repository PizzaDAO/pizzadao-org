/**
 * A structured model call through the Vercel AI Gateway with the same OpenAI fallback as the call
 * summaries (app/lib/calls/summarize.ts): the gateway first with a plain "provider/model" string; if
 * that fails with an access or availability error and OPENAI_API_KEY is set, the same request goes
 * straight to OpenAI. Time-boxed; logs which provider answered, never content.
 */
import { generateText, Output, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { z } from 'zod'
import { isFallbackWorthy, summaryFallbackModel } from '@/app/lib/calls/summarize'

const MIN_CALL_MS = 20_000
const PRIMARY_SHARE = 0.6
export const DEFAULT_STRUCTURED_BUDGET_MS = 120_000

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))

export async function generateStructured<S extends z.ZodType>(o: {
  schema: S
  system: string
  prompt: string
  model: string
  label: string
  budgetMs?: number
}): Promise<z.infer<S>> {
  const deadline = Date.now() + (o.budgetMs ?? DEFAULT_STRUCTURED_BUDGET_MS)
  const run = async (m: LanguageModel, timeoutMs: number) => {
    const { output } = await generateText({
      model: m,
      system: o.system,
      output: Output.object({ schema: o.schema }),
      prompt: o.prompt,
      abortSignal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
    })
    return o.schema.parse(output) as z.infer<S>
  }
  const total = deadline - Date.now()
  if (total < MIN_CALL_MS) throw new Error('not enough time left for a model call')
  try {
    const out = await run(o.model, Math.floor(total * PRIMARY_SHARE))
    console.log(`[${o.label}] provider=gateway`)
    return out
  } catch (primaryErr) {
    const apiKey = process.env.OPENAI_API_KEY?.trim()
    if (!apiKey || !isFallbackWorthy(primaryErr)) throw primaryErr
    const left = deadline - Date.now()
    if (left < MIN_CALL_MS) throw primaryErr
    console.warn(`[${o.label}] gateway failed, retrying with OpenAI:`, errText(primaryErr).slice(0, 200))
    try {
      // Cast: @ai-sdk/openai bundles its own (newer) @ai-sdk/provider typings; the runtime shape is the same.
      const out = await run(createOpenAI({ apiKey })(summaryFallbackModel()) as unknown as LanguageModel, left)
      console.log(`[${o.label}] provider=openai-fallback`)
      return out
    } catch (fallbackErr) {
      throw new Error(`gateway: ${errText(primaryErr).slice(0, 150)}; openai fallback: ${errText(fallbackErr).slice(0, 150)}`)
    }
  }
}
