import type { Session } from './timer.ts';

export type ManualRangeInput = {
  id: string; name: string; startDate: string; startTime: string; endDate: string; endTime: string;
  activityId?: string | null; note?: string;
};
export type ManualDurationInput = {
  id: string; name: string; localDate: string; hours: number; minutes: number;
  activityId?: string | null; note?: string;
};

const validNameAndNote = (nameValue: string, noteValue = '') => {
  const name = nameValue.trim();
  const note = noteValue.trim();
  if (!name || name.length > 120) throw new Error('Use an activity name between 1 and 120 characters.');
  if (note.length > 2000) throw new Error('Notes must be 2,000 characters or fewer.');
  return { name, note };
};

export function localDateTime(dateValue: string, timeValue: string): number {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) throw new Error('Choose a valid local date and time.');
  const [, year, month, day] = dateMatch.map(Number);
  const [, hours, minutes] = timeMatch.map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || date.getHours() !== hours || date.getMinutes() !== minutes)
    throw new Error('That local date or time does not exist.');
  return date.getTime();
}

export function createManualRange(input: ManualRangeInput, now: number): Session {
  const { name, note } = validNameAndNote(input.name, input.note);
  const startedAt = localDateTime(input.startDate, input.startTime);
  const endedAt = localDateTime(input.endDate, input.endTime);
  if (endedAt <= startedAt) throw new Error('End time must be after start time. Use the next date for an overnight entry.');
  if (startedAt > now || endedAt > now) throw new Error('Manual entries cannot be in the future.');
  return { id: input.id, name, startedAt, endedAt, segments: [{ kind: 'study', startedAt, endedAt }], entryType: 'manual_range', localDate: null, durationMilliseconds: null, activityId: input.activityId ?? null, note };
}

export function createManualDuration(input: ManualDurationInput, todayKey: string): Session {
  const { name, note } = validNameAndNote(input.name, input.note);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.localDate);
  if (!match) throw new Error('Choose a valid local date.');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const calendarDate = new Date(year, month - 1, day);
  if (calendarDate.getFullYear() !== year || calendarDate.getMonth() !== month - 1 || calendarDate.getDate() !== day || input.localDate > todayKey) throw new Error('Choose today or an earlier valid local date.');
  if (!Number.isInteger(input.hours) || !Number.isInteger(input.minutes) || input.hours < 0 || input.hours > 24 || input.minutes < 0 || input.minutes > 59)
    throw new Error('Use whole hours from 0–24 and whole minutes from 0–59.');
  const durationMilliseconds = (input.hours * 60 + input.minutes) * 60000;
  if (durationMilliseconds <= 0 || durationMilliseconds > 24 * 60 * 60000) throw new Error('Duration must be between 1 minute and 24 hours.');
  return { id: input.id, name, startedAt: null, endedAt: null, segments: [], entryType: 'manual_duration', localDate: input.localDate, durationMilliseconds, activityId: input.activityId ?? null, note };
}
