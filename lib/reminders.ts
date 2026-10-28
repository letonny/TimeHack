import type { HabitReminder, TimerState, Weekday } from './timer.ts';

export const WEEKDAYS: ReadonlyArray<{ value: Weekday; short: string; label: string }> = [
  { value: 1, short: 'Mon', label: 'Monday' },
  { value: 2, short: 'Tue', label: 'Tuesday' },
  { value: 3, short: 'Wed', label: 'Wednesday' },
  { value: 4, short: 'Thu', label: 'Thursday' },
  { value: 5, short: 'Fri', label: 'Friday' },
  { value: 6, short: 'Sat', label: 'Saturday' },
  { value: 7, short: 'Sun', label: 'Sunday' },
];

const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const ianaPattern = /^(?:UTC|[A-Za-z_]+(?:[+-][A-Za-z0-9]+)?(?:\/[A-Za-z0-9._+-]+)+)$/;

export function isIanaTimeZone(value: string): boolean {
  if (!ianaPattern.test(value)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function validateReminder(reminder: HabitReminder): HabitReminder {
  if (!reminder.habitId || reminder.habitId.length > 120) throw new Error('Choose a valid habit.');
  if (typeof reminder.enabled !== 'boolean' || typeof reminder.skipIfGoalComplete !== 'boolean')
    throw new Error('Reminder preferences are invalid.');
  if (!timePattern.test(reminder.localTime)) throw new Error('Choose a valid reminder time.');
  const timeZone = reminder.timeZone.trim();
  if (!isIanaTimeZone(timeZone)) throw new Error('Choose a valid IANA time zone, such as America/Chicago.');
  const weekdays = [...new Set(reminder.weekdays)].sort((a, b) => a - b);
  if (!weekdays.length || weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7))
    throw new Error('Select at least one weekday.');
  return { ...reminder, timeZone, weekdays: weekdays as Weekday[] };
}

export function saveReminder(state: TimerState, reminder: HabitReminder): TimerState {
  const next = validateReminder(reminder);
  if (!state.habits.some(habit => habit.id === next.habitId)) throw new Error('This habit no longer exists.');
  return { ...state, reminders: state.reminders.some(item => item.habitId === next.habitId)
    ? state.reminders.map(item => item.habitId === next.habitId ? next : item)
    : [...state.reminders, next] };
}

export function deleteReminder(state: TimerState, habitId: string): TimerState {
  return { ...state, reminders: state.reminders.filter(item => item.habitId !== habitId) };
}

function weekdaySummary(days: Weekday[]): string {
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '1,2,3,4,5,6,7') return 'every day';
  if (key === '1,2,3,4,5') return 'weekdays';
  if (key === '6,7') return 'weekends';
  return WEEKDAYS.filter(day => days.includes(day.value)).map(day => day.short).join(', ');
}

export function reminderSummary(reminder: HabitReminder): string {
  const normalized = validateReminder(reminder);
  const [hours, minutes] = normalized.localTime.split(':').map(Number);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
    .format(Date.UTC(2000, 0, 1, hours, minutes));
  const prefix = normalized.enabled ? 'Scheduled' : 'Paused';
  const completed = normalized.skipIfGoalComplete ? '; skips days when the goal is complete' : '';
  return `${prefix} ${weekdaySummary(normalized.weekdays)} at ${time} (${normalized.timeZone})${completed}.`;
}

export function reminderAppliesOnDate(reminder: HabitReminder, localDate: string): boolean {
  if (!reminder.enabled || !datePattern.test(localDate)) return false;
  const date = new Date(`${localDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== localDate) return false;
  const isoDay = (date.getUTCDay() || 7) as Weekday;
  return reminder.weekdays.includes(isoDay);
}

export function shouldSuppressReminder(reminder: HabitReminder, goalComplete: boolean): boolean {
  return reminder.skipIfGoalComplete && goalComplete;
}

function zonedMinuteKey(epoch: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(epoch);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`;
}

/**
 * Resolves a local reminder wall time for future delivery. Repeated times use
 * the first occurrence. Nonexistent times advance to the first valid wall
 * minute after the DST gap.
 */
export function resolveReminderInstant(reminder: HabitReminder, localDate: string): number {
  const normalized = validateReminder(reminder);
  if (!datePattern.test(localDate)) throw new Error('Invalid local reminder date.');
  const targetKey = `${localDate}T${normalized.localTime}`;
  const targetWall = Date.parse(`${targetKey}:00Z`);
  if (!Number.isFinite(targetWall) || new Date(targetWall).toISOString().slice(0, 16) !== targetKey)
    throw new Error('Invalid local reminder date.');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: normalized.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const firstInstantByWallMinute = new Map<string, number>();
  for (let instant = targetWall - 18 * 60 * 60 * 1000; instant <= targetWall + 18 * 60 * 60 * 1000; instant += 60000) {
    const key = zonedMinuteKey(instant, formatter);
    if (!firstInstantByWallMinute.has(key)) firstInstantByWallMinute.set(key, instant);
  }
  const exact = firstInstantByWallMinute.get(targetKey);
  if (exact !== undefined) return exact;
  for (let minute = 1; minute <= 180; minute += 1) {
    const nextKey = new Date(targetWall + minute * 60000).toISOString().slice(0, 16);
    const next = firstInstantByWallMinute.get(nextKey);
    if (next !== undefined) return next;
  }
  throw new Error('The reminder time could not be resolved in this time zone.');
}
