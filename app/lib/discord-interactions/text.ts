/** Small text helpers shared by the deferred Discord command replies (/bounty, /task). */

/** Markdown/mention-safe text for a reply. */
export const esc = (s: string) => s.replace(/([*_`~|>\\[\]])/g, '\\$1').replace(/@/g, '@\u200b')

/** A markdown link whose URL is wrapped in <> so Discord shows no embed preview. */
export const link = (label: string, url: string) => `[${label}](<${url}>)`

/** Cut to at most `max` code points (never splitting an emoji), with an ellipsis when cut. */
export function cutChars(s: string, max: number): string {
  const chars = Array.from(s)
  return chars.length > max ? `${chars.slice(0, max - 1).join('').trimEnd()}…` : s
}

/** One line of text: newlines flattened, cut to about `max` code points, then escaped. */
export function shortText(text: string, max = 90): string {
  return esc(cutChars(text.replace(/\s+/g, ' ').trim(), max))
}
