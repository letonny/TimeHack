import assert from 'node:assert/strict';
import test from 'node:test';
import { firstNameFor, greetingFor } from '../lib/personalization.ts';
import { buildDayTimeline, localDayKey } from '../lib/analytics.ts';
import { emptyState, start, startSet } from '../lib/timer.ts';

test('Home greeting chooses one safe first name and keeps local time-of-day wording', () => {
  const morning = new Date(2026, 9, 30, 8).getTime();
  assert.equal(greetingFor(morning), 'Good morning');
  assert.equal(firstNameFor(' Tonny Lee ', { email: 'someone@example.com' }), 'Tonny');
  assert.equal(firstNameFor('', { givenName: 'Ada', email: 'someone@example.com' }), 'Ada');
  assert.equal(firstNameFor('', { email: 'tonny.lee@example.com' }), 'Tonny');
  assert.equal(firstNameFor('', { email: null }), null);
});

test('Home day total includes the running parent and never adds a nested SET twice', () => {
  const started = new Date(2026, 9, 30, 9).getTime();
  const state = startSet(start(emptyState(), 'Gym', started, 'session'), started + 60_000, 'set-1', 'Squats');
  const timeline = buildDayTimeline(state, started + 120_000, localDayKey(started));
  assert.equal(timeline.activityMilliseconds, 120_000);
  assert.equal(timeline.trackedMilliseconds, 120_000);
});
