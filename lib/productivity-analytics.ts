import { addLocalDays, buildDayTimeline, dailyActivity, localDayKey, localDayStart } from './analytics.ts';
import { isDurationOnly, type TimerState } from './timer.ts';

export type AnalyticsPeriod = 'day' | 'week' | 'month';
export type HourBucket = { startedAt: number; endedAt: number; productiveMilliseconds: number; personalMilliseconds: number; breakMilliseconds: number };

export function periodDayKeys(anchorKey: string, period: AnalyticsPeriod): string[] {
  if (period === 'day') return [anchorKey];
  const anchor = new Date(localDayStart(anchorKey));
  if (period === 'week') {
    const monday = addLocalDays(anchorKey, -((anchor.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => addLocalDays(monday, index));
  }
  const first = localDayKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1).getTime());
  const count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => addLocalDays(first, index));
}

export function shiftPeriod(anchorKey: string, period: AnalyticsPeriod, direction: -1 | 1): string {
  if (period !== 'month') return addLocalDays(anchorKey, direction * (period === 'week' ? 7 : 1));
  const anchor = new Date(localDayStart(anchorKey));
  return localDayKey(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1).getTime());
}

export function dayActivityBuckets(state: TimerState, now: number, dayKey: string, activity?: string): HourBucket[] {
  const timeline = buildDayTimeline(state, now, dayKey, { activity, includeBreaks: true });
  const result: HourBucket[] = [];
  for (let startedAt = timeline.dayStartedAt; startedAt < timeline.dayEndedAt; startedAt += 3_600_000) {
    const endedAt = Math.min(startedAt + 3_600_000, timeline.dayEndedAt);
    const sum = (category: 'activity' | 'break', productive?: boolean) => timeline.slices.reduce((total, slice) => {
      if (slice.category !== category) return total;
      if (category === 'activity' && productive !== undefined && (slice.countsProductive !== false) !== productive) return total;
      return total + Math.max(0, Math.min(endedAt, slice.endedAt) - Math.max(startedAt, slice.startedAt));
    }, 0);
    result.push({ startedAt, endedAt, productiveMilliseconds: sum('activity', true), personalMilliseconds: sum('activity', false), breakMilliseconds: sum('break') });
  }
  return result;
}

export function periodSummary(state: TimerState, now: number, dayKeys: string[]) {
  const keys = new Set(dayKeys);
  let trackedMilliseconds = 0;
  let productiveMilliseconds = 0;
  let personalMilliseconds = 0;
  let travelMilliseconds = 0;
  for (const dayKey of dayKeys) {
    const day = buildDayTimeline(state, now, dayKey, { includeBreaks: true });
    trackedMilliseconds += day.trackedActivityMilliseconds;
    productiveMilliseconds += day.productiveMilliseconds;
    personalMilliseconds += day.personalMilliseconds;
    travelMilliseconds += day.travelMilliseconds;
  }
  const sessionCount = state.completed.filter(session => {
    const dayKey = isDurationOnly(session) ? session.localDate : session.endedAt === null ? null : localDayKey(session.endedAt);
    return dayKey !== null && dayKey !== undefined && keys.has(dayKey);
  }).length;
  const today = localDayKey(now);
  let goalsCompleted = 0;
  for (const habit of state.habits) {
    const activity = dailyActivity(state, now, habit.name);
    for (const dayKey of dayKeys) {
      if (dayKey <= today && (activity.get(dayKey)?.milliseconds ?? 0) >= habit.goalMinutes * 60_000) goalsCompleted += 1;
    }
  }
  return { trackedMilliseconds, productiveMilliseconds, personalMilliseconds, travelMilliseconds, sessionCount, goalsCompleted };
}

export function productiveTrend(state: TimerState, now: number, dayKeys: string[]) {
  return dayKeys.map(dayKey => {
    const day = buildDayTimeline(state, now, dayKey);
    return { dayKey, milliseconds: day.productiveMilliseconds, future: dayKey > localDayKey(now) };
  });
}

export function completedProductiveTotal(state: TimerState, now: number): number {
  const days = new Set<string>();
  for (const session of state.completed) {
    if (isDurationOnly(session)) { if (session.localDate) days.add(session.localDate); continue; }
    for (const segment of session.segments) {
      if (segment.kind !== 'study' || segment.endedAt === null || segment.endedAt <= segment.startedAt) continue;
      const last = localDayKey(segment.endedAt - 1);
      for (let day = localDayKey(segment.startedAt); day <= last; day = addLocalDays(day, 1)) days.add(day);
    }
  }
  const completedState = { ...state, active: null };
  return [...days].reduce((total, day) => total + buildDayTimeline(completedState, now, day).productiveMilliseconds, 0);
}

export function habitPeriodProgress(state: TimerState, now: number, dayKeys: string[]) {
  const eligible = dayKeys.filter(dayKey => dayKey <= localDayKey(now));
  return state.habits.map(habit => {
    const activity = dailyActivity(state, now, habit.name);
    const minutes = eligible.reduce((total, dayKey) => total + (activity.get(dayKey)?.milliseconds ?? 0) / 60_000, 0);
    const targetMinutes = habit.goalMinutes * eligible.length;
    const completedDays = eligible.filter(dayKey => (activity.get(dayKey)?.milliseconds ?? 0) >= habit.goalMinutes * 60_000).length;
    return { habit, minutes, targetMinutes, completedDays, eligibleDays: eligible.length, remainingMinutes: Math.max(0, targetMinutes - minutes), percentage: targetMinutes ? Math.min(100, minutes / targetMinutes * 100) : 0 };
  });
}
