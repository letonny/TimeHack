import assert from 'node:assert/strict';
import test from 'node:test';
import { mapRows, newCache, nextChange, readCache, revisionKey, writeCache } from '../lib/cloud.ts';
import { deleteReminder, reminderAppliesOnDate, reminderSummary, resolveReminderInstant, saveReminder, shouldSuppressReminder, validateReminder } from '../lib/reminders.ts';
import { emptyState, type HabitReminder } from '../lib/timer.ts';

const reminder: HabitReminder = {
  habitId: 'habit-1', enabled: true, localTime: '09:30', timeZone: 'America/Chicago',
  weekdays: [1, 2, 3, 4, 5], skipIfGoalComplete: true,
};

test('reminder CRUD supports one optional schedule per habit', () => {
  const base = { ...emptyState(), habits: [{ id: 'habit-1', name: 'Study', goalMinutes: 60 }] };
  const created = saveReminder(base, reminder);
  assert.deepEqual(created.reminders, [reminder]);
  const updated = saveReminder(created, { ...reminder, enabled: false, localTime: '18:05' });
  assert.equal(updated.reminders.length, 1);
  assert.equal(updated.reminders[0].localTime, '18:05');
  assert.equal(updated.reminders[0].enabled, false);
  assert.deepEqual(deleteReminder(updated, 'habit-1').reminders, []);
  assert.throws(() => saveReminder(base, { ...reminder, habitId: 'missing' }), /no longer exists/);
});

test('weekday selection and disabled schedules are explicit', () => {
  assert.equal(reminderAppliesOnDate(reminder, '2026-10-26'), true); // Monday
  assert.equal(reminderAppliesOnDate(reminder, '2026-10-25'), false); // Sunday
  assert.equal(reminderAppliesOnDate({ ...reminder, enabled: false }, '2026-10-26'), false);
  assert.match(reminderSummary(reminder), /weekdays/);
  assert.match(reminderSummary({ ...reminder, enabled: false }), /^Paused/);
  assert.equal(shouldSuppressReminder(reminder, true), true);
  assert.equal(shouldSuppressReminder(reminder, false), false);
  assert.equal(shouldSuppressReminder({ ...reminder, skipIfGoalComplete: false }, true), false);
});

test('reminder validation rejects malformed time, zone, and weekday selections', () => {
  for (const localTime of ['9:30', '24:00', '12:60', 'noon'])
    assert.throws(() => validateReminder({ ...reminder, localTime }), /valid reminder time/);
  for (const timeZone of ['CST', 'Not/A_Zone', ''])
    assert.throws(() => validateReminder({ ...reminder, timeZone }), /valid IANA time zone/);
  assert.throws(() => validateReminder({ ...reminder, weekdays: [] }), /at least one weekday/);
  assert.deepEqual(validateReminder({ ...reminder, weekdays: [5, 1, 5, 3] }).weekdays, [1, 3, 5]);
});

test('DST gaps advance to the first valid minute and repeated times choose the first occurrence', () => {
  const spring = resolveReminderInstant({ ...reminder, localTime: '02:30', timeZone: 'America/New_York' }, '2026-03-08');
  assert.equal(new Date(spring).toISOString(), '2026-03-08T07:00:00.000Z');
  const fall = resolveReminderInstant({ ...reminder, localTime: '01:30', timeZone: 'America/New_York' }, '2026-11-01');
  assert.equal(new Date(fall).toISOString(), '2026-11-01T05:30:00.000Z');
});

test('cloud rows preserve reminders, revisions, suppression settings, and account ownership', () => {
  const user = 'alice';
  const mapped = mapRows(user,
    [{ user_id: user, id: 'habit-1', name: 'Study', goal_minutes: 60, revision: 1, deleted_at: null }],
    [], [], [], [], [],
    [{ user_id: user, habit_id: 'habit-1', enabled: true, local_time: '09:30:00', time_zone: 'America/Chicago', weekday_mask: 31, skip_if_goal_complete: true, revision: 4, deleted_at: null }]);
  assert.deepEqual(mapped.state.reminders, [reminder]);
  assert.equal(mapped.revisions[revisionKey('reminder', 'habit-1')], 4);
  assert.throws(() => mapRows(user, [], [], [], [], [], [], [{ user_id: 'bob', habit_id: 'habit-1', enabled: true, local_time: '09:30:00', time_zone: 'UTC', weekday_mask: 127, skip_if_goal_complete: false, revision: 1, deleted_at: null }]), /Account data mismatch/);
});

test('reminder queues and account cache survive refresh while legacy caches gain an empty list', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const cache = newCache('alice');
  cache.state.habits.push({ id: 'habit-1', name: 'Study', goalMinutes: 60 });
  cache.state.reminders.push(reminder);
  cache.queue.push(nextChange(cache, 'reminder', reminder.habitId, 'save', reminder));
  writeCache(storage, cache);
  const restored = readCache(storage, 'alice');
  assert.deepEqual(restored?.state.reminders, [reminder]);
  assert.equal(restored?.queue[0].entityType, 'reminder');

  const legacy = newCache('legacy');
  const stateWithoutReminders = { ...legacy.state } as Partial<typeof legacy.state>;
  delete stateWithoutReminders.reminders;
  storage.setItem('timehack.cloud.v1.legacy', JSON.stringify({ ...legacy, state: stateWithoutReminders }));
  assert.deepEqual(readCache(storage, 'legacy')?.state.reminders, []);
  storage.setItem('timehack.cloud.v1.legacy', JSON.stringify({ ...legacy, state: { ...legacy.state, reminders: [{ ...reminder, localTime: '99:00' }] } }));
  assert.throws(() => readCache(storage, 'legacy'), /valid reminder time/);
});
