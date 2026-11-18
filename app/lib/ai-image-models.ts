// The OpenAI image models to try, in order. Some accounts do not have the older model (the API then
// answers 400 "The model '...' does not exist"), so the newest comes first and each later entry is
// only used when the one before it does not exist for the account. Admin setting: ai.imageModels.
import { getSetting } from '@/app/lib/settings'

export const DEFAULT_IMAGE_MODELS: readonly string[] = ['gpt-image-1.5', 'gpt-image-1']

/** True when the provider is saying the model is unknown to this account (retry with the next one). */
export function isModelMissing(message: string | undefined | null): boolean {
  return /model.*(does not exist|not found)|(does not exist|not found).*model/i.test(message ?? '')
}

/** The configured model list; the default when the setting is unreadable or empty. */
export async function loadImageModels(): Promise<string[]> {
  try {
    const v = await getSetting('ai.imageModels')
    if (Array.isArray(v) && v.length > 0) return v
  } catch {
    // fall through to the default
  }
  return [...DEFAULT_IMAGE_MODELS]
}
