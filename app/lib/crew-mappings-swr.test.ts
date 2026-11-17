// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }))
vi.mock("@/app/api/lib/google-sheets", () => ({ getTaskLinks: vi.fn(), getColumnHyperlinks: vi.fn() }))
vi.mock("@/app/lib/sheets-import/source", () => ({
  usesDb: vi.fn(async () => true),
  getSource: vi.fn(async () => "db"),
  readsFromDb: vi.fn(() => true),
}))
const crewRows = vi.hoisted(() => ({ findMany: vi.fn() }))
vi.mock("@/app/lib/db", () => ({ prisma: { crew: crewRows } }))
vi.mock("@/app/lib/crew-content", () => ({ loadCrewTasks: vi.fn(async () => []) }))

import { cacheDel, cacheSet } from "@/app/api/lib/cache"
import { getCrewMappings } from "./crew-mappings"

const KEY = "crew-mappings:db:v3:swr"
const row = (label: string) => ({ id: label.toLowerCase(), label, emoji: null, turtles: [], role: null, channel: null, event: null, callTime: null, callTimeUrl: null, callLength: null, legacySheetUrl: null })

describe("getCrewMappings stale-while-revalidate", () => {
  beforeEach(async () => {
    await cacheDel(KEY)
    await cacheDel(`${KEY}:refresh-lock`)
    crewRows.findMany.mockReset()
  })

  it("serves the stale list at once and refreshes behind the response", async () => {
    await cacheSet(KEY, { value: { crews: [{ id: "old", label: "Old", turtles: [], tasks: [] }] }, fetchedAt: 0 }, 600)
    crewRows.findMany.mockResolvedValue([row("New")])
    const stale = await getCrewMappings(false, { staleWhileRevalidate: true })
    expect(stale.crews.map((c) => c.id)).toEqual(["old"])
    expect(stale.cached).toBe(true)
    // The refresh runs after the response (the mocked after() starts it immediately).
    await vi.waitFor(() => expect(crewRows.findMany).toHaveBeenCalledTimes(1))
    await vi.waitFor(async () => {
      const next = await getCrewMappings(false, { staleWhileRevalidate: true })
      expect(next.crews.map((c) => c.id)).toEqual(["new"])
    })
  })

  it("without the option a stale list still blocks on a reload", async () => {
    await cacheSet(KEY, { value: { crews: [{ id: "old", label: "Old", turtles: [], tasks: [] }] }, fetchedAt: 0 }, 600)
    crewRows.findMany.mockResolvedValue([row("New")])
    const out = await getCrewMappings()
    expect(out.crews.map((c) => c.id)).toEqual(["new"])
  })
})
