import assert from 'node:assert/strict';
import test from 'node:test';
import { addLocalDays, localDayKey } from '../lib/analytics.ts';
import { dayActivityBuckets, habitPeriodProgress, periodDayKeys, periodSummary, productiveTrend, shiftPeriod } from '../lib/productivity-analytics.ts';
import { emptyState, type Session, type TimerState } from '../lib/timer.ts';

const minute = 60_000;
const at = (year: number, month: number, day: number, hour = 0, minutes = 0) => new Date(year, month - 1, day, hour, minutes).getTime();
const session = (id: string, name: string, segments: Session['segments'], endedAt = segments.at(-1)?.endedAt ?? null): Session => ({
  id, name, segments, startedAt: segments[0].startedAt, endedAt,
});

test('empty periods and hourly buckets show zero actual activity', () => {
  const now = at(2026, 10, 30, 12);
  const state = emptyState();
  const dayKey = localDayKey(now);
  assert.deepEqual(periodSummary(state, now, [dayKey]), { trackedMilliseconds: 0, productiveMilliseconds: 0, sessionCount: 0, goalsCompleted: 0 });
  assert.ok(dayActivityBuckets(state, now, dayKey).every(bucket => bucket.productiveMilliseconds === 0 && bucket.breakMilliseconds === 0));
  assert.deepEqual(productiveTrend(state, now, [dayKey]), [{ dayKey, milliseconds: 0, future: false }]);
});

test('multiple sessions, breaks and paused gaps aggregate without double counting', () => {
  const now = at(2026, 10, 30, 14);
  const dayKey = localDayKey(now);
  const state: TimerState = { ...emptyState(), habits: [{ id: 'h', name: 'Gym', goalMinutes: 60 }], completed: [
    session('a', 'Gym', [
      { kind: 'study', startedAt: at(2026, 10, 30, 9), endedAt: at(2026, 10, 30, 9, 30) },
      { kind: 'break', startedAt: at(2026, 10, 30, 9, 30), endedAt: at(2026, 10, 30, 9, 40) },
      { kind: 'study', startedAt: at(2026, 10, 30, 10), endedAt: at(2026, 10, 30, 10, 20) },
    ]),
    session('b', 'Gym', [{ kind: 'study', startedAt: at(2026, 10, 30, 11), endedAt: at(2026, 10, 30, 11, 20) }]),
  ] };
  const summary = periodSummary(state, now, [dayKey]);
  assert.equal(summary.trackedMilliseconds, 80 * minute);
  assert.equal(summary.productiveMilliseconds, 70 * minute);
  assert.equal(summary.sessionCount, 2);
  assert.equal(summary.goalsCompleted, 1);
  const buckets = dayActivityBuckets(state, now, dayKey);
  assert.equal(buckets[9].productiveMilliseconds, 30 * minute);
  assert.equal(buckets[9].breakMilliseconds, 10 * minute);
  assert.equal(buckets[10].productiveMilliseconds, 20 * minute);
  assert.equal(buckets[11].productiveMilliseconds, 20 * minute);
  assert.equal(habitPeriodProgress(state, now, [dayKey])[0].remainingMinutes, 0);
});

test('overnight sessions split at local midnight and untimed entries do not enter hourly buckets', () => {
  const before = at(2026, 10, 29, 23, 30);
  const after = at(2026, 10, 30, 0, 30);
  const dayKey = localDayKey(after);
  const state: TimerState = { ...emptyState(), completed: [
    session('overnight', 'Study', [{ kind: 'study', startedAt: before, endedAt: after }]),
    { id: 'manual', name: 'Reading', startedAt: null, endedAt: null, segments: [], entryType: 'manual_duration', localDate: dayKey, durationMilliseconds: 15 * minute },
  ] };
  const summary = periodSummary(state, after + minute, [dayKey]);
  assert.equal(summary.productiveMilliseconds, 45 * minute);
  assert.equal(summary.sessionCount, 2);
  assert.equal(dayActivityBuckets(state, after + minute, dayKey)[0].productiveMilliseconds, 30 * minute);
  assert.equal(dayActivityBuckets(state, after + minute, dayKey).reduce((sum, bucket) => sum + bucket.productiveMilliseconds, 0), 30 * minute);
  assert.equal(periodSummary(state, after + minute, [addLocalDays(dayKey, -1)]).productiveMilliseconds, 30 * minute);
});

test('live sessions advance only through now and activity filtering remains account-local', () => {
  const start = at(2026, 10, 30, 9);
  const state: TimerState = { ...emptyState(), active: session('active', 'Gym', [{ kind: 'study', startedAt: start, endedAt: null }], null), completed: [
    session('study', 'Study', [{ kind: 'study', startedAt: start, endedAt: start + 10 * minute }]),
  ] };
  const key = localDayKey(start);
  assert.equal(periodSummary(state, start + 5 * minute, [key]).productiveMilliseconds, 5 * minute);
  assert.equal(periodSummary(state, start + 20 * minute, [key]).productiveMilliseconds, 20 * minute);
  assert.equal(dayActivityBuckets(state, start + 20 * minute, key, 'Gym')[9].productiveMilliseconds, 20 * minute);
  assert.equal(dayActivityBuckets(state, start + 20 * minute, key, 'Study')[9].productiveMilliseconds, 10 * minute);
});

test('week and month navigation use local calendar boundaries', () => {
  assert.deepEqual(periodDayKeys('2026-10-30', 'week'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(periodDayKeys('2026-10-30', 'month').length, 31);
  assert.equal(periodDayKeys('2026-02-10', 'month').length, 28);
  assert.equal(shiftPeriod('2026-10-30', 'month', 1), '2026-11-01');
  assert.equal(shiftPeriod('2026-10-30', 'week', -1), '2026-10-23');
});

test('weekly daily-goal completions stay distinct from combined time progress', () => {
  const now = at(2026, 10, 30, 14);
  const keys = [localDayKey(at(2026, 10, 29)), localDayKey(now)];
  const state: TimerState = { ...emptyState(), habits: [{ id: 'h', name: 'Study', goalMinutes: 30 }], completed: [
    session('long', 'Study', [{ kind: 'study', startedAt: at(2026, 10, 29, 9), endedAt: at(2026, 10, 29, 10) }]),
  ] };
  const progress = habitPeriodProgress(state, now, keys)[0];
  assert.equal(progress.percentage, 100);
  assert.equal(progress.completedDays, 1);
  assert.equal(progress.eligibleDays, 2);
  assert.equal(periodSummary(state, now, keys).goalsCompleted, 1);
});

test('hourly buckets follow 23 and 25 hour local daylight-saving days', () => {
  const previousZone = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    const state = emptyState();
    const spring = dayActivityBuckets(state, at(2026, 3, 8, 12), '2026-03-08');
    const autumn = dayActivityBuckets(state, at(2026, 11, 1, 12), '2026-11-01');
    assert.equal(spring.length, 23);
    assert.equal(autumn.length, 25);
    assert.equal(spring[0].startedAt, at(2026, 3, 8));
    assert.equal(autumn.at(-1)!.endedAt, at(2026, 11, 2));
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
