import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityHistoryForDay, buildDayTimeline, dailyActivity, formatDashboardDate, localDayKey, localDayStart } from '../lib/analytics.ts';
import {
  emptyState, formatDurationMilliseconds, pause, resume, sessionIntervals, start, stop,
  summarizeSession, type Session, type TimerState,
} from '../lib/timer.ts';
import { loadState, saveState } from '../lib/storage.ts';

const minute = 60_000;
const hour = 60 * minute;
const at = (year: number, month: number, day: number, hours = 0, minutes = 0, seconds = 0, milliseconds = 0) => new Date(year, month - 1, day, hours, minutes, seconds, milliseconds).getTime();
const makeSession = (id: string, name: string, segments: Session['segments']): Session => ({ id, name, startedAt: segments[0].startedAt, endedAt: segments.at(-1)!.endedAt, segments });
const withSessions = (...completed: Session[]): TimerState => ({ ...emptyState(), completed });
function memory() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test('millisecond formatting uses HH:MM:SS.mmm without rounding', () => {
  assert.equal(formatDurationMilliseconds(0), '00:00:00.000');
  assert.equal(formatDurationMilliseconds(5_097), '00:00:05.097');
  assert.equal(formatDurationMilliseconds(3_723_428), '01:02:03.428');
});

test('pause and resume preserve exact active durations and group one SET interval', () => {
  let state = start(emptyState(), 'Study', 1_000, 's');
  state = pause(state, 6_250);
  state = resume(state, 20_000);
  state = stop(state, 24_500);
  const summary = summarizeSession(state.completed[0], 24_500);
  assert.equal(summary.studyMilliseconds, 9_750);
  assert.equal(summary.breakMilliseconds, 0);
  assert.equal(summary.intervals.length, 1);
  assert.equal(summary.intervals[0].segmentCount, 2);
  assert.equal(summary.intervals[0].milliseconds, 9_750);
});

test('multiple SET transitions retain each effective study and break interval', () => {
  const base = at(2026, 10, 28, 9);
  const session = makeSession('s', 'Studying', [
    { kind: 'study', startedAt: base, endedAt: base + 40 * minute },
    { kind: 'break', startedAt: base + 40 * minute, endedAt: base + 48 * minute },
    { kind: 'study', startedAt: base + 48 * minute, endedAt: base + 80 * minute },
    { kind: 'break', startedAt: base + 80 * minute, endedAt: base + 85 * minute },
    { kind: 'study', startedAt: base + 85 * minute, endedAt: base + 100 * minute },
  ]);
  const summary = summarizeSession(session, session.endedAt!);
  assert.deepEqual(sessionIntervals(session, session.endedAt!).map(interval => [interval.kind, interval.milliseconds]), [
    ['study', 40 * minute], ['break', 8 * minute], ['study', 32 * minute], ['break', 5 * minute], ['study', 15 * minute],
  ]);
  assert.equal(summary.studyMilliseconds, 87 * minute);
  assert.equal(summary.breakMilliseconds, 13 * minute);
  assert.equal(summary.trackedMilliseconds, 100 * minute);
  assert.equal(summary.studyShare, 87);
  assert.equal(summary.breakCount, 2);
});

test('completed interval summaries survive local persistence unchanged', () => {
  const base = at(2026, 10, 28, 9);
  const session = makeSession('s', 'Study', [
    { kind: 'study', startedAt: base, endedAt: base + 10 * minute },
    { kind: 'break', startedAt: base + 10 * minute, endedAt: base + 12 * minute },
  ]);
  const storage = memory();
  const state = withSessions(session);
  saveState(storage, state);
  assert.deepEqual(summarizeSession(loadState(storage).completed[0], session.endedAt!), summarizeSession(session, session.endedAt!));
});

test('activity ring counts studies and breaks, excludes paused gaps, and fills the local day', () => {
  const base = at(2026, 10, 28, 9);
  const now = at(2026, 10, 28, 12);
  const state = withSessions(makeSession('s', 'Studying', [
    { kind: 'study', startedAt: base, endedAt: base + hour },
    { kind: 'study', startedAt: base + hour + 15 * minute, endedAt: base + hour + 45 * minute },
    { kind: 'break', startedAt: base + hour + 45 * minute, endedAt: base + 2 * hour },
  ]));
  const ring = buildDayTimeline(state, now, undefined, { includeBreaks: true });
  assert.equal(ring.activityMilliseconds, 90 * minute);
  assert.equal(ring.breakMilliseconds, 15 * minute);
  assert.equal(ring.trackedMilliseconds, 105 * minute);
  assert.equal(ring.untrackedMilliseconds, 10 * hour + 15 * minute);
  assert.equal(ring.remainingMilliseconds, 12 * hour);
  assert.equal(ring.slices.reduce((total, slice) => total + slice.milliseconds, 0), ring.dayMilliseconds);
});

test('overlapping sessions never inflate the day ring or calendar', () => {
  const day = at(2026, 10, 28, 9);
  const state = withSessions(
    makeSession('a', 'Study', [{ kind: 'study', startedAt: day, endedAt: day + hour }]),
    makeSession('b', 'Gym', [{ kind: 'study', startedAt: day + 30 * minute, endedAt: day + 90 * minute }]),
  );
  const now = day + 2 * hour;
  const ring = buildDayTimeline(state, now, undefined, { includeBreaks: true });
  const key = localDayKey(now);
  assert.equal(ring.trackedMilliseconds, 90 * minute);
  assert.equal(dailyActivity(state, now).get(key)!.milliseconds, 90 * minute);
});

test('overnight intervals split at local midnight consistently across ring, history, and calendar', () => {
  const startAt = at(2026, 10, 27, 23, 30);
  const midnight = at(2026, 10, 28);
  const endedAt = at(2026, 10, 28, 0, 45);
  const state = withSessions(makeSession('s', 'Study', [{ kind: 'study', startedAt: startAt, endedAt }]));
  const totals = dailyActivity(state, endedAt);
  assert.equal(totals.get('2026-10-27')!.milliseconds, 30 * minute);
  assert.equal(totals.get('2026-10-28')!.milliseconds, 45 * minute);
  assert.equal(activityHistoryForDay(state, '2026-10-28', endedAt)[0].milliseconds, 45 * minute);
  assert.equal(buildDayTimeline(state, endedAt, '2026-10-28', { includeBreaks: true }).activityMilliseconds, 45 * minute);
  assert.equal(midnight - startAt, 30 * minute);
});

test('local-day allocation respects 23 and 25 hour daylight-saving days', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try {
    assert.equal(localDayStart('2026-03-09') - localDayStart('2026-03-08'), 23 * hour);
    assert.equal(localDayStart('2026-11-02') - localDayStart('2026-11-01'), 25 * hour);
    const now = new Date(2026, 10, 1, 12).getTime();
    const ring = buildDayTimeline(emptyState(), now);
    assert.equal(ring.dayMilliseconds, 25 * hour);
    assert.equal(ring.slices.reduce((total, slice) => total + slice.milliseconds, 0), 25 * hour);
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});

test('dashboard date is derived from the current local timestamp', () => {
  assert.deepEqual(formatDashboardDate(at(2026, 10, 28, 12), 'en-US'), { weekday: 'WEDNESDAY', date: 'October 28, 2026' });
});
