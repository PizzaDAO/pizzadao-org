/**
 * Utility functions for parsing crew call times and grouping crews by day of week.
 * Used by the /crews page to display crews in day-of-week columns.
 */

export const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const DAY_MAP: Record<string, string> = {
  'monday': 'Monday', 'mondays': 'Monday',
  'tuesday': 'Tuesday', 'tuesdays': 'Tuesday',
  'wednesday': 'Wednesday', 'wednesdays': 'Wednesday',
  'thursday': 'Thursday', 'thursdays': 'Thursday',
  'friday': 'Friday', 'fridays': 'Friday',
  'saturday': 'Saturday', 'saturdays': 'Saturday',
  'sunday': 'Sunday', 'sundays': 'Sunday',
};

/**
 * Parses a call time string like "Mondays 3pm ET" into a structured object
 * with the day of week and a sortable time value (minutes since midnight).
 */
export function parseCallTime(callTime?: string): { day: string; sortableTime: number } | null {
  if (!callTime) return null;

  const words = callTime.toLowerCase().split(/\s+/);
  const dayWord = words.find(w => DAY_MAP[w]);
  if (!dayWord) return null;

  const day = DAY_MAP[dayWord];

  const timeMatch = callTime.match(/(\d{1,2})(:\d{2})?\s*(am|pm)/i);
  let sortableTime = 0;
  if (timeMatch) {
    let hours = parseInt(timeMatch[1]);
    const ampm = timeMatch[3].toLowerCase();
    if (ampm === 'pm' && hours !== 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    const minutes = timeMatch[2] ? parseInt(timeMatch[2].slice(1)) : 0;
    sortableTime = hours * 60 + minutes;
  }

  return { day, sortableTime };
}

export type CrewWithSchedule = {
  id: string;
  label: string;
  callTime?: string;
  [key: string]: any;
};

/**
 * Groups an array of crews by their call day, sorted in weekday order.
 * Crews within each day are sorted by time ascending.
 * Crews without a parseable callTime are placed in an "Other" group at the end.
 */
export function groupCrewsByDay(crews: CrewWithSchedule[]): { day: string; crews: CrewWithSchedule[] }[] {
  const groups = new Map<string, { crew: CrewWithSchedule; sortableTime: number }[]>();
  const other: CrewWithSchedule[] = [];

  for (const crew of crews) {
    const parsed = parseCallTime(crew.callTime);
    if (parsed) {
      if (!groups.has(parsed.day)) groups.set(parsed.day, []);
      groups.get(parsed.day)!.push({ crew, sortableTime: parsed.sortableTime });
    } else {
      other.push(crew);
    }
  }

  // Sort within each day by time ascending
  groups.forEach(list => list.sort((a, b) => a.sortableTime - b.sortableTime));

  // Build result in day-of-week order
  const result: { day: string; crews: CrewWithSchedule[] }[] = [];
  for (const day of DAYS_OF_WEEK) {
    const group = groups.get(day);
    if (group && group.length > 0) {
      result.push({ day, crews: group.map(g => g.crew) });
    }
  }
  if (other.length > 0) {
    result.push({ day: 'Other', crews: other });
  }

  return result;
}
