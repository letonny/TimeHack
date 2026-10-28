import type { SupabaseClient } from '@supabase/supabase-js';
import { mapRows, type Change } from './cloud.ts';

async function allRows(client: SupabaseClient, table: 'habits' | 'activity_sessions' | 'session_segments' | 'activities' | 'user_profiles' | 'manual_duration_entries' | 'habit_reminders', userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = client.from(table).select('*').eq('user_id', userId)
      .order(table === 'session_segments' ? 'session_id' : table === 'user_profiles' ? 'user_id' : 'id');
    if (table === 'session_segments') query = query.order('position');
    const { data, error } = await query.range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows;
}
export async function fetchCloud(client: SupabaseClient, userId: string) {
  const [habits, sessions, segments, activities, profiles, manualDurations, reminders] = await Promise.all([
    allRows(client, 'habits', userId), allRows(client, 'activity_sessions', userId), allRows(client, 'session_segments', userId), allRows(client, 'activities', userId), allRows(client, 'user_profiles', userId), allRows(client, 'manual_duration_entries', userId), allRows(client, 'habit_reminders', userId),
  ]);
  return mapRows(userId, habits as Parameters<typeof mapRows>[1], sessions as Parameters<typeof mapRows>[2], segments as Parameters<typeof mapRows>[3], activities as Parameters<typeof mapRows>[4], profiles as Parameters<typeof mapRows>[5], manualDurations as Parameters<typeof mapRows>[6], reminders as Parameters<typeof mapRows>[7]);
}
export async function applyChange(client: SupabaseClient, change: Change): Promise<number> {
  const { data, error } = await client.rpc(change.entityType === 'reminder' ? 'apply_timehack_reminder_change' : 'apply_timehack_change', {
    p_event_id: change.eventId, p_entity_type: change.entityType, p_entity_id: change.entityId,
    p_action: change.action, p_expected_revision: change.expectedRevision,
    p_payload: change.payload, p_occurred_at: change.occurredAt,
  });
  if (error) throw error;
  if (typeof data !== 'number' || !Number.isSafeInteger(data)) throw new Error('Invalid server revision');
  return data;
}
