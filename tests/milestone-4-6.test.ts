import test from 'node:test';
import assert from 'node:assert/strict';
import { activityForName, saveActivity } from '../lib/activity-metadata.ts';
import { buildDayTimeline, habitGoalProgress, localDayKey } from '../lib/analytics.ts';
import { analyzeInsights } from '../lib/productivity-insights.ts';
import { completedProductiveTotal, periodSummary } from '../lib/productivity-analytics.ts';
import { correctionAvailability, validateIntervalCorrection } from '../lib/session-corrections.ts';
import { emptyState, start, startTrip, arrive, startTripActivity, finishActivity, startReturnTrip, completeTrip, stop, summarizeSession, type Session } from '../lib/timer.ts';

const t = Date.parse('2026-10-30T12:00:00Z');
const minute = 60_000;
const base = () => ({ ...emptyState(), habits: [{ id: 'h', name: 'Gaming', goalMinutes: 20 }] });

test('time correction waits for online sync and becomes available after recovery', () => {
  const clean = { ready: true, online: true, pending: 0, busy: false, conflict: false };
  assert.match(correctionAvailability({ ...clean, online: false }) ?? '', /connection/);
  assert.match(correctionAvailability({ ...clean, pending: 1 }) ?? '', /synchronized/);
  assert.match(correctionAvailability({ ...clean, conflict: true }) ?? '', /synchronized/);
  assert.equal(correctionAvailability(clean), null);
});

test('activity defaults and session snapshots separate productive, personal, and habit time', () => {
  let state = base();
  state = saveActivity(state, { id: 'gaming', name: 'Gaming', icon: 'circle', color: '#94a3b8', category: 'Leisure', countsProductive: false });
  assert.equal(activityForName(state, 'Gaming').countsProductive, false);
  let timer = start(state, 'Gaming', t, 's', 'gaming', activityForName(state, 'Gaming').countsProductive !== false);
  timer = stop(timer, t + 30 * minute);
  const session = timer.completed[0];
  assert.equal(summarizeSession(session, t + 30 * minute).personalMilliseconds, 30 * minute);
  assert.equal(summarizeSession(session, t + 30 * minute).productiveMilliseconds, 0);
  assert.equal(habitGoalProgress(timer, timer.habits[0], t + 30 * minute).percentage, 150);
  const day = buildDayTimeline(timer, t + 30 * minute, localDayKey(t), { includeBreaks: true });
  assert.equal(day.trackedActivityMilliseconds, 30 * minute);
  assert.equal(day.personalMilliseconds, 30 * minute);
  assert.equal(periodSummary(timer, t + 30 * minute, [localDayKey(t)]).productiveMilliseconds, 0);
  assert.equal(analyzeInsights(timer, t + 30 * minute, { startDay: localDayKey(t), endDay: localDayKey(t) }).summary.personalMilliseconds, 30 * minute);
  const updated = saveActivity(timer, { ...timer.activities[0], countsProductive: true });
  assert.equal(updated.completed[0].countsProductive, false);
  assert.equal(periodSummary({ ...updated, completed: [{ ...session, countsProductive: true }] }, t + 30 * minute, [localDayKey(t)]).productiveMilliseconds, 30 * minute);
});

test('completed history totals deduplicate overlapping active intervals', () => {
  const first = stop(start(emptyState(), 'Gym', t, 'first'), t + 30 * minute).completed[0];
  const second = stop(start(emptyState(), 'Coding', t + 15 * minute, 'second'), t + 45 * minute).completed[0];
  assert.equal(completedProductiveTotal({ ...emptyState(), completed: [first, second] }, t + 60 * minute), 45 * minute);
});

test('completed SET, break and midnight corrections validate containment and parent boundaries', () => {
  const midnight = new Date(2026, 9, 30, 23, 50).getTime();
  const original: Session = { id: 's', name: 'Gym', startedAt: midnight, endedAt: midnight + 20 * minute,
    entryType: 'timer', segments: [
      { kind: 'study', startedAt: midnight, endedAt: midnight + 8 * minute },
      { kind: 'break', startedAt: midnight + 8 * minute, endedAt: midnight + 10 * minute },
      { kind: 'study', startedAt: midnight + 10 * minute, endedAt: midnight + 20 * minute },
    ], sets: [{ id: 'set', sessionId: 's', description: 'Squats', segments: [{ startedAt: midnight + minute, endedAt: midnight + 6 * minute }] }] };
  const proposal = { segments: [
    { kind: 'study' as const, startedAt: midnight - minute, endedAt: midnight + 8 * minute },
    { kind: 'break' as const, startedAt: midnight + 8 * minute, endedAt: midnight + 11 * minute },
    { kind: 'study' as const, startedAt: midnight + 11 * minute, endedAt: midnight + 22 * minute },
  ], sets: [{ id: 'set', expectedRevision: 1, segments: [{ startedAt: midnight, endedAt: midnight + 7 * minute }] }] };
  const corrected = validateIntervalCorrection(original, proposal, midnight + 30 * minute);
  assert.equal(corrected.startedAt, midnight - minute);
  assert.equal(corrected.endedAt, midnight + 22 * minute);
  assert.equal(summarizeSession(corrected, midnight + 30 * minute).breakMilliseconds, 3 * minute);
  const afterDay = localDayKey(midnight + 22 * minute);
  const correctedState = { ...emptyState(), completed: [corrected] };
  assert.equal(periodSummary(correctedState, midnight + 30 * minute, [afterDay]).trackedMilliseconds,
    buildDayTimeline(correctedState, midnight + 30 * minute, afterDay, { includeBreaks: true }).trackedActivityMilliseconds);
  assert.equal(analyzeInsights(correctedState, midnight + 30 * minute, { startDay: afterDay, endDay: afterDay }).summary.productiveMilliseconds,
    buildDayTimeline(correctedState, midnight + 30 * minute, afterDay).productiveMilliseconds);
  assert.throws(() => validateIntervalCorrection(original, { ...proposal, sets: [{ ...proposal.sets[0], segments: [{ startedAt: midnight + 9 * minute, endedAt: midnight + 12 * minute }] }] }, midnight + 30 * minute), /inside activity/);
  assert.throws(() => validateIntervalCorrection(original, { ...proposal, segments: [proposal.segments[0], { ...proposal.segments[1], startedAt: midnight + 7 * minute }, proposal.segments[2]] }, midnight + 30 * minute), /ordered/);
  assert.throws(() => validateIntervalCorrection(original, { ...proposal, segments: [{ ...proposal.segments[0], startedAt: Number.NaN }, ...proposal.segments.slice(1)] }, midnight + 30 * minute), /valid/);
});

test('trip correction keeps travel outside productivity and prohibits kind changes', () => {
  let state = startTrip(emptyState(), 'Fishing', t, 'trip', null, 'Lake', 'Cabin', false);
  state = arrive(state, t + 10 * minute);
  state = startTripActivity(state, t + 11 * minute);
  state = finishActivity(state, t + 31 * minute);
  state = startReturnTrip(state, t + 32 * minute);
  state = completeTrip(state, t + 42 * minute);
  const session = state.completed[0];
  const corrected = validateIntervalCorrection(session, {
    segments: session.segments.map(item => ({ kind: item.kind, startedAt: item.startedAt, endedAt: item.endedAt! })), sets: [],
  }, t + 50 * minute);
  assert.equal(summarizeSession(corrected, t + 50 * minute).productiveMilliseconds, 0);
  assert.ok(summarizeSession(corrected, t + 50 * minute).travelMilliseconds > 0);
  assert.throws(() => validateIntervalCorrection(session, { segments: corrected.segments.map((item, index) => ({ kind: index === 0 ? 'study' as const : item.kind, startedAt: item.startedAt, endedAt: item.endedAt! })), sets: [] }, t + 50 * minute), /ordered|Trip|interval/i);
});
