/**
 * Cached opt-out list from the app (GET /api/calls/recorder/optouts).
 *
 * Opted-out members are never subscribed to. If the list could not be loaded
 * yet when someone starts talking, their audio is captured provisionally and
 * purged the moment the list arrives (`onNewOptOuts`), so an app outage never
 * lets an opted-out member's audio survive into an upload.
 */
export class OptOutCache {
  private ids = new Set<string>()
  private loaded = false
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly fetchIds: () => Promise<string[]>,
    private readonly onNewOptOuts: (ids: string[]) => void = () => {},
    private readonly log: (msg: string) => void = () => {},
  ) {}

  has(discordId: string): boolean {
    return this.ids.has(discordId)
  }

  get isLoaded(): boolean {
    return this.loaded
  }

  /** Refresh now. On failure keeps the previous list. Returns whether it succeeded. */
  async refresh(): Promise<boolean> {
    try {
      const next = new Set(await this.fetchIds())
      const added = [...next].filter((id) => !this.ids.has(id))
      this.ids = next
      this.loaded = true
      if (added.length) this.onNewOptOuts(added)
      return true
    } catch (err) {
      this.log(`opt-out refresh failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  start(intervalMs: number): void {
    this.stop()
    this.timer = setInterval(() => void this.refresh(), intervalMs)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

/** Fetch the opt-out ids from the app. */
export function appOptOutFetcher(appBaseUrl: string, apiKey: string): () => Promise<string[]> {
  return async () => {
    const res = await fetch(`${appBaseUrl}/api/calls/recorder/optouts`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`app answered ${res.status}`)
    const body = (await res.json()) as { discordIds?: unknown }
    if (!Array.isArray(body.discordIds)) throw new Error('unexpected opt-out response')
    return body.discordIds.filter((x): x is string => typeof x === 'string')
  }
}
