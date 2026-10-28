import { activityKey } from './habits.ts';
import type { Habit, Session, TimerState } from './timer.ts';

export type DayTotal = { milliseconds: number; sessionCount: number };
export type DayHistoryItem = { sessionId: string; name: string; milliseconds: number; startedAt: number };
export type Streaks = { current: number; longest: number };
export type GoalProgress = {
  minutes: number;
  goalMinutes: number;
  percentage: number;
  visualPercentage: number;
  remainingMinutes: number;
};
export type DayTimelineCategory = 'activity' | 'break' | 'untracked' | 'remaining';
export type DayTimelineSlice = {
  id: string;
  category: DayTimelineCategory;
  name: string;
  startedAt: number;
  endedAt: number;
  milliseconds: number;
  sessionId?: string;
};
export type DayTimeline = {
  dayKey: string;
  dayStartedAt: number;
  dayEndedAt: number;
  dayMilliseconds: number;
  elapsedAt: number;
  slices: DayTimelineSlice[];
  activityMilliseconds: number;
  breakMilliseconds: number;
  trackedMilliseconds: number;
  untrackedMilliseconds: number;
  remainingMilliseconds: number;
};

export function localDayKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function localDayStart(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function addLocalDays(dayKey: string, amount: number): string {
  const date = new Date(localDayStart(dayKey));
  date.setDate(date.getDate() + amount);
  return localDayKey(date.getTime());
}

export function formatDashboardDate(timestamp: number, locale = 'en-US') {
  const date = new Date(timestamp);
  return {
    weekday: date.toLocaleDateString(locale, { weekday: 'long' }).toUpperCase(),
    date: date.toLocaleDateString(locale, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
}

function sessions(state: TimerState): Session[] {
  return [...state.completed, ...(state.active ? [state.active] : [])];
}

type TimelineCandidate = {
  category: 'activity' | 'break'; name: string; sessionId: string;
  startedAt: number; endedAt: number; sourceStartedAt: number;
};

export function buildDayTimeline(
  state: TimerState,
  now: number,
  dayKey = localDayKey(now),
  options: { activity?: string; includeBreaks?: boolean } = {},
): DayTimeline {
  const dayStartedAt = localDayStart(dayKey);
  const dayEndedAt = localDayStart(addLocalDays(dayKey, 1));
  const todayKey = localDayKey(now);
  const elapsedAt = dayKey < todayKey ? dayEndedAt : dayKey > todayKey ? dayStartedAt : Math.min(Math.max(now, dayStartedAt), dayEndedAt);
  const filter = options.activity ? activityKey(options.activity) : null;
  const candidates: TimelineCandidate[] = [];

  for (const session of sessions(state)) {
    if (filter && activityKey(session.name) !== filter) continue;
    for (const segment of session.segments) {
      if (segment.kind === 'break' && !options.includeBreaks) continue;
      const startedAt = Math.max(segment.startedAt, dayStartedAt);
      const endedAt = Math.min(segment.endedAt ?? now, elapsedAt, dayEndedAt);
      if (endedAt <= startedAt) continue;
      candidates.push({
        category: segment.kind === 'break' ? 'break' : 'activity',
        name: segment.kind === 'break' ? 'Recorded breaks' : session.name,
        sessionId: session.id,
        startedAt,
        endedAt,
        sourceStartedAt: segment.startedAt,
      });
    }
  }

  const boundaries = [...new Set([
    dayStartedAt, elapsedAt, dayEndedAt,
    ...candidates.flatMap(candidate => [candidate.startedAt, candidate.endedAt]),
  ])].sort((a, b) => a - b);
  const raw: Omit<DayTimelineSlice, 'id' | 'milliseconds'>[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const startedAt = boundaries[index];
    const endedAt = boundaries[index + 1];
    if (endedAt <= startedAt) continue;
    let category: DayTimelineCategory;
    let name: string;
    let sessionId: string | undefined;
    if (startedAt >= elapsedAt) {
      category = 'remaining'; name = 'Remaining today';
    } else {
      const covering = candidates.filter(candidate => candidate.startedAt <= startedAt && candidate.endedAt >= endedAt).sort((a, b) => {
        if (a.category !== b.category) return a.category === 'activity' ? -1 : 1;
        return b.sourceStartedAt - a.sourceStartedAt || b.sessionId.localeCompare(a.sessionId);
      });
      const chosen = covering[0];
      category = chosen?.category ?? 'untracked';
      name = chosen?.name ?? 'Elapsed untracked';
      sessionId = chosen?.sessionId;
    }
    const previous = raw.at(-1);
    if (previous && previous.category === category && previous.name === name && previous.sessionId === sessionId && previous.endedAt === startedAt) {
      previous.endedAt = endedAt;
    } else raw.push({ category, name, sessionId, startedAt, endedAt });
  }

  const slices: DayTimelineSlice[] = raw.map((slice, index) => ({ ...slice, id: `${dayKey}-${index}`, milliseconds: slice.endedAt - slice.startedAt }));
  const sum = (category: DayTimelineCategory) => slices.reduce((total, slice) => total + (slice.category === category ? slice.milliseconds : 0), 0);
  const activityMilliseconds = sum('activity');
  const breakMilliseconds = sum('break');
  return {
    dayKey, dayStartedAt, dayEndedAt, dayMilliseconds: dayEndedAt - dayStartedAt, elapsedAt, slices,
    activityMilliseconds,
    breakMilliseconds,
    trackedMilliseconds: activityMilliseconds + breakMilliseconds,
    untrackedMilliseconds: sum('untracked'),
    remainingMilliseconds: sum('remaining'),
  };
}

export function dailyActivity(state: TimerState, now: number, activity?: string): Map<string, DayTotal> {
  const result = new Map<string, DayTotal>();
  const filter = activity ? activityKey(activity) : null;
  const dayKeys = new Set<string>();
  for (const session of sessions(state)) {
    if (filter && activityKey(session.name) !== filter) continue;
    for (const segment of session.segments) {
      if (segment.kind === 'break') continue;
      const endedAt = Math.min(segment.endedAt ?? now, now);
      if (endedAt <= segment.startedAt) continue;
      let dayKey = localDayKey(segment.startedAt);
      const lastDay = localDayKey(Math.max(segment.startedAt, endedAt - 1));
      while (dayKey <= lastDay) {
        dayKeys.add(dayKey);
        dayKey = addLocalDays(dayKey, 1);
      }
    }
  }
  for (const dayKey of dayKeys) {
    const timeline = buildDayTimeline(state, now, dayKey, { activity });
    const activitySlices = timeline.slices.filter(slice => slice.category === 'activity');
    if (!activitySlices.length) continue;
    result.set(dayKey, {
      milliseconds: activitySlices.reduce((total, slice) => total + slice.milliseconds, 0),
      sessionCount: new Set(activitySlices.map(slice => slice.sessionId)).size,
    });
  }
  return result;
}

export function activityHistoryForDay(state: TimerState, dayKey: string, now: number, activity?: string): DayHistoryItem[] {
  const filter = activity ? activityKey(activity) : null;
  const timeline = buildDayTimeline(state, now, dayKey, { activity });
  const bySession = new Map<string, DayHistoryItem>();
  for (const slice of timeline.slices) {
    if (slice.category !== 'activity' || !slice.sessionId) continue;
    const session = sessions(state).find(item => item.id === slice.sessionId);
    if (!session || (filter && activityKey(session.name) !== filter)) continue;
    const existing = bySession.get(session.id);
    if (existing) existing.milliseconds += slice.milliseconds;
    else bySession.set(session.id, { sessionId: session.id, name: session.name, milliseconds: slice.milliseconds, startedAt: session.startedAt });
  }
  return [...bySession.values()].sort((a, b) => b.startedAt - a.startedAt);
}

export function calculateGoalProgress(minutes: number, goalMinutes: number): GoalProgress {
  const safeMinutes = Math.max(0, Number.isFinite(minutes) ? minutes : 0);
  const safeGoal = Math.max(0, Number.isFinite(goalMinutes) ? goalMinutes : 0);
  const percentage = safeGoal > 0 ? safeMinutes / safeGoal * 100 : 0;
  return {
    minutes: safeMinutes,
    goalMinutes: safeGoal,
    percentage,
    visualPercentage: Math.min(100, percentage),
    remainingMinutes: Math.max(0, safeGoal - safeMinutes),
  };
}

export function habitGoalProgress(state: TimerState, habit: Habit, now: number): GoalProgress {
  const total = dailyActivity(state, now, habit.name).get(localDayKey(now))?.milliseconds ?? 0;
  return calculateGoalProgress(total / 60000, habit.goalMinutes);
}

export function streaksForQualifiedDays(qualifiedDays: Iterable<string>, todayKey: string): Streaks {
  const days = new Set(qualifiedDays);
  let current = 0;
  let cursor = days.has(todayKey) ? todayKey : addLocalDays(todayKey, -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addLocalDays(cursor, -1);
  }

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const dayKey of [...days].sort()) {
    run = previous && addLocalDays(previous, 1) === dayKey ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = dayKey;
  }
  return { current, longest };
}

export function activityStreaks(state: TimerState, now: number, activity?: string): Streaks {
  const totals = dailyActivity(state, now, activity);
  return streaksForQualifiedDays(
    [...totals].filter(([, total]) => total.milliseconds > 0).map(([dayKey]) => dayKey),
    localDayKey(now),
  );
}

export function habitGoalStreaks(state: TimerState, habit: Habit, now: number): Streaks {
  const totals = dailyActivity(state, now, habit.name);
  return streaksForQualifiedDays(
    [...totals].filter(([, total]) => total.milliseconds / 60000 >= habit.goalMinutes).map(([dayKey]) => dayKey),
    localDayKey(now),
  );
}

export function activityNames(state: TimerState): string[] {
  const names = new Map<string, string>();
  for (const habit of state.habits) names.set(activityKey(habit.name), habit.name);
  for (const session of sessions(state)) {
    const key = activityKey(session.name);
    if (!names.has(key)) names.set(key, session.name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
