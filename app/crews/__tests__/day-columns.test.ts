import { describe, it, expect } from 'vitest'
import { parseCallTime, groupCrewsByDay, type CrewWithSchedule } from '@/app/lib/crew-schedule'

describe('parseCallTime', () => {
  it('parses "Mondays 3pm ET" correctly', () => {
    const result = parseCallTime('Mondays 3pm ET')
    expect(result).toEqual({ day: 'Monday', sortableTime: 900 }) // 15*60
  })

  it('parses "Tuesdays 11am ET" correctly', () => {
    const result = parseCallTime('Tuesdays 11am ET')
    expect(result).toEqual({ day: 'Tuesday', sortableTime: 660 }) // 11*60
  })

  it('parses "Wednesdays 12pm ET" correctly', () => {
    const result = parseCallTime('Wednesdays 12pm ET')
    expect(result).toEqual({ day: 'Wednesday', sortableTime: 720 }) // 12*60
  })

  it('returns null for undefined', () => {
    expect(parseCallTime(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseCallTime('')).toBeNull()
  })

  it('parses "Fridays 2:30pm ET" correctly', () => {
    const result = parseCallTime('Fridays 2:30pm ET')
    expect(result).toEqual({ day: 'Friday', sortableTime: 870 }) // 14*60+30
  })

  it('parses "Thursdays 9am ET" correctly', () => {
    const result = parseCallTime('Thursdays 9am ET')
    expect(result).toEqual({ day: 'Thursday', sortableTime: 540 }) // 9*60
  })

  it('parses "Saturdays 12am ET" (midnight) correctly', () => {
    const result = parseCallTime('Saturdays 12am ET')
    expect(result).toEqual({ day: 'Saturday', sortableTime: 0 }) // midnight
  })

  it('returns null for a string with no recognizable day', () => {
    expect(parseCallTime('Every other week at 3pm')).toBeNull()
  })
})

describe('groupCrewsByDay', () => {
  const makeCrew = (id: string, label: string, callTime?: string): CrewWithSchedule => ({
    id,
    label,
    callTime,
  })

  it('groups crews correctly by day', () => {
    const crews = [
      makeCrew('a', 'Crew A', 'Mondays 3pm ET'),
      makeCrew('b', 'Crew B', 'Mondays 4pm ET'),
      makeCrew('c', 'Crew C', 'Tuesdays 11am ET'),
    ]
    const result = groupCrewsByDay(crews)
    expect(result).toHaveLength(2)
    expect(result[0].day).toBe('Monday')
    expect(result[0].crews).toHaveLength(2)
    expect(result[1].day).toBe('Tuesday')
    expect(result[1].crews).toHaveLength(1)
  })

  it('sorts crews within a day by time ascending', () => {
    const crews = [
      makeCrew('late', 'Late Crew', 'Mondays 4pm ET'),
      makeCrew('early', 'Early Crew', 'Mondays 2pm ET'),
      makeCrew('mid', 'Mid Crew', 'Mondays 3pm ET'),
    ]
    const result = groupCrewsByDay(crews)
    expect(result).toHaveLength(1)
    expect(result[0].crews[0].id).toBe('early')
    expect(result[0].crews[1].id).toBe('mid')
    expect(result[0].crews[2].id).toBe('late')
  })

  it('puts crews without callTime into "Other" group', () => {
    const crews = [
      makeCrew('a', 'Crew A', 'Mondays 3pm ET'),
      makeCrew('b', 'Crew B'), // no callTime
      makeCrew('c', 'Crew C', ''),
    ]
    const result = groupCrewsByDay(crews)
    expect(result).toHaveLength(2)
    expect(result[0].day).toBe('Monday')
    expect(result[1].day).toBe('Other')
    expect(result[1].crews).toHaveLength(2) // both undefined and empty
  })

  it('only includes populated days (no empty columns)', () => {
    const crews = [
      makeCrew('a', 'Crew A', 'Wednesdays 1pm ET'),
      makeCrew('b', 'Crew B', 'Fridays 2pm ET'),
    ]
    const result = groupCrewsByDay(crews)
    expect(result).toHaveLength(2)
    expect(result[0].day).toBe('Wednesday')
    expect(result[1].day).toBe('Friday')
    // No Monday, Tuesday, Thursday, etc.
  })

  it('days appear in correct weekday order (Monday before Tuesday before Wednesday)', () => {
    // Input in reverse order to prove sorting
    const crews = [
      makeCrew('fri', 'Friday Crew', 'Fridays 1pm ET'),
      makeCrew('mon', 'Monday Crew', 'Mondays 1pm ET'),
      makeCrew('wed', 'Wednesday Crew', 'Wednesdays 1pm ET'),
      makeCrew('tue', 'Tuesday Crew', 'Tuesdays 1pm ET'),
    ]
    const result = groupCrewsByDay(crews)
    expect(result.map(g => g.day)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Friday'])
  })

  it('returns empty array for empty input', () => {
    expect(groupCrewsByDay([])).toEqual([])
  })

  it('handles all crews having no callTime', () => {
    const crews = [
      makeCrew('a', 'Crew A'),
      makeCrew('b', 'Crew B'),
    ]
    const result = groupCrewsByDay(crews)
    expect(result).toHaveLength(1)
    expect(result[0].day).toBe('Other')
    expect(result[0].crews).toHaveLength(2)
  })
})
