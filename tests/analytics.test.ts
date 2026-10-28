import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityHistoryForDay, activityStreaks, calculateGoalProgress, dailyActivity,
  habitGoalStreaks, localDayKey, streaksForQualifiedDays,
} from '../lib/analytics.ts';
import { emptyState, type Session, type TimerState } from '../lib/timer.ts';

const minute = 60_000;
const at = (year: number, month: number, day: number, hour = 0, minutes = 0) => new Date(year, month - 1, day, hour, minutes).getTime();
const session = (id: string, name: string, segments: Session['segments']): Session => ({
  id, name, startedAt: segments[0].startedAt, endedAt: segments.at(-1)!.endedAt, segments,
});
const stateWith = (...completed: Session[]): TimerState => ({ ...emptyState(), completed });

test('progress reports actual percentages while capping only the visual ring', () => {
  assert.deepEqual(calculateGoalProgress(0, 30), { minutes: 0, goalMinutes: 30, percentage: 0, visualPercentage: 0, remainingMinutes: 30 });
  assert.deepEqual(calculateGoalProgress(45, 30), { minutes: 45, goalMinutes: 30, percentage: 150, visualPercentage: 100, remainingMinutes: 0 });
});

test('zero-activity days remain empty and are not counted in streaks', () => {
  const now = at(2026, 10, 28, 12);
  assert.equal(dailyActivity(emptyState(), now).get(localDayKey(now)), undefined);
  assert.deepEqual(activityStreaks(emptyState(), now), { current: 0, longest: 0 });
  assert.deepEqual(activityHistoryForDay(emptyState(), localDayKey(now), now), []);
});

test('overnight study is split at local midnight and break time is excluded', () => {
  const start = at(2026, 10, 27, 23, 30);
  const midnight = at(2026, 10, 28);
  const done = at(2026, 10, 28, 1);
  const state = stateWith(session('s', 'Study', [
    { kind: 'study', startedAt: start, endedAt: midnight + 30 * minute },
    { kind: 'break', startedAt: midnight + 30 * minute, endedAt: done },
  ]));
  const totals = dailyActivity(state, done);
  assert.equal(totals.get('2026-10-27')!.milliseconds, 30 * minute);
  assert.equal(totals.get('2026-10-28')!.milliseconds, 30 * minute);
  assert.equal(activityHistoryForDay(state, '2026-10-28', done)[0].milliseconds, 30 * minute);
});

test('current streak survives an incomplete today but stops after a missed yesterday', () => {
  assert.deepEqual(streaksForQualifiedDays(['2026-10-25', '2026-10-26', '2026-10-27'], '2026-10-28'), { current: 3, longest: 3 });
  assert.deepEqual(streaksForQualifiedDays(['2026-10-24', '2026-10-25', '2026-10-28'], '2026-10-28'), { current: 1, longest: 2 });
  assert.deepEqual(streaksForQualifiedDays(['2026-10-24', '2026-10-26'], '2026-10-28'), { current: 0, longest: 1 });
});

test('habit goal streak requires goal minutes and allows today to remain incomplete', () => {
  const habit = { id: 'h', name: 'Study', goalMinutes: 30 };
  const state: TimerState = { ...emptyState(), habits: [habit], active: null, completed: [
    session('a', 'Study', [{ kind: 'study', startedAt: at(2026, 10, 26, 9), endedAt: at(2026, 10, 26, 9, 30) }]),
    session('b', 'study', [{ kind: 'study', startedAt: at(2026, 10, 27, 9), endedAt: at(2026, 10, 27, 9, 45) }]),
    session('c', 'Study', [{ kind: 'study', startedAt: at(2026, 10, 28, 9), endedAt: at(2026, 10, 28, 9, 10) }]),
  ] };
  assert.deepEqual(habitGoalStreaks(state, habit, at(2026, 10, 28, 12)), { current: 2, longest: 2 });
});
