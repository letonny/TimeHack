import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDayTimeline, localDayKey } from '../lib/analytics.ts';
import { mapRows, newCache, nextChange, readCache, revisionKey, sessionChanges, writeCache } from '../lib/cloud.ts';
import { activeSet, duration, emptyState, isRunning, pause, resume, setDuration, setSegment, start, startSet, stop } from '../lib/timer.ts';

test('one SET tap starts a nested stopwatch without pausing or duplicating the parent', () => {
  const session = start(emptyState(), 'Gym', 1_000, 'session');
  const withSet = startSet(session, 2_000, 'set-1', 'Squats');
  assert.equal(withSet.active?.name, 'Gym');
  assert.equal(withSet.active?.segments.length, 1);
  assert.equal(isRunning(withSet.active!), true);
  assert.equal(duration(withSet.active!, 5_000), 4_000);
  assert.equal(setDuration(activeSet(withSet.active!)!, 5_000), 3_000);
  assert.equal(startSet(withSet, 2_000, 'set-2', 'Squats', null), withSet);
  const timeline = buildDayTimeline(withSet, 5_000, localDayKey(5_000));
  assert.equal(timeline.activityMilliseconds, 4_000);
});

test('next SET closes the prior SET; Pause and Finish close active SET once', () => {
  let state = startSet(start(emptyState(), 'Gym', 1_000, 'session'), 2_000, 'set-1', 'Squats');
  state = startSet(state, 4_000, 'set-2', 'Rest');
  assert.equal(state.active!.sets![0].segments[0].endedAt, 4_000);
  assert.equal(duration(state.active!, 5_000), 4_000);
  state = pause(state, 5_000);
  assert.equal(activeSet(state.active!), null);
  assert.equal(setDuration(state.active!.sets![1], 100_000), 1_000);
  assert.equal(pause(state, 6_000), state);
  state = resume(state, 10_000);
  assert.equal(activeSet(state.active!), null);
  state = startSet(state, 11_000, 'set-3', 'Bench Press');
  state = stop(state, 12_000);
  assert.equal(state.completed.length, 1);
  assert.equal(stop(state, 13_000), state);
  assert.equal(state.completed[0].sets![2].segments[0].endedAt, 12_000);
  assert.equal(duration(state.completed[0], 100_000), 6_000);
});

test('a pre-5A legacy break can transition into a new nested SET without rewriting history', () => {
  const legacy = setSegment(start(emptyState(), 'Gym', 1_000, 'session'), 2_000);
  const next = startSet(legacy, 3_000, 'set-1', 'Squats');
  assert.deepEqual(next.active?.segments.map(item => item.kind), ['study', 'break', 'study']);
  assert.equal(next.active?.segments[1].endedAt, 3_000);
  assert.equal(activeSet(next.active!)?.description, 'Squats');
  assert.deepEqual(sessionChanges(legacy.active, next.active).map(item => item.entityType), ['session', 'set']);
});

test('Pause and Finish replay SET closure before the parent transition', () => {
  const running = startSet(start(emptyState(), 'Gym', 1_000, 'session'), 2_000, 'set-1', 'Squats');
  const paused = pause(running, 3_000);
  const finished = stop(running, 3_000);
  assert.deepEqual(sessionChanges(running.active, paused.active).map(item => item.entityType), ['set', 'session']);
  assert.deepEqual(sessionChanges(running.active, finished.completed[0]).map(item => item.entityType), ['set', 'session']);
});

test('cloud mapping restores SETs only for their account and revision', () => {
  const started = new Date(2026, 9, 29, 9).getTime();
  const ended = started + 60_000;
  const sessions = [{ user_id: 'u1', id: 'session', name: 'Gym', started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), revision: 2, deleted_at: null }];
  const segments = [{ user_id: 'u1', session_id: 'session', position: 0, kind: 'study' as const, started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString() }];
  const sets = [{ user_id: 'u1', id: 'set-1', session_id: 'session', description: 'Squats', segments: [{ startedAt: started + 10_000, endedAt: ended - 10_000 }], revision: 3, deleted_at: null }];
  const cloud = mapRows('u1', [], sessions, segments, [], [], [], [], sets);
  assert.equal(cloud.state.completed[0].sets?.[0].description, 'Squats');
  assert.equal(cloud.revisions[revisionKey('set', 'set-1')], 3);
  assert.throws(() => mapRows('u2', [], sessions, segments, [], [], [], [], sets), /Account data mismatch/);
});

test('queued SET changes receive one revision per event and survive reload', () => {
  const cache = newCache('u1');
  const payload = { id: 'set-1', sessionId: 'session', description: 'Squats', segments: [{ startedAt: 1_000, endedAt: null }] };
  cache.queue.push(nextChange(cache, 'set', payload.id, 'save', payload));
  cache.queue.push(nextChange(cache, 'set', payload.id, 'save', { ...payload, segments: [{ startedAt: 1_000, endedAt: 2_000 }] }));
  assert.deepEqual(cache.queue.map(item => item.expectedRevision), [0, 1]);
  assert.notEqual(cache.queue[0].eventId, cache.queue[1].eventId);
  cache.state = startSet(start(emptyState(), 'Gym', 1_000, 'session'), 2_000, 'set-1', 'Squats');
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  writeCache(storage, cache);
  const restored = readCache(storage, 'u1')!;
  assert.equal(restored.state.active?.sets?.[0].description, 'Squats');
  assert.deepEqual(restored.queue, cache.queue);
});
