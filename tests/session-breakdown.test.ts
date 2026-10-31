import test from 'node:test';
import assert from 'node:assert/strict';
import { activityPiecesForSlice, sessionBreakdown } from '../lib/session-breakdown.ts';
import { buildDayTimeline, localDayKey } from '../lib/analytics.ts';
import { emptyState, type Session } from '../lib/timer.ts';

const minute = 60_000;
const t = new Date(2026, 9, 30, 14).getTime();
const base = (segments: Session['segments'], sets: Session['sets'] = []): Session => ({
  id: 's', name: 'Studying', startedAt: segments[0].startedAt, endedAt: segments.at(-1)?.endedAt ?? null,
  entryType: 'timer', segments, sets,
});

test('ordinary and older sessions use the saved parent name with no invented SETs', () => {
  const session = base([{ kind: 'study', startedAt: t, endedAt: t + 30 * minute }]);
  const result = sessionBreakdown(session, t + 40 * minute);
  assert.deepEqual(result.rows.map(row => [row.kind, row.label, row.milliseconds]), [['activity', 'Studying', 30 * minute]]);
  assert.equal(result.productiveMilliseconds, 30 * minute);
  assert.equal(result.travelMilliseconds, 0);
});

test('named and unnamed SETs split parent time without adding duration', () => {
  const session = base([{ kind: 'study', startedAt: t, endedAt: t + 100 * minute }], [
    { id: 'a', sessionId: 's', description: 'JavaScript Project', segments: [{ startedAt: t + 20 * minute, endedAt: t + 60 * minute }] },
    { id: 'b', sessionId: 's', description: '', segments: [{ startedAt: t + 70 * minute, endedAt: t + 90 * minute }] },
  ]);
  const result = sessionBreakdown(session, t + 101 * minute);
  assert.deepEqual(result.rows.map(row => row.label), ['Studying', 'JavaScript Project', 'Studying', 'SET', 'Studying']);
  assert.equal(result.rows.reduce((total, row) => total + row.milliseconds, 0), 100 * minute);
  assert.equal(result.rows.filter(row => row.kind === 'set').reduce((total, row) => total + row.milliseconds, 0), 60 * minute);
  assert.equal(result.activityMilliseconds, 100 * minute);
});

test('breaks, paused gaps and edited SET times remain chronological', () => {
  const session = base([
    { kind: 'study', startedAt: t, endedAt: t + 30 * minute },
    { kind: 'break', startedAt: t + 30 * minute, endedAt: t + 45 * minute },
    { kind: 'study', startedAt: t + 50 * minute, endedAt: t + 80 * minute },
  ], [{ id: 'a', sessionId: 's', description: 'Review Notes', segments: [{ startedAt: t + 55 * minute, endedAt: t + 75 * minute }] }]);
  const rows = sessionBreakdown(session, t + 90 * minute).rows;
  assert.deepEqual(rows.map(row => row.label), ['Studying', 'Break', 'Studying', 'Review Notes', 'Studying']);
  assert.equal(rows.reduce((total, row) => total + row.milliseconds, 0), 75 * minute);
  assert.equal(sessionBreakdown(session, t + 90 * minute).commitmentMilliseconds, 80 * minute);
  assert.deepEqual(activityPiecesForSlice(session, t + 60 * minute, t + 80 * minute, t + 90 * minute).map(row => row.milliseconds), [15 * minute, 5 * minute]);
});

test('universal Trip Mode reports outbound, activity, SET, and return time separately', () => {
  const session: Session = { ...base([
    { kind: 'travel_out', startedAt: t, endedAt: t + 15 * minute },
    { kind: 'study', startedAt: t + 15 * minute, endedAt: t + 105 * minute },
    { kind: 'travel_return', startedAt: t + 105 * minute, endedAt: t + 125 * minute },
  ], [{ id: 'a', sessionId: 's', description: 'Practice drills', segments: [{ startedAt: t + 30 * minute, endedAt: t + 60 * minute }] }]),
    name: 'Pickleball', tripPhase: 'return', destination: 'Court', returnDestination: 'Office' };
  const result = sessionBreakdown(session, t + 130 * minute);
  assert.deepEqual(result.rows.map(row => row.label), ['Travel to Court', 'Pickleball', 'Practice drills', 'Pickleball', 'Return trip to Office']);
  assert.equal(result.travelMilliseconds, 35 * minute);
  assert.equal(result.activityMilliseconds, 90 * minute);
  assert.equal(result.commitmentMilliseconds, 125 * minute);
  assert.equal(result.rows.reduce((total, row) => total + row.milliseconds, 0), 125 * minute);
  const noReturn = sessionBreakdown({ ...session, countsProductive: false, segments: session.segments.slice(0, 2), endedAt: t + 105 * minute }, t + 130 * minute);
  assert.equal(noReturn.personalMilliseconds, 90 * minute);
  assert.equal(noReturn.productiveMilliseconds, 0);
  assert.equal(noReturn.travelMilliseconds, 15 * minute);
  assert.equal(noReturn.rows.some(row => row.kind === 'travel_return'), false);
});

test('cross-midnight ring pieces clip to the selected day while details retain the full session', () => {
  const midnight = new Date(2026, 9, 31).getTime();
  const session = base([{ kind: 'study', startedAt: midnight - 20 * minute, endedAt: midnight + 30 * minute }], [
    { id: 'a', sessionId: 's', description: 'Night project', segments: [{ startedAt: midnight - 10 * minute, endedAt: midnight + 15 * minute }] },
  ]);
  const state = { ...emptyState(), completed: [session] };
  const day = buildDayTimeline(state, midnight + 40 * minute, localDayKey(midnight), { includeBreaks: true });
  const slice = day.slices.find(item => item.category === 'activity')!;
  const pieces = activityPiecesForSlice(session, slice.startedAt, slice.endedAt, midnight + 40 * minute);
  assert.deepEqual(pieces.map(row => row.milliseconds), [15 * minute, 15 * minute]);
  assert.equal(sessionBreakdown(session, midnight + 40 * minute).activityMilliseconds, 50 * minute);
});

test('zero-duration intervals and overlapping malformed SETs cannot add activity time', () => {
  const session = base([{ kind: 'study', startedAt: t, endedAt: t + 30 * minute }, { kind: 'break', startedAt: t + 30 * minute, endedAt: t + 30 * minute }], [
    { id: 'a', sessionId: 's', description: 'First', segments: [{ startedAt: t + 5 * minute, endedAt: t + 20 * minute }] },
    { id: 'b', sessionId: 's', description: 'Second', segments: [{ startedAt: t + 15 * minute, endedAt: t + 25 * minute }] },
  ]);
  const result = sessionBreakdown(session, t + 35 * minute);
  assert.equal(result.rows.reduce((total, row) => total + row.milliseconds, 0), 30 * minute);
  assert.equal(result.rows.some(row => row.kind === 'break'), false);
});

test('overlapping sessions use timeline ownership once and preserve each full breakdown', () => {
  const first = base([{ kind: 'study', startedAt: t, endedAt: t + 40 * minute }]);
  const second = { ...base([{ kind: 'study', startedAt: t + 20 * minute, endedAt: t + 60 * minute }]), id: 'other', name: 'Coding' };
  const state = { ...emptyState(), completed: [first, second] };
  const day = buildDayTimeline(state, t + 70 * minute, localDayKey(t), { includeBreaks: true });
  const pieces = day.slices.filter(slice => slice.category === 'activity').flatMap(slice =>
    activityPiecesForSlice(slice.sessionId === 's' ? first : second, slice.startedAt, slice.endedAt, t + 70 * minute));
  assert.equal(day.activityMilliseconds, 60 * minute);
  assert.equal(pieces.reduce((total, piece) => total + piece.milliseconds, 0), 60 * minute);
  assert.equal(sessionBreakdown(first, t + 70 * minute).activityMilliseconds, 40 * minute);
  assert.equal(sessionBreakdown(second, t + 70 * minute).activityMilliseconds, 40 * minute);
});
