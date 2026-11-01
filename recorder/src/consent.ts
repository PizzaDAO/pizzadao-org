/** Wording posted to the voice channel's text chat. Audio is never public (Snax, 2026-10-18). No opt-out (Snax, 2026-10-25). */

export function consentNotice(): string {
  return [
    '🔴 **This call is being recorded and transcribed.**',
    'The audio is private (only Dread Pizza Roberts can listen) and is never published. A summary and transcript may be posted on pizzadao.org after review.',
    "If you don't want to be recorded, please don't join the call (or leave it). Bots are never recorded.",
  ].join('\n')
}

export function lateJoinWelcome(userId: string): string {
  return `Welcome to the call, <@${userId}>!`
}
