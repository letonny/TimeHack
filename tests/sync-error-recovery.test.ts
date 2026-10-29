import assert from 'node:assert/strict';
import test from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { applyChange, fetchCloud, SyncError } from '../lib/cloud-repository.ts';
import { mapRows, newCache, nextChange, readCache, revisionKey, writeCache, type Change } from '../lib/cloud.ts';
import { emptyState } from '../lib/timer.ts';

const cloudTableColumns: Record<string, Set<string>> = {
  habits: new Set(['id', 'user_id']),
  activity_sessions: new Set(['id', 'user_id']),
  session_segments: new Set(['session_id', 'position', 'user_id']),
  activities: new Set(['id', 'user_id']),
  user_profiles: new Set(['user_id']),
  manual_duration_entries: new Set(['id', 'user_id']),
  habit_reminders: new Set(['habit_id', 'user_id']),
};

type MockOptions = {
  rows?: Record<string, Record<string, unknown>[]>;
  tableErrors?: Record<string, { code: string; message: string }>;
  rpcError?: { code: string; message: string };
  rpcRevision?: number;
};

function mockClient(options: MockOptions = {}) {
  const orders: Record<string, string[]> = {};
  const rpcs: { name: string; parameters: Record<string, unknown> }[] = [];
  const client = {
    from(table: string) {
      orders[table] = [];
      const query = {
        select: () => query,
        eq: () => query,
        order: (column: string) => {
          orders[table].push(column);
          return query;
        },
        range: async () => {
          const invalidColumn = orders[table].find(column => !cloudTableColumns[table]?.has(column));
          if (invalidColumn) {
            return {
              data: null,
              error: {
                code: '42703',
                message: `column ${table}.${invalidColumn} does not exist`,
              },
            };
          }
          return {
            data: options.rows?.[table] ?? null,
            error: options.tableErrors?.[table] ?? null,
          };
        },
      };
      return query;
    },
    async rpc(name: string, parameters: Record<string, unknown>) {
      rpcs.push({ name, parameters });
      return { data: options.rpcError ? null : (options.rpcRevision ?? 1), error: options.rpcError ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, orders, rpcs };
}

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

test('fetchCloud uses a real ordering column for every cloud table', async () => {
  const { client, orders } = mockClient();
  const result = await fetchCloud(client, 'user');
  assert.deepEqual(result.state, emptyState());
  assert.deepEqual(result.revisions, {});
  assert.deepEqual(orders.habit_reminders, ['habit_id']);
  assert.deepEqual(orders.session_segments, ['session_id', 'position']);
});

test('the former habit_reminders.id query is classified as PostgreSQL 42703', async () => {
  const { client } = mockClient({
    tableErrors: {
      habit_reminders: { code: '42703', message: 'column habit_reminders.id does not exist' },
    },
  });
  await assert.rejects(fetchCloud(client, 'user'), error => {
    assert.ok(error instanceof SyncError);
    assert.equal(error.kind, 'schema');
    assert.equal(error.operation, 'fetch');
    assert.equal(error.resource, 'habit_reminders');
    assert.equal(error.serverCode, '42703');
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes('column habit_reminders.id'));
    return true;
  });
});

test('existing cloud habits, sessions, activities, profiles, and reminders load together', async () => {
  const user = 'u1';
  const started = new Date(2026, 9, 28, 9).getTime();
  const ended = started + 3_600_000;
  const { client } = mockClient({ rows: {
    habits: [{ user_id: user, id: 'h1', name: 'Study', goal_minutes: 60, revision: 3, deleted_at: null }],
    activity_sessions: [{ user_id: user, id: 's1', name: 'Study', started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString(), revision: 2, deleted_at: null }],
    session_segments: [{ user_id: user, session_id: 's1', position: 0, kind: 'study', started_at: new Date(started).toISOString(), ended_at: new Date(ended).toISOString() }],
    activities: [{ user_id: user, id: 'a1', name: 'Coding', icon: 'laptop', color: '#a78bfa', revision: 1, deleted_at: null }],
    user_profiles: [{ user_id: user, display_name: 'Alice', revision: 1 }],
    habit_reminders: [{ user_id: user, habit_id: 'h1', enabled: true, local_time: '09:00:00', time_zone: 'America/Chicago', weekday_mask: 31, skip_if_goal_complete: true, revision: 4, deleted_at: null }],
  } });
  const result = await fetchCloud(client, user);
  assert.equal(result.state.habits[0].name, 'Study');
  assert.equal(result.state.completed[0].id, 's1');
  assert.equal(result.state.activities[0].name, 'Coding');
  assert.equal(result.state.profile.displayName, 'Alice');
  assert.equal(result.state.reminders[0].localTime, '09:00');
  assert.equal(result.revisions[revisionKey('reminder', 'h1')], 4);
});

test('map failures identify the mapping stage without exposing cloud row contents', async () => {
  const user = 'u1';
  const started = new Date(2026, 9, 28, 9).toISOString();
  const { client } = mockClient({ rows: {
    activity_sessions: [{ user_id: user, id: 'private-session-id', name: 'Private activity', started_at: started, ended_at: started, revision: 1, deleted_at: null }],
  } });
  await assert.rejects(fetchCloud(client, user), error => {
    assert.ok(error instanceof SyncError);
    assert.equal(error.kind, 'missing_segments');
    assert.equal(error.operation, 'map');
    assert.equal(error.resource, 'cloud rows');
    assert.ok(!error.message.includes('private-session-id'));
    assert.ok(!error.message.includes('Private activity'));
    return true;
  });
});

test('applyChange routes reminder events separately and keeps RPC arguments intact', async () => {
  const cache = newCache('user');
  const habit = nextChange(cache, 'habit', 'h1', 'save', { id: 'h1', name: 'Study', goalMinutes: 30 });
  const reminder = nextChange(cache, 'reminder', 'h1', 'save', { habitId: 'h1', enabled: true, localTime: '09:00', timeZone: 'UTC', weekdays: [1], skipIfGoalComplete: true });
  const { client, rpcs } = mockClient({ rpcRevision: 7 });
  assert.equal(await applyChange(client, habit), 7);
  assert.equal(await applyChange(client, reminder), 7);
  assert.deepEqual(rpcs.map(call => call.name), ['apply_timehack_change', 'apply_timehack_reminder_change']);
  assert.equal(rpcs[1].parameters.p_event_id, reminder.eventId);
  assert.equal(rpcs[1].parameters.p_expected_revision, reminder.expectedRevision);
  assert.deepEqual(rpcs[1].parameters.p_payload, reminder.payload);
});

test('failed queue replay reports safe context and leaves the pending event recoverable', async () => {
  const storage = memory();
  const cache = newCache('user');
  const pending = nextChange(cache, 'habit', 'h1', 'save', { id: 'h1', name: 'Study', goalMinutes: 30 });
  cache.queue.push(pending);
  writeCache(storage, cache);
  const { client } = mockClient({ rpcError: { code: '22023', message: 'private server validation details' } });
  await assert.rejects(applyChange(client, pending), error => {
    assert.ok(error instanceof SyncError);
    assert.equal(error.kind, 'invalid');
    assert.equal(error.operation, 'replay');
    assert.equal(error.resource, 'apply_timehack_change');
    assert.equal(error.entityType, 'habit');
    assert.equal(error.action, 'save');
    assert.equal(error.retryable, false);
    assert.ok(!error.message.includes('private server validation details'));
    return true;
  });
  const restored = readCache(storage, 'user');
  assert.equal(restored?.queue.length, 1);
  assert.equal(restored?.queue[0].eventId, pending.eventId);
  assert.deepEqual(restored?.queue[0].payload, pending.payload);
});

test('nextChange accounts for earlier pending events in the same revision stream', () => {
  const cache = newCache('user');
  const create = nextChange(cache, 'habit', 'h1', 'save', { id: 'h1', name: 'Study', goalMinutes: 30 });
  cache.queue.push(create);
  const update = nextChange(cache, 'habit', 'h1', 'save', { id: 'h1', name: 'Study more', goalMinutes: 45 });
  assert.equal(create.expectedRevision, 0);
  assert.equal(update.expectedRevision, 1);
});

test('reminder save and delete retain deterministic queue order and revisions', () => {
  const cache = newCache('user');
  const payload = { habitId: 'h1', enabled: true, localTime: '09:00', timeZone: 'UTC', weekdays: [1, 2, 3, 4, 5] as [1, 2, 3, 4, 5], skipIfGoalComplete: true };
  const save = nextChange(cache, 'reminder', 'h1', 'save', payload);
  cache.queue.push(save);
  const remove = nextChange(cache, 'reminder', 'h1', 'delete', {});
  cache.queue.push(remove);
  assert.deepEqual(cache.queue.map(change => change.action), ['save', 'delete']);
  assert.deepEqual(cache.queue.map(change => change.expectedRevision), [0, 1]);
});

test('cloud row mapping still rejects data from another account', () => {
  assert.throws(
    () => mapRows('alice', [{ user_id: 'bob', id: 'h1', name: 'Private', goal_minutes: 30, revision: 1, deleted_at: null }], [], []),
    /Account data mismatch/,
  );
});

test('SyncError metadata never requires storing a failed private payload', () => {
  const change: Change = {
    eventId: 'event-id',
    entityType: 'session',
    entityId: 'session-id',
    action: 'save',
    expectedRevision: 0,
    payload: { id: 'session-id', name: 'Private', startedAt: 1, endedAt: null, segments: [{ kind: 'study', startedAt: 1, endedAt: null }] },
    occurredAt: new Date().toISOString(),
  };
  const error = new SyncError('Cloud change replay failed for session (invalid)', 'invalid', {
    operation: 'replay',
    resource: 'apply_timehack_change',
    eventId: change.eventId,
    entityType: change.entityType,
    entityId: change.entityId,
    action: change.action,
  });
  assert.equal('payload' in error, false);
  assert.ok(!JSON.stringify(error).includes('Private'));
});
