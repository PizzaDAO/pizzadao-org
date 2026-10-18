/** Wording posted to the voice channel's text chat. Audio is never public (Snax, 2026-10-18). */

export function consentNotice(): string {
  return [
    '🔴 **This call is being recorded.**',
    'The audio is private (only Dread Pizza Roberts can listen) and is deleted after a retention period. A summary and transcript may be posted on pizzadao.org after review.',
    "Don't want your voice recorded? Run `/record optout` and your audio is never captured, or just stay muted. `/record optin` changes it back. Bots are never recorded.",
  ].join('\n')
}

export function lateJoinReminder(userId: string): string {
  return `<@${userId}> this call is being recorded. Run \`/record optout\` if you don't want your voice captured.`
}
