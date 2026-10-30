import assert from 'node:assert/strict';
import test from 'node:test';
import { firstNameFor, greetingFor } from '../lib/personalization.ts';
import { buildDayTimeline, localDayKey } from '../lib/analytics.ts';
import { emptyState, start, startSet } from '../lib/timer.ts';
import { ringArc } from '../lib/ring-geometry.ts';

test('Home greeting chooses one safe first name and keeps local time-of-day wording', () => {
  const morning = new Date(2026, 9, 30, 8).getTime();
  assert.equal(greetingFor(morning), 'Good morning');
  assert.equal(firstNameFor(' Tonny Lee ', { email: 'someone@example.com' }), 'Tonny');
  assert.equal(firstNameFor('', { givenName: 'Ada', email: 'someone@example.com' }), 'Ada');
  assert.equal(firstNameFor('', { email: 'tonny.lee@example.com' }), 'Tonny');
  assert.equal(firstNameFor('', { email: null }), null);
});

test('ring arcs stay within their actual time intervals, including very short slices', () => {
  const circumference = 2 * Math.PI * 42;
  const day = 24 * 60 * 60 * 1000;
  for (const [start, length] of [[0, 1], [day / 4, 5 * 60_000], [day / 2, 8 * 60 * 60_000]]) {
    const arc = ringArc(start, length, 0, day, circumference);
    const trueStart = start / day * circumference;
    const trueEnd = (start + length) / day * circumference;
    assert.ok(arc.offset >= trueStart);
    assert.ok(arc.offset + arc.length <= trueEnd + 1e-10);
    assert.ok(arc.length > 0);
  }
});

test('Home day total includes the running parent and never adds a nested SET twice', () => {
  const started = new Date(2026, 9, 30, 9).getTime();
  const state = startSet(start(emptyState(), 'Gym', started, 'session'), started + 60_000, 'set-1', 'Squats');
  const timeline = buildDayTimeline(state, started + 120_000, localDayKey(started));
  assert.equal(timeline.activityMilliseconds, 120_000);
  assert.equal(timeline.trackedMilliseconds, 120_000);
});
