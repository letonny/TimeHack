import assert from 'node:assert/strict';
import test from 'node:test';
import { activeSet, arrive, completeTrip, duration, emptyState, finishActivity, finishWithoutReturnTrip, pause, resume, start, startReturnTrip, startSet, startTrip, startTripActivity, summarizeSession, todaySummary } from '../lib/timer.ts';
import { mapRows } from '../lib/cloud.ts';
import { buildDayTimeline, dailyActivity, habitGoalProgress, localDayKey } from '../lib/analytics.ts';
import { cloudKey, newCache, readCache, writeCache } from '../lib/cloud.ts';

const minute = 60_000;

test('a custom activity trip keeps travel separate and works without SETs', () => {
  const day = new Date(2026, 9, 30, 10).getTime();
  let state = startTrip(emptyState(), 'Pickleball', day, 'trip', null, 'Community court', 'Library');
  assert.equal(duration(state.active!, day + 10 * minute), 0);
  state = arrive(state, day + 10 * minute);
  state = startTripActivity(state, day + 15 * minute);
  state = pause(state, day + 25 * minute);
  state = resume(state, day + 30 * minute);
  state = finishActivity(state, day + 50 * minute);
  state = startReturnTrip(state, day + 55 * minute);
  state = completeTrip(state, day + 70 * minute);
  const session = state.completed[0];
  const summary = summarizeSession(session, day + 70 * minute);
  assert.equal(session.name, 'Pickleball');
  assert.equal(session.destination, 'Community court');
  assert.equal(session.returnDestination, 'Library');
  assert.equal(summary.studyMilliseconds, 30 * minute);
  assert.equal(summary.travelMilliseconds, 25 * minute);
  assert.equal(summary.trackedMilliseconds, 55 * minute);
  assert.equal(summary.commitmentMilliseconds, 70 * minute);
  assert.equal(todaySummary(state, day + 70 * minute).milliseconds, 30 * minute);
  assert.equal(dailyActivity(state, day + 70 * minute, 'Pickleball').get(localDayKey(day))?.milliseconds, 30 * minute);
  assert.equal(habitGoalProgress(state, { id: 'habit', name: 'Pickleball', goalMinutes: 60 }, day + 70 * minute).minutes, 30);
  const timeline = buildDayTimeline(state, day + 70 * minute, localDayKey(day), { includeBreaks: true });
  assert.equal(timeline.activityMilliseconds, 30 * minute);
  assert.equal(timeline.travelMilliseconds, 25 * minute);
  assert.equal(timeline.trackedMilliseconds, 55 * minute);
  assert.equal(timeline.slices.filter(slice => slice.category === 'travel').length, 2);
  assert.equal(session.sets?.length, 0);
  const stored = new Map<string, string>();
  const cache = { ...newCache('user'), state };
  writeCache({ setItem: (key, value) => stored.set(key, value) }, cache);
  assert.equal(readCache({ getItem: key => stored.get(key) ?? null }, 'user')?.state.completed[0].returnDestination, 'Library');
  assert.ok(stored.has(cloudKey('user')));
});

test('a trip can finish without return travel and supports optional SETs only during activity', () => {
  let state = startTrip(emptyState(), 'Studying', 1_000, 'trip');
  assert.equal(startSet(state, 2_000, 'set', 'Chapter 1'), state);
  state = arrive(state, 3_000);
  state = startTripActivity(state, 4_000);
  state = startSet(state, 5_000, 'set', 'Chapter 1');
  assert.equal(activeSet(state.active!)?.description, 'Chapter 1');
  state = finishActivity(state, 9_000);
  assert.equal(activeSet(state.active!), null);
  state = finishWithoutReturnTrip(state, 10_000);
  assert.equal(state.completed[0].segments.some(part => part.kind === 'travel_return'), false);
  assert.equal(duration(state.completed[0], 10_000), 5_000);
});

test('ordinary timers and historical cloud sessions remain valid', () => {
  const normal = start(emptyState(), 'Work', 1_000, 'normal');
  assert.equal(normal.active?.tripPhase, undefined);
  assert.equal(duration(normal.active!, 2_000), 1_000);
  const mapped = mapRows('user', [], [{ user_id: 'user', id: 'old', name: 'School', started_at: new Date(1_000).toISOString(), ended_at: new Date(2_000).toISOString(), revision: 1, deleted_at: null }], [{ user_id: 'user', session_id: 'old', position: 0, kind: 'study', started_at: new Date(1_000).toISOString(), ended_at: new Date(2_000).toISOString() }]);
  assert.equal(mapped.state.completed[0].tripPhase, undefined);
  assert.equal(duration(mapped.state.completed[0], 2_000), 1_000);
});

test('cloud mapping restores a custom trip and its destinations', () => {
  const mapped = mapRows('user', [], [{ user_id: 'user', id: 'trip', name: 'Custom errand', started_at: new Date(1_000).toISOString(), ended_at: new Date(4_000).toISOString(), revision: 3, deleted_at: null, trip_phase: 'return', destination: 'Market', return_destination: 'Office' }], [
    { user_id: 'user', session_id: 'trip', position: 0, kind: 'travel_out', started_at: new Date(1_000).toISOString(), ended_at: new Date(2_000).toISOString() },
    { user_id: 'user', session_id: 'trip', position: 1, kind: 'study', started_at: new Date(2_000).toISOString(), ended_at: new Date(3_000).toISOString() },
    { user_id: 'user', session_id: 'trip', position: 2, kind: 'travel_return', started_at: new Date(3_000).toISOString(), ended_at: new Date(4_000).toISOString() },
  ]);
  const session = mapped.state.completed[0];
  assert.equal(session.tripPhase, 'return');
  assert.equal(session.destination, 'Market');
  assert.equal(session.returnDestination, 'Office');
  assert.equal(duration(session, 4_000), 1_000);
  assert.equal(summarizeSession(session, 4_000).travelMilliseconds, 2_000);
});
