import { describe, expect, it } from "vitest";
import { nextCrewCall, calendarDownload } from "./crew-next-call";
describe("weekly calls", () => {
  it("uses the schedule's timezone and moves past calls to next week", () => {
    expect(nextCrewCall('Mondays 3pm ET', new Date('2026-10-10T12:00:00Z'))?.toISOString()).toBe('2026-10-12T19:00:00.000Z');
    expect(nextCrewCall('Mondays 3pm ET', new Date('2026-10-12T20:00:00Z'))?.toISOString()).toBe('2026-10-19T19:00:00.000Z');
  });
  it("handles DST changes in the source timezone", () => {
    expect(nextCrewCall('Mondays 3pm ET', new Date('2026-10-31T12:00:00Z'))?.toISOString()).toBe('2026-11-02T20:00:00.000Z');
    expect(nextCrewCall('Mondays 3pm ET', new Date('2026-03-07T12:00:00Z'))?.toISOString()).toBe('2026-03-09T19:00:00.000Z');
  });
  it("does not invent times or zones", () => {
    for (const schedule of ['Mondays', 'Mondays 3pm', 'Mondays 99pm ET', 'Mondays 3:99pm ET', 'By arrangement']) expect(nextCrewCall(schedule)).toBeNull();
  });
  it("produces an escaped calendar event with UTC times", () => {
    const calendar = decodeURIComponent(calendarDownload('Tech, PizzaDAO', new Date('2026-10-12T19:00:00Z'), 60, 'https://discord.gg/pizzadao'));
    expect(calendar).toContain('SUMMARY:Tech\\, PizzaDAO'); expect(calendar).toContain('DTEND:20261012T200000Z');
  });
});
