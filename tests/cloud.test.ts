import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canOfferImport, cloudKey, LEGACY_CLAIM_KEY, mapRows, newCache, nextChange, readCache, revisionKey, writeCache } from '../lib/cloud.ts';
import { duration, emptyState, todaySummary } from '../lib/timer.ts';
import { loadState, saveState, STORAGE_KEY } from '../lib/storage.ts';

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}
const day = new Date(2026, 9, 27, 10).getTime();
const iso = (time: number) => new Date(time).toISOString();

test('database rows map to exact study and break instants and retain revisions', () => {
  const mapped = mapRows('alice',
    [{ user_id: 'alice', id: 'h1', name: 'Study', goal_minutes: 60, revision: 2, deleted_at: null }],
    [{ user_id: 'alice', id: 's1', name: 'Study', started_at: iso(day), ended_at: iso(day + 90000), revision: 3, deleted_at: null }],
    [
      { user_id: 'alice', session_id: 's1', position: 1, kind: 'break', started_at: iso(day + 30000), ended_at: iso(day + 60000) },
      { user_id: 'alice', session_id: 's1', position: 2, kind: 'study', started_at: iso(day + 60000), ended_at: iso(day + 90000) },
      { user_id: 'alice', session_id: 's1', position: 0, kind: 'study', started_at: iso(day), ended_at: iso(day + 30000) },
    ]);
  assert.equal(duration(mapped.state.completed[0], day + 90000), 60000);
  assert.equal(todaySummary(mapped.state, day + 90000).milliseconds, 60000);
  assert.equal(mapped.revisions[revisionKey('session', 's1')], 3);
  assert.equal(mapped.revisions[revisionKey('habit', 'h1')], 2);
});

test('database mapping rejects records from another account', () => {
  assert.throws(() => mapRows('alice', [{ user_id: 'bob', id: 'h', name: 'Private', goal_minutes: 5, revision: 1, deleted_at: null }], [], []), /Account data mismatch/);
  assert.throws(() => mapRows('alice', [], [{ user_id: 'alice', id: 's', name: 'Study', started_at: iso(day), ended_at: null, revision: 1, deleted_at: null }], []), /missing its segments/);
});

test('per-user cache and pending event IDs survive refresh without exposing the legacy key', () => {
  const storage = memory();
  const alice = newCache('alice');
  alice.queue.push(nextChange(alice, 'session', 's1', 'save', { id: 's1', name: 'Study', startedAt: day, endedAt: null, segments: [{ kind: 'study', startedAt: day, endedAt: null }] }));
  const second = nextChange(alice, 'session', 's1', 'save', { id: 's1', name: 'Study', startedAt: day, endedAt: day + 1000, segments: [{ kind: 'study', startedAt: day, endedAt: day + 1000 }] });
  alice.queue.push(second);
  writeCache(storage, alice);
  assert.equal(readCache(storage, 'alice')?.queue[0].eventId, alice.queue[0].eventId);
  assert.equal(readCache(storage, 'alice')?.queue[1].expectedRevision, 1);
  assert.equal(readCache(storage, 'bob'), null);
  assert.notEqual(cloudKey('alice'), cloudKey('bob'));
  saveState(storage, emptyState());
  assert.equal(loadState(storage).completed.length, 0);
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('legacy import requires explicit account claim and cannot offer data to a second user', () => {
  const storage = memory();
  storage.setItem(STORAGE_KEY, '{"version":2,"active":null,"completed":[],"habits":[]}');
  assert.equal(canOfferImport(storage, 'alice', true), true);
  storage.setItem(LEGACY_CLAIM_KEY, 'alice');
  assert.equal(canOfferImport(storage, 'alice', true), true);
  assert.equal(canOfferImport(storage, 'bob', true), false);
  assert.equal(canOfferImport(storage, 'alice', false), false);
});

test('migration defines all four protected tables and transactional idempotent writes', () => {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  const files = readdirSync(dir).filter(file => file.endsWith('_milestone_3b_database.sql'));
  assert.equal(files.length, 1);
  const sql = readFileSync(join(dir, files[0]), 'utf8');
  for (const table of ['habits', 'activity_sessions', 'session_segments', 'activity_events']) {
    assert.match(sql, new RegExp(`create table public\\.${table}\\s*\\(`));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`references auth\\.users\\(id\\) on delete cascade|foreign key \\(user_id, session_id\\)`));
  }
  assert.match(sql, /create policy events_select/);
  assert.match(sql, /create policy events_insert/);
  assert.match(sql, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /timehack revision conflict/);
  assert.match(sql, /primary key \(user_id, id\)/);
});
