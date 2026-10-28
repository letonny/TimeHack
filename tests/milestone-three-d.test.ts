import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityForSession, recentActivityNames, saveActivity } from '../lib/activity-metadata.ts';
import { activityHistoryForDay, buildDayTimeline, dailyActivity } from '../lib/analytics.ts';
import { mapRows, newCache, nextChange, readCache, writeCache } from '../lib/cloud.ts';
import { createManualDuration, createManualRange, localDateTime } from '../lib/manual-entry.ts';
import { greetingFor, validateDisplayName } from '../lib/personalization.ts';
import { removeCompletedSession, replaceCompletedSession } from '../lib/session-actions.ts';
import { emptyState, formatCompletedDuration, setSegment, start, stop, summarizeSession, type Session } from '../lib/timer.ts';

const minute = 60_000;
const at = (year: number, month: number, day: number, hours = 0, minutes = 0) => new Date(year, month - 1, day, hours, minutes).getTime();
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } }; };

test('local greeting uses exact time boundaries and never guesses a missing name', () => {
  assert.equal(greetingFor(at(2026, 10, 28, 4, 59)), 'Good evening');
  assert.equal(greetingFor(at(2026, 10, 28, 5)), 'Good morning');
  assert.equal(greetingFor(at(2026, 10, 28, 11, 59), ' Ada '), 'Good morning, Ada');
  assert.equal(greetingFor(at(2026, 10, 28, 12)), 'Good afternoon');
  assert.equal(greetingFor(at(2026, 10, 28, 17)), 'Good evening');
  assert.equal(validateDisplayName('  Toni  '), 'Toni');
  assert.throws(() => validateDisplayName('x'.repeat(81)));
});

test('completed cards format exact durations as H:MM', () => {
  assert.equal(formatCompletedDuration(2 * 60 * minute + 39 * minute + 48_999), '2:39');
  assert.equal(formatCompletedDuration(45 * minute), '0:45');
});

test('manual ranges calculate timestamps, support overnight entries, and reject future or reversed ranges', () => {
  const now = at(2026, 10, 29, 12);
  const entry = createManualRange({ id: 'r', name: 'Cooking', startDate: '2026-10-28', startTime: '23:47', endDate: '2026-10-29', endTime: '00:24', note: 'Dinner prep' }, now);
  assert.equal(entry.entryType, 'manual_range');
  assert.equal(summarizeSession(entry, now).trackedMilliseconds, 37 * minute);
  assert.equal(entry.note, 'Dinner prep');
  assert.throws(() => createManualRange({ id: 'x', name: 'Gym', startDate: '2026-10-29', startTime: '10:00', endDate: '2026-10-29', endTime: '09:00' }, now));
  assert.throws(() => createManualRange({ id: 'x', name: 'Gym', startDate: '2026-10-29', startTime: '13:00', endDate: '2026-10-29', endTime: '14:00' }, now));
});

test('manual range validation rejects nonexistent DST wall times', () => {
  const original = process.env.TZ;
  process.env.TZ = 'America/Chicago';
  try { assert.throws(() => localDateTime('2026-03-08', '02:30'), /does not exist/); }
  finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('duration-only records retain no timestamps and contribute without entering chronological ring slices', () => {
  const now = at(2026, 10, 28, 18);
  const entry = createManualDuration({ id: 'd', name: 'Gym', localDate: '2026-10-28', hours: 0, minutes: 45, note: 'Strength day' }, '2026-10-28');
  assert.equal(entry.startedAt, null);
  assert.equal(entry.endedAt, null);
  assert.deepEqual(entry.segments, []);
  const state = { ...emptyState(), completed: [entry] };
  const ring = buildDayTimeline(state, now, '2026-10-28', { includeBreaks: true });
  assert.equal(ring.unscheduledMilliseconds, 45 * minute);
  assert.equal(ring.trackedMilliseconds, 45 * minute);
  assert.equal(ring.slices.some(slice => slice.sessionId === 'd'), false);
  assert.equal(dailyActivity(state, now).get('2026-10-28')!.milliseconds, 45 * minute);
  assert.equal(activityHistoryForDay(state, '2026-10-28', now)[0].startedAt, null);
});

test('recent shortcuts de-duplicate names and custom metadata persists in the account cache', () => {
  const first = createManualDuration({ id: '1', name: 'Gym', localDate: '2026-10-28', hours: 1, minutes: 0 }, '2026-10-28');
  const second = createManualDuration({ id: '2', name: 'gym', localDate: '2026-10-27', hours: 1, minutes: 0 }, '2026-10-28');
  let state = { ...emptyState(), completed: [first, second] };
  state = saveActivity(state, { id: 'a', name: 'Gym', icon: 'dumbbell', color: '#38bdf8' });
  assert.deepEqual(recentActivityNames(state), ['Gym']);
  assert.equal(activityForSession(state, first).icon, 'dumbbell');
  const storage = memory(), cache = newCache('user');
  cache.state = state;
  writeCache(storage, cache);
  assert.deepEqual(readCache(storage, 'user')!.state.activities, state.activities);
});

test('manual sessions, activity metadata, profile names, and notes map from owned cloud rows', () => {
  const user = '11111111-1111-4111-8111-111111111111';
  const mapped = mapRows(user, [], [], [], [{ user_id: user, id: 'a', name: 'Reading', icon: 'book-open', color: '#4ade80', revision: 1, deleted_at: null }], [{ user_id: user, display_name: 'Avery', revision: 3 }], [{ user_id: user, id: 'd', name: 'Reading', local_date: '2026-10-28', duration_milliseconds: 30 * minute, activity_id: 'a', note: 'Chapter 4', revision: 2, deleted_at: null }]);
  assert.equal(mapped.state.completed[0].startedAt, null);
  assert.equal(mapped.state.completed[0].note, 'Chapter 4');
  assert.equal(mapped.state.activities[0].color, '#4ade80');
  assert.equal(mapped.state.profile.displayName, 'Avery');
  assert.equal(mapped.revisions['session:d'], 2);
  assert.throws(() => mapRows(user, [], [], [], [{ user_id: 'other', id: 'a', name: 'X', icon: 'circle', color: '#94a3b8', revision: 1, deleted_at: null }], []), /mismatch/);
});

test('editing notes and metadata preserves SET timestamps; completed deletion cannot target active sessions', () => {
  const base = at(2026, 10, 28, 9);
  let state = setSegment(start(emptyState(), 'Study', base, 's'), base + 20 * minute);
  state = stop(state, base + 25 * minute);
  const original = state.completed[0];
  const edited: Session = { ...original, name: 'Studying', note: 'Chapter 4' };
  const replaced = replaceCompletedSession(state, edited);
  assert.deepEqual(replaced.completed[0].segments, original.segments);
  assert.equal(replaced.completed[0].note, 'Chapter 4');
  assert.equal(removeCompletedSession(replaced, 's').completed.length, 0);
  const active = start(emptyState(), 'Live', base, 'live');
  assert.throws(() => replaceCompletedSession(active, active.active!));
  assert.throws(() => removeCompletedSession(active, 'live'));
});

test('daily timeline slices are chronological, expose gaps, and avoid overlapping inflation', () => {
  const day = at(2026, 10, 28, 9);
  const sessions: Session[] = [
    { id: 'a', name: 'Study', startedAt: day, endedAt: day + 60 * minute, segments: [{ kind: 'study', startedAt: day, endedAt: day + 60 * minute }], entryType: 'manual_range' },
    { id: 'b', name: 'Coding', startedAt: day + 30 * minute, endedAt: day + 90 * minute, segments: [{ kind: 'study', startedAt: day + 30 * minute, endedAt: day + 90 * minute }], entryType: 'manual_range' },
  ];
  const timeline = buildDayTimeline({ ...emptyState(), completed: sessions }, day + 2 * 60 * minute, undefined, { includeBreaks: true });
  assert.equal(timeline.activityMilliseconds, 90 * minute);
  assert.ok(timeline.slices.some(slice => slice.category === 'untracked'));
  assert.deepEqual([...timeline.slices].sort((a, b) => a.startedAt - b.startedAt), timeline.slices);
});

test('revisioned changes include new entities and the additive migration protects ownership', () => {
  const cache = newCache('11111111-1111-4111-8111-111111111111');
  const activity = nextChange(cache, 'activity', 'a', 'save', { id: 'a', name: 'Coding', icon: 'laptop', color: '#a78bfa' });
  cache.queue.push(activity);
  assert.equal(nextChange(cache, 'activity', 'a', 'save', activity.payload).expectedRevision, 1);
  const sql = readFileSync('supabase/migrations/20261028020000_milestone_3d_manual_time.sql', 'utf8').toLowerCase();
  for (const required of ['create table public.activities', 'create table public.user_profiles', 'create table public.manual_duration_entries', 'manual_duration', 'duration_milliseconds', 'enable row level security', "p_entity_type not in ('habit', 'session', 'activity', 'profile')", 'activity_events']) assert.ok(sql.includes(required), required);
});
