import { addLocalDays, buildDayTimeline, localDayKey, localDayStart } from './analytics.ts';
import { activityKey } from './habits.ts';
import { duration, isDurationOnly, type Habit, type Session, type TimerState } from './timer.ts';

export type InsightsRange = { startDay: string; endDay: string };
export type InsightsPreset = 7 | 30 | 90;
export type InsightsDay = { dayKey: string; productiveMilliseconds: number; breakMilliseconds: number; untimedMilliseconds: number };
export type InsightsActivity = {
  key: string; name: string; productiveMilliseconds: number; share: number;
  completedSessions: number; averageCompletedSessionMilliseconds: number;
};
export type InsightsHabit = {
  habit: Habit; totalMilliseconds: number; recordedDays: number; eligibleDays: number;
  todayMilliseconds: number | null; todayGoalReached: boolean | null;
  days: { dayKey: string; milliseconds: number; state: 'none' | 'recorded' | 'current-goal-met' }[];
};
export type InsightsPattern = {
  weekdayAverages: { weekday: number; milliseconds: number; days: number }[];
  strongestWeekday: number | null;
  timeOfDay: { label: 'Night' | 'Morning' | 'Afternoon' | 'Evening'; milliseconds: number }[];
  strongestTimeOfDay: string | null;
  averageCompletedSessionMilliseconds: number;
  longestCompletedSessionMilliseconds: number;
  sessionLengthCounts: { label: string; count: number }[];
  recordedBreakCount: number;
  averageRecordedBreakMilliseconds: number;
};
export type InsightsReport = {
  range: InsightsRange; dayCount: number; days: InsightsDay[];
  summary: { trackedMilliseconds: number; productiveMilliseconds: number; breakMilliseconds: number; completedSessions: number; averageDailyProductiveMilliseconds: number };
  previousProductiveMilliseconds: number;
  comparison: { differenceMilliseconds: number; percentChange: number | null };
  trend: { startDay: string; endDay: string; productiveMilliseconds: number }[];
  activities: InsightsActivity[];
  habits: InsightsHabit[];
  patterns: InsightsPattern;
  observations: string[];
};

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
function validDay(day: string): boolean {
  return dayPattern.test(day) && localDayKey(localDayStart(day)) === day;
}

export function makeInsightsRange(now: number, preset: InsightsPreset): InsightsRange {
  const endDay = localDayKey(now);
  return { startDay: addLocalDays(endDay, 1 - preset), endDay };
}

export function insightsDayKeys(range: InsightsRange): string[] {
  if (!validDay(range.startDay) || !validDay(range.endDay) || range.startDay > range.endDay) throw new Error('Invalid insights date range');
  const result: string[] = [];
  for (let key = range.startDay; key <= range.endDay; key = addLocalDays(key, 1)) {
    if (result.length >= 366) throw new Error('Insights range cannot exceed 366 days');
    result.push(key);
  }
  return result;
}

function relevantSessions(state: TimerState, now: number, range: InsightsRange): TimerState {
  const start = localDayStart(range.startDay);
  const end = localDayStart(addLocalDays(range.endDay, 1));
  const seen = new Set<string>();
  const relevant = (session: Session) => isDurationOnly(session)
    ? !!session.localDate && session.localDate >= range.startDay && session.localDate <= range.endDay
    : session.segments.some(segment => segment.startedAt < end && (segment.endedAt ?? now) > start)
      || (session.endedAt !== null && session.endedAt >= start && session.endedAt < end);
  const completed = state.completed.filter(session => {
    if (seen.has(session.id)) return false;
    seen.add(session.id);
    return relevant(session);
  });
  return { ...state, completed, active: state.active && !seen.has(state.active.id) && relevant(state.active) ? state.active : null };
}

function completionDay(session: Session): string | null {
  return isDurationOnly(session) ? session.localDate ?? null : session.endedAt === null ? null : localDayKey(session.endedAt);
}

function dayTotals(state: TimerState, now: number, keys: string[]): InsightsDay[] {
  return keys.map(dayKey => {
    const timeline = buildDayTimeline(state, now, dayKey, { includeBreaks: true });
    return {
      dayKey,
      productiveMilliseconds: timeline.activityMilliseconds + timeline.unscheduledMilliseconds,
      breakMilliseconds: timeline.breakMilliseconds,
      untimedMilliseconds: timeline.unscheduledMilliseconds,
    };
  });
}

function trendGroups(days: InsightsDay[]): InsightsReport['trend'] {
  const size = days.length > 45 ? 7 : 1;
  const result: InsightsReport['trend'] = [];
  for (let index = 0; index < days.length; index += size) {
    const group = days.slice(index, index + size);
    result.push({ startDay: group[0].dayKey, endDay: group.at(-1)!.dayKey, productiveMilliseconds: group.reduce((total, day) => total + day.productiveMilliseconds, 0) });
  }
  return result;
}

export function analyzeInsights(state: TimerState, now: number, range: InsightsRange): InsightsReport {
  const keys = insightsDayKeys(range);
  const previousEnd = addLocalDays(range.startDay, -1);
  const previousStart = addLocalDays(previousEnd, 1 - keys.length);
  const relevant = relevantSessions(state, now, { startDay: previousStart, endDay: range.endDay });
  const days = dayTotals(relevant, now, keys);
  const previousDays = dayTotals(relevant, now, insightsDayKeys({ startDay: previousStart, endDay: previousEnd }));
  const productiveMilliseconds = days.reduce((sum, day) => sum + day.productiveMilliseconds, 0);
  const breakMilliseconds = days.reduce((sum, day) => sum + day.breakMilliseconds, 0);
  const previousProductiveMilliseconds = previousDays.reduce((sum, day) => sum + day.productiveMilliseconds, 0);
  const completed = relevant.completed.filter(session => {
    const day = completionDay(session);
    return day !== null && day >= range.startDay && day <= range.endDay;
  });
  const summary = {
    trackedMilliseconds: productiveMilliseconds + breakMilliseconds,
    productiveMilliseconds, breakMilliseconds, completedSessions: completed.length,
    averageDailyProductiveMilliseconds: productiveMilliseconds / keys.length,
  };
  const activityMap = new Map<string, { name: string; milliseconds: number; completedSessions: number; completedMilliseconds: number }>();
  const ensureActivity = (name: string) => {
    const key = activityKey(name);
    let value = activityMap.get(key);
    if (!value) { value = { name, milliseconds: 0, completedSessions: 0, completedMilliseconds: 0 }; activityMap.set(key, value); }
    return value;
  };
  const hourPattern: InsightsPattern['timeOfDay'] = [
    { label: 'Night', milliseconds: 0 }, { label: 'Morning', milliseconds: 0 },
    { label: 'Afternoon', milliseconds: 0 }, { label: 'Evening', milliseconds: 0 },
  ];
  for (const dayKey of keys) {
    const timeline = buildDayTimeline(relevant, now, dayKey);
    const base = new Date(timeline.dayStartedAt);
    const limits = [0, 6, 12, 18, 24].map(hour => new Date(base.getFullYear(), base.getMonth(), base.getDate() + (hour === 24 ? 1 : 0), hour === 24 ? 0 : hour).getTime());
    for (const slice of timeline.slices) {
      if (slice.category !== 'activity') continue;
      ensureActivity(slice.name).milliseconds += slice.milliseconds;
      for (let index = 0; index < 4; index += 1) hourPattern[index].milliseconds += Math.max(0, Math.min(slice.endedAt, limits[index + 1]) - Math.max(slice.startedAt, limits[index]));
    }
  }
  for (const session of relevant.completed) {
    if (isDurationOnly(session) && session.localDate && session.localDate >= range.startDay && session.localDate <= range.endDay) {
      ensureActivity(session.name).milliseconds += Math.max(0, session.durationMilliseconds ?? 0);
    }
  }
  for (const session of completed) {
    const item = ensureActivity(session.name);
    item.completedSessions += 1;
    item.completedMilliseconds += duration(session, session.endedAt ?? now);
  }
  const activities = [...activityMap].map(([key, item]) => ({
    key, name: item.name, productiveMilliseconds: item.milliseconds,
    share: productiveMilliseconds > 0 ? item.milliseconds / productiveMilliseconds : 0,
    completedSessions: item.completedSessions,
    averageCompletedSessionMilliseconds: item.completedSessions ? item.completedMilliseconds / item.completedSessions : 0,
  })).filter(item => item.productiveMilliseconds > 0 || item.completedSessions > 0)
    .sort((a, b) => b.productiveMilliseconds - a.productiveMilliseconds || a.name.localeCompare(b.name));
  const today = localDayKey(now);
  const habits = state.habits.map(habit => {
    const key = activityKey(habit.name);
    const daysForHabit = keys.filter(dayKey => dayKey <= today).map(dayKey => {
      const milliseconds = buildDayTimeline(relevant, now, dayKey, { activity: habit.name }).activityMilliseconds
        + relevant.completed.filter(session => isDurationOnly(session) && session.localDate === dayKey && activityKey(session.name) === key).reduce((sum, session) => sum + (session.durationMilliseconds ?? 0), 0);
      const state: 'none' | 'recorded' | 'current-goal-met' = milliseconds <= 0 ? 'none' : dayKey === today && milliseconds >= habit.goalMinutes * 60_000 ? 'current-goal-met' : 'recorded';
      return { dayKey, milliseconds, state };
    });
    const todayValue = daysForHabit.find(day => day.dayKey === today);
    return {
      habit, days: daysForHabit, eligibleDays: daysForHabit.length,
      recordedDays: daysForHabit.filter(day => day.milliseconds > 0).length,
      totalMilliseconds: daysForHabit.reduce((sum, day) => sum + day.milliseconds, 0),
      todayMilliseconds: todayValue?.milliseconds ?? null,
      todayGoalReached: todayValue ? todayValue.milliseconds >= habit.goalMinutes * 60_000 : null,
    };
  });
  const weekdayAverages = Array.from({ length: 7 }, (_, weekday) => {
    const matching = days.filter(day => new Date(localDayStart(day.dayKey)).getDay() === weekday);
    return { weekday, milliseconds: matching.reduce((sum, day) => sum + day.productiveMilliseconds, 0) / (matching.length || 1), days: matching.length };
  });
  const strongestDay = weekdayAverages.filter(item => item.days > 0 && item.milliseconds > 0).sort((a, b) => b.milliseconds - a.milliseconds)[0];
  const strongestTime = [...hourPattern].sort((a, b) => b.milliseconds - a.milliseconds)[0];
  const completedDurations = completed.map(session => duration(session, session.endedAt ?? now));
  const breaks = [...relevant.completed, ...(relevant.active ? [relevant.active] : [])].flatMap(session => session.segments.filter(segment => segment.kind === 'break').map(segment => {
    const from = Math.max(segment.startedAt, localDayStart(range.startDay));
    const to = Math.min(segment.endedAt ?? now, now, localDayStart(addLocalDays(range.endDay, 1)));
    return Math.max(0, to - from);
  })).filter(milliseconds => milliseconds > 0);
  const patterns: InsightsPattern = {
    weekdayAverages, strongestWeekday: strongestDay?.weekday ?? null,
    timeOfDay: hourPattern, strongestTimeOfDay: strongestTime?.milliseconds ? strongestTime.label : null,
    averageCompletedSessionMilliseconds: completedDurations.reduce((sum, value) => sum + value, 0) / (completedDurations.length || 1),
    longestCompletedSessionMilliseconds: Math.max(0, ...completedDurations),
    sessionLengthCounts: [
      { label: '<15m', count: completedDurations.filter(value => value < 15 * 60_000).length },
      { label: '15–30m', count: completedDurations.filter(value => value >= 15 * 60_000 && value < 30 * 60_000).length },
      { label: '30–60m', count: completedDurations.filter(value => value >= 30 * 60_000 && value < 60 * 60_000).length },
      { label: '60m+', count: completedDurations.filter(value => value >= 60 * 60_000).length },
    ],
    recordedBreakCount: breaks.length,
    averageRecordedBreakMilliseconds: breaks.reduce((sum, value) => sum + value, 0) / (breaks.length || 1),
  };
  const observations: string[] = [];
  if (productiveMilliseconds > 0 && previousProductiveMilliseconds > 0
    && Math.abs(productiveMilliseconds - previousProductiveMilliseconds) >= 60_000) {
    const difference = productiveMilliseconds - previousProductiveMilliseconds;
    observations.push((difference >= 0 ? 'Productive time increased by ' : 'Productive time decreased by ')
      + Math.abs(Math.round(difference / 60_000)) + ' minutes compared with the previous ' + keys.length + ' days.');
  }
  if (strongestDay && strongestDay.days >= 2) observations.push('Your highest average weekday in this range was '
    + new Date(localDayStart(keys.find(key => new Date(localDayStart(key)).getDay() === strongestDay.weekday)!)).toLocaleDateString('en-US', { weekday: 'long' }) + '.');
  if (activities[0]?.share >= .25 && activities[0].productiveMilliseconds >= 60 * 60_000) observations.push(
    activities[0].name + ' accounted for ' + Math.round(activities[0].share * 100) + '% of productive time in this range.');
  if (completed.length >= 3) observations.push('Completed sessions averaged '
    + Math.round(patterns.averageCompletedSessionMilliseconds / 60_000) + ' productive minutes.');
  return {
    range, dayCount: keys.length, days, summary, previousProductiveMilliseconds,
    comparison: { differenceMilliseconds: productiveMilliseconds - previousProductiveMilliseconds, percentChange: previousProductiveMilliseconds ? (productiveMilliseconds - previousProductiveMilliseconds) / previousProductiveMilliseconds * 100 : null },
    trend: trendGroups(days), activities, habits, patterns, observations,
  };
}
