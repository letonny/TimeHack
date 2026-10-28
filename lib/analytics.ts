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

function sessions(state: TimerState): Session[] {
  return [...state.completed, ...(state.active ? [state.active] : [])];
}

function productivePortions(session: Session, now: number, visit: (dayKey: string, milliseconds: number) => void) {
  for (const segment of session.segments) {
    if (segment.kind === 'break') continue;
    const end = Math.min(segment.endedAt ?? now, now);
    if (end <= segment.startedAt) continue;
    let cursor = segment.startedAt;
    while (cursor < end) {
      const dayKey = localDayKey(cursor);
      const nextDay = localDayStart(addLocalDays(dayKey, 1));
      const portionEnd = Math.min(end, nextDay);
      visit(dayKey, portionEnd - cursor);
      cursor = portionEnd;
    }
  }
}

export function dailyActivity(state: TimerState, now: number, activity?: string): Map<string, DayTotal> {
  const result = new Map<string, DayTotal>();
  const filter = activity ? activityKey(activity) : null;
  for (const session of sessions(state)) {
    if (filter && activityKey(session.name) !== filter) continue;
    const touched = new Set<string>();
    productivePortions(session, now, (dayKey, milliseconds) => {
      const current = result.get(dayKey) ?? { milliseconds: 0, sessionCount: 0 };
      result.set(dayKey, { milliseconds: current.milliseconds + milliseconds, sessionCount: current.sessionCount });
      touched.add(dayKey);
    });
    for (const dayKey of touched) {
      const current = result.get(dayKey)!;
      result.set(dayKey, { ...current, sessionCount: current.sessionCount + 1 });
    }
  }
  return result;
}

export function activityHistoryForDay(state: TimerState, dayKey: string, now: number, activity?: string): DayHistoryItem[] {
  const filter = activity ? activityKey(activity) : null;
  const items: DayHistoryItem[] = [];
  for (const session of sessions(state)) {
    if (filter && activityKey(session.name) !== filter) continue;
    let milliseconds = 0;
    productivePortions(session, now, (portionDay, portion) => {
      if (portionDay === dayKey) milliseconds += portion;
    });
    if (milliseconds > 0) items.push({ sessionId: session.id, name: session.name, milliseconds, startedAt: session.startedAt });
  }
  return items.sort((a, b) => b.startedAt - a.startedAt);
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
