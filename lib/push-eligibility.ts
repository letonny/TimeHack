import { resolveReminderInstant } from './reminders.ts';
import type { HabitReminder } from './timer.ts';

export type PushCandidate = {
  user_id: string; habit_id: string; local_time: string; time_zone: string;
  weekday_mask: number; skip_if_goal_complete: boolean;
};

export function dueOccurrence(row: PushCandidate, now: number): { localDate: string; occurrence: number } | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: row.time_zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const wallMinute = Number(part('hour')) * 60 + Number(part('minute'));
  const [targetHour, targetMinute] = row.local_time.split(':').map(Number);
  const targetWallMinute = targetHour * 60 + targetMinute;
  const dates = wallMinute <= 15 ? [today, yesterday] : [today];
  for (const localDate of dates) {
    const wallDistance = localDate === today ? Math.abs(wallMinute - targetWallMinute) : wallMinute + 1440 - targetWallMinute;
    if (wallDistance > 180) continue;
    const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay() || 7;
    if (!(row.weekday_mask & (1 << (weekday - 1)))) continue;
    const reminder: HabitReminder = { habitId: row.habit_id, enabled: true,
      localTime: row.local_time.slice(0, 5), timeZone: row.time_zone,
      weekdays: [weekday as HabitReminder['weekdays'][number]], skipIfGoalComplete: row.skip_if_goal_complete };
    const occurrence = resolveReminderInstant(reminder, localDate);
    if (occurrence <= now && now - occurrence <= 15 * 60000) return { localDate, occurrence };
  }
  return null;
}
