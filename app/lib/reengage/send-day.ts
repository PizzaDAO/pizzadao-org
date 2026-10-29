import type { Settings } from "@/app/lib/settings";
import { settingInt } from "@/app/lib/settings/numbers";

/**
 * Day of the week (0 = Sunday, UTC) the re-engagement email goes out (setting reengage.sendWeekday,
 * default 2 = Tuesday). The cron fires every day between 16:00 and 21:00 UTC and skips other days,
 * so the day can change without editing vercel.json.
 */
export function reengageSendWeekday(settings?: Settings): number {
  return settingInt("reengage.sendWeekday", settings);
}

export function isReengageSendDay(now: Date, settings?: Settings): boolean {
  return now.getUTCDay() === reengageSendWeekday(settings);
}
