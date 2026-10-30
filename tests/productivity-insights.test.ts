import assert from 'node:assert/strict';
import test from 'node:test';
import { addLocalDays, localDayKey } from '../lib/analytics.ts';
import { analyzeInsights, insightsDayKeys, makeInsightsRange } from '../lib/productivity-insights.ts';
import { emptyState, type Session, type TimerState } from '../lib/timer.ts';

const minute = 60_000;
const at = (day: number, hour = 0, minutes = 0, month = 10) => new Date(2026, month - 1, day, hour, minutes).getTime();
function session(id: string, name: string, start: number, end: number, breaks: { start: number; end: number }[] = []): Session {
  const segments: Session['segments'] = [];
  let cursor = start;
  for (const item of breaks) {
    if (cursor < item.start) segments.push({ kind: 'study', startedAt: cursor, endedAt: item.start });
    segments.push({ kind: 'break', startedAt: item.start, endedAt: item.end });
    cursor = item.end;
  }
  if (cursor < end) segments.push({ kind: 'study', startedAt: cursor, endedAt: end });
  return { id, name, startedAt: start, endedAt: end, segments };
}
const range = (startDay: string, endDay = startDay) => ({ startDay, endDay });

test('empty history has zero metrics and no unsupported observations', () => {
  const now = at(30, 12);
  const report = analyzeInsights(emptyState(), now, makeInsightsRange(now, 7));
  assert.equal(report.dayCount, 7);
  assert.equal(report.summary.trackedMilliseconds, 0);
  assert.equal(report.summary.averageDailyProductiveMilliseconds, 0);
  assert.deepEqual(report.activities, []);
  assert.deepEqual(report.observations, []);
  assert.equal(report.comparison.percentChange, null);
  assert.equal(report.patterns.strongestWeekday, null);
});

test('local inclusive ranges validate calendar dates and limit work', () => {
  assert.deepEqual(insightsDayKeys(range('2026-10-29', '2026-10-30')), ['2026-10-29', '2026-10-30']);
  assert.equal(insightsDayKeys(makeInsightsRange(at(30), 30)).length, 30);
  assert.equal(insightsDayKeys(makeInsightsRange(at(30), 90)).length, 90);
  assert.throws(() => insightsDayKeys(range('2026-02-30')), /Invalid/);
  assert.throws(() => insightsDayKeys(range('2026-10-31', '2026-10-30')), /Invalid/);
  assert.throws(() => insightsDayKeys(range('2025-01-01', '2026-10-30')), /366/);
});

test('productive, recorded breaks and pauses are separate; current day is included in calendar average', () => {
  const now = at(30, 13);
  const state: TimerState = { ...emptyState(), completed: [
    { id: 'first', name: 'Gym', startedAt: at(29, 23, 30), endedAt: at(30, 0, 40), segments: [
      { kind: 'study', startedAt: at(29, 23, 30), endedAt: at(30, 0) },
      { kind: 'break', startedAt: at(30, 0), endedAt: at(30, 0, 10) },
      { kind: 'study', startedAt: at(30, 0, 20), endedAt: at(30, 0, 40) },
    ] },
    session('second', 'Reading', at(30, 9), at(30, 9, 30)),
  ] };
  const report = analyzeInsights(state, now, range('2026-10-29', '2026-10-30'));
  assert.equal(report.summary.productiveMilliseconds, 80 * minute);
  assert.equal(report.summary.breakMilliseconds, 10 * minute);
  assert.equal(report.summary.trackedMilliseconds, 90 * minute);
  assert.equal(report.summary.completedSessions, 2);
  assert.equal(report.summary.averageDailyProductiveMilliseconds, 40 * minute);
  assert.equal(report.days[0].productiveMilliseconds, 30 * minute);
  assert.equal(report.days[1].productiveMilliseconds, 50 * minute);
  assert.equal(report.activities.reduce((sum, item) => sum + item.share, 0), 1);
});

test('overlapping sessions and repeated IDs cannot inflate period or activity percentages', () => {
  const a = session('a', 'Gym', at(30, 9), at(30, 10));
  const b = session('b', 'Study', at(30, 9, 30), at(30, 10, 30));
  const state: TimerState = { ...emptyState(), completed: [a, a, b] };
  const report = analyzeInsights(state, at(30, 12), range('2026-10-30'));
  assert.equal(report.summary.productiveMilliseconds, 90 * minute);
  assert.equal(report.summary.completedSessions, 2);
  assert.equal(report.activities.reduce((sum, item) => sum + item.productiveMilliseconds, 0), 90 * minute);
  assert.ok(Math.abs(report.activities.reduce((sum, item) => sum + item.share, 0) - 1) < 1e-9);
});

test('live time stops at now; duration-only records affect totals but not clock patterns', () => {
  const active: Session = { id: 'live', name: 'Gym', startedAt: at(30, 11), endedAt: null, segments: [{ kind: 'study', startedAt: at(30, 11), endedAt: null }] };
  const state: TimerState = { ...emptyState(), active, completed: [
    { id: 'untimed', name: 'Reading', startedAt: null, endedAt: null, segments: [], entryType: 'manual_duration', localDate: '2026-10-30', durationMilliseconds: 20 * minute },
  ] };
  const report = analyzeInsights(state, at(30, 11, 30), range('2026-10-30'));
  assert.equal(report.summary.productiveMilliseconds, 50 * minute);
  assert.equal(report.summary.completedSessions, 1);
  assert.equal(report.days[0].untimedMilliseconds, 20 * minute);
  assert.equal(report.patterns.timeOfDay.reduce((sum, item) => sum + item.milliseconds, 0), 30 * minute);
  assert.equal(report.activities.find(item => item.name === 'Reading')?.productiveMilliseconds, 20 * minute);
});

test('exact range edges exclude outside intervals but count a zero-duration completion on its end date', () => {
  const boundary = at(30);
  const state: TimerState = { ...emptyState(), completed: [
    session('before', 'Study', boundary - 10 * minute, boundary - 1),
    { id: 'zero', name: 'Study', startedAt: boundary + minute, endedAt: boundary + minute, segments: [
      { kind: 'study', startedAt: boundary + minute, endedAt: boundary + minute },
    ] },
    session('after', 'Study', at(31), at(31, 0, 10)),
  ] };
  const report = analyzeInsights(state, at(30, 12), range('2026-10-30'));
  assert.equal(report.summary.productiveMilliseconds, 0);
  assert.equal(report.summary.completedSessions, 1);
  assert.equal(report.activities[0].completedSessions, 1);
});

test('prior-period comparison uses equal local days and never divides by zero', () => {
  const state: TimerState = { ...emptyState(), completed: [
    session('old', 'Gym', at(28, 9), at(28, 9, 20)),
    session('new', 'Gym', at(30, 9), at(30, 9, 30)),
  ] };
  const report = analyzeInsights(state, at(30, 12), range('2026-10-29', '2026-10-30'));
  assert.equal(report.previousProductiveMilliseconds, 20 * minute);
  assert.equal(report.comparison.differenceMilliseconds, 10 * minute);
  assert.equal(report.comparison.percentChange, 50);
  const zero = analyzeInsights({ ...emptyState(), completed: [state.completed[1]] }, at(30, 12), range('2026-10-29', '2026-10-30'));
  assert.equal(zero.comparison.percentChange, null);
  assert.equal(zero.comparison.differenceMilliseconds, 30 * minute);
});

test('habit history reports recorded days but does not infer historical goal completion', () => {
  const state: TimerState = { ...emptyState(), habits: [{ id: 'gym', name: 'Gym', goalMinutes: 60 }], completed: [
    session('old', 'Gym', at(29, 9), at(29, 9, 30)),
    session('today', 'Gym', at(30, 9), at(30, 10)),
  ] };
  const habit = analyzeInsights(state, at(30, 12), range('2026-10-29', '2026-10-30')).habits[0];
  assert.equal(habit.recordedDays, 2);
  assert.equal(habit.todayGoalReached, true);
  assert.deepEqual(habit.days.map(day => day.state), ['recorded', 'current-goal-met']);
  assert.equal(habit.totalMilliseconds, 90 * minute);
});

test('90-day trends use readable week groups while date boundaries remain local', () => {
  const now = at(30, 12);
  const report = analyzeInsights(emptyState(), now, makeInsightsRange(now, 90));
  assert.equal(report.trend.length, 13);
  assert.equal(report.trend[0].startDay, addLocalDays(localDayKey(now), -89));
  assert.equal(report.trend.at(-1)?.endDay, localDayKey(now));
});

test('local DST days use real elapsed instants and weekday averages use calendar occurrences', () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const spring: Session = session('spring', 'Study', new Date(2026, 2, 8, 1, 30).getTime(), new Date(2026, 2, 8, 3, 30).getTime());
    const state: TimerState = { ...emptyState(), completed: [spring] };
    const report = analyzeInsights(state, new Date(2026, 2, 9, 12).getTime(), range('2026-03-08', '2026-03-09'));
    assert.equal(report.summary.productiveMilliseconds, 60 * minute);
    assert.equal(report.days[0].productiveMilliseconds, 60 * minute);
    assert.equal(report.patterns.weekdayAverages[0].milliseconds, 60 * minute);
    assert.equal(report.patterns.timeOfDay[0].milliseconds, 60 * minute);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
