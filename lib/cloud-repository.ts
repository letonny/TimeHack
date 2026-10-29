import type { SupabaseClient } from '@supabase/supabase-js';
import { mapRows, type Change } from './cloud.ts';

/** Classifies sync failures without exposing the raw server response to the UI. */
export type SyncErrorKind =
  | 'auth'
  | 'permission'
  | 'conflict'
  | 'invalid'
  | 'schema'
  | 'missing_segments'
  | 'network'
  | 'unknown';

export type SyncOperation = 'fetch' | 'replay' | 'map';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly serverCode: string | undefined;
  readonly operation: SyncOperation;
  readonly resource: string;
  readonly retryable: boolean;
  readonly eventId: string | undefined;
  readonly entityType: string | undefined;
  readonly entityId: string | undefined;
  readonly action: Change['action'] | undefined;

  constructor(
    message: string,
    kind: SyncErrorKind,
    options?: {
      serverCode?: string;
      operation?: SyncOperation;
      resource?: string;
      retryable?: boolean;
      eventId?: string;
      entityType?: string;
      entityId?: string;
      action?: Change['action'];
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'SyncError';
    this.kind = kind;
    this.serverCode = options?.serverCode;
    this.operation = options?.operation ?? 'replay';
    this.resource = options?.resource ?? 'unknown';
    this.retryable = options?.retryable ?? (kind === 'auth' || kind === 'network' || kind === 'unknown');
    this.eventId = options?.eventId;
    this.entityType = options?.entityType;
    this.entityId = options?.entityId;
    this.action = options?.action;
  }
}

function classifyServerError(raw: unknown): SyncErrorKind {
  if (!raw || typeof raw !== 'object') return 'unknown';
  const code = ('code' in raw && typeof raw.code === 'string') ? raw.code : undefined;
  if (!code) {
    // Network errors (TypeError: fetch failed, etc.) have no code
    return 'network';
  }
  if (code === '40001' || code === '23505') return 'conflict';
  if (code === '22023' || code === 'P0001' || code === '23503') return 'invalid';
  if (code === 'PGRST301' || code === 'PGRST302' || code === '28000' || code === '28P01') return 'auth';
  if (code === '42501') return 'permission';
  if (code === '42703' || code === '42883' || code === '42P01' || code === 'PGRST202') return 'schema';
  return 'unknown';
}

type CloudTable =
  | 'habits'
  | 'activity_sessions'
  | 'session_segments'
  | 'activities'
  | 'user_profiles'
  | 'manual_duration_entries'
  | 'habit_reminders';

const primaryOrderColumn: Record<CloudTable, string> = {
  habits: 'id',
  activity_sessions: 'id',
  session_segments: 'session_id',
  activities: 'id',
  user_profiles: 'user_id',
  manual_duration_entries: 'id',
  habit_reminders: 'habit_id',
};

async function allRows(
  client: SupabaseClient,
  table: CloudTable,
  userId: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = client
      .from(table)
      .select('*')
      .eq('user_id', userId)
      .order(primaryOrderColumn[table]);
    if (table === 'session_segments') query = query.order('position');
    const { data, error } = await query.range(offset, offset + 499);
    if (error) {
      const kind = classifyServerError(error);
      const code = ('code' in error && typeof error.code === 'string') ? error.code : undefined;
      throw new SyncError(
        `Cloud load failed reading ${table} (${kind})`,
        kind,
        { serverCode: code, operation: 'fetch', resource: table, cause: error },
      );
    }
    rows.push(...(data ?? []));
    if (!data || data.length < 500) break;
  }
  return rows;
}

export async function fetchCloud(client: SupabaseClient, userId: string) {
  const [habits, sessions, segments, activities, profiles, manualDurations, reminders] =
    await Promise.all([
      allRows(client, 'habits', userId),
      allRows(client, 'activity_sessions', userId),
      allRows(client, 'session_segments', userId),
      allRows(client, 'activities', userId),
      allRows(client, 'user_profiles', userId),
      allRows(client, 'manual_duration_entries', userId),
      allRows(client, 'habit_reminders', userId),
    ]);
  try {
    return mapRows(
      userId,
      habits as Parameters<typeof mapRows>[1],
      sessions as Parameters<typeof mapRows>[2],
      segments as Parameters<typeof mapRows>[3],
      activities as Parameters<typeof mapRows>[4],
      profiles as Parameters<typeof mapRows>[5],
      manualDurations as Parameters<typeof mapRows>[6],
      reminders as Parameters<typeof mapRows>[7],
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const kind: SyncErrorKind = message.includes('missing its segments') ? 'missing_segments' : 'invalid';
    throw new SyncError(`Cloud data mapping failed (${kind})`, kind, {
      operation: 'map',
      resource: 'cloud rows',
      cause,
    });
  }
}

export async function applyChange(client: SupabaseClient, change: Change): Promise<number> {
  const rpcName =
    change.entityType === 'reminder'
      ? 'apply_timehack_reminder_change'
      : 'apply_timehack_change';
  const { data, error } = await client.rpc(rpcName, {
    p_event_id: change.eventId,
    p_entity_type: change.entityType,
    p_entity_id: change.entityId,
    p_action: change.action,
    p_expected_revision: change.expectedRevision,
    p_payload: change.payload,
    p_occurred_at: change.occurredAt,
  });
  if (error) {
    const kind = classifyServerError(error);
    const code = ('code' in error && typeof error.code === 'string') ? error.code : undefined;
    throw new SyncError(
      `Cloud change replay failed for ${change.entityType} (${kind})`,
      kind,
      {
        serverCode: code,
        operation: 'replay',
        resource: rpcName,
        eventId: change.eventId,
        entityType: change.entityType,
        entityId: change.entityId,
        action: change.action,
        cause: error,
      },
    );
  }
  if (typeof data !== 'number' || !Number.isSafeInteger(data))
    throw new SyncError(
      `Invalid server revision for ${change.entityType}`,
      'invalid',
      {
        operation: 'replay',
        resource: rpcName,
        eventId: change.eventId,
        entityType: change.entityType,
        entityId: change.entityId,
        action: change.action,
      },
    );
  return data;
}
