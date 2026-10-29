import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { dueOccurrence, type PushCandidate } from '../lib/push-eligibility.ts';

const base: PushCandidate = { user_id: 'u1', habit_id: 'h1', local_time: '09:00:00',
  time_zone: 'America/Chicago', weekday_mask: 127, skip_if_goal_complete: true };

test('due reminders honor local weekdays, time zones, and the retry window', () => {
  const at = Date.parse('2026-10-29T14:00:00Z');
  assert.equal(dueOccurrence(base, at)?.localDate, '2026-10-29');
  assert.equal(dueOccurrence(base, at)?.occurrence, at);
  assert.equal(dueOccurrence(base, at - 60000), null);
  assert.equal(dueOccurrence(base, at + 16 * 60000), null);
  assert.equal(dueOccurrence({ ...base, weekday_mask: 1 }, at), null);
  assert.equal(dueOccurrence({ ...base, time_zone: 'America/Los_Angeles' }, at), null);
});

test('DST gap moves to first valid minute and repeated hour uses first occurrence', () => {
  const gap = { ...base, local_time: '02:30:00', weekday_mask: 127 };
  const gapInstant = Date.parse('2026-03-08T08:00:00Z');
  assert.equal(dueOccurrence(gap, gapInstant)?.occurrence, gapInstant);
  const repeated = { ...base, local_time: '01:30:00' };
  const first = Date.parse('2026-11-01T06:30:00Z');
  assert.equal(dueOccurrence(repeated, first)?.occurrence, first);
  assert.equal(dueOccurrence(repeated, Date.parse('2026-11-01T07:30:00Z')), null);
});

test('a late worker still finds reminders from just before local midnight', () => {
  const row = { ...base, local_time: '23:58:00' };
  const now = Date.parse('2026-10-30T05:03:00Z');
  assert.equal(dueOccurrence(row, now)?.localDate, '2026-10-29');
});

test('service worker uses privacy-conscious payload and safe same-origin habit links', async () => {
  const handlers: Record<string, (event: Record<string, unknown>) => void> = {};
  let shown: { title: string; options: Record<string, unknown> } | undefined;
  let navigated = '';
  const worker = readFileSync('public/sw.js', 'utf8');
  runInNewContext(worker, {
    URL, encodeURIComponent,
    self: {
      location: { origin: 'https://timehack.example' },
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => { handlers[name] = handler; },
      registration: { showNotification: async (title: string, options: Record<string, unknown>) => { shown = { title, options }; } },
      clients: { matchAll: async () => [{ url: 'https://timehack.example/', focus: async () => {}, navigate: async (url: string) => { navigated = url; } }], openWindow: async () => {} },
    },
  });
  let work: Promise<unknown> = Promise.resolve();
  handlers.push({ data: { json: () => ({ habitId: 'h1', title: 'Private study details' }) }, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(shown?.title, 'TimeHack reminder');
  assert.equal(shown?.options.body, 'A habit is ready for your attention.');
  const notification = { data: shown?.options.data, close: () => {} };
  handlers.notificationclick({ notification, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
  await work;
  assert.equal(navigated, 'https://timehack.example/#habit-h1');
  assert.ok(!worker.includes('caches.open'));
});

test('migration protects subscription credentials and claims deliveries atomically', () => {
  const sql = readFileSync('supabase/migrations/20261029010000_milestone_4b_push.sql', 'utf8');
  assert.match(sql, /unique \(subscription_id, habit_id, local_date, kind\)/);
  assert.match(sql, /on conflict \(subscription_id, habit_id, local_date, kind\) do update/);
  assert.match(sql, /public\.push_deliveries\.lease_until < now\(\)/);
  assert.match(sql, /alter table public\.push_subscriptions enable row level security/);
  assert.match(sql, /revoke all on public\.push_subscriptions from public, anon, authenticated/);
  assert.match(sql, /v_owner <> v_user/);
  assert.match(sql, /public\.claim_timehack_push_test/);
});
