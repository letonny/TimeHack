'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyState, endSet, pause, resume, start, startSet, stop, type Activity, type Habit, type HabitReminder, type Profile, type Session, type TimerState } from '@/lib/timer';
import { saveHabit } from '@/lib/habits';
import { activityForName, saveActivity } from '@/lib/activity-metadata';
import { validateDisplayName } from '@/lib/personalization';
import { deleteReminder as removeReminderFromState, saveReminder as saveReminderInState } from '@/lib/reminders';
import { removeCompletedSession, replaceCompletedSession } from '@/lib/session-actions';
import { loadState, STORAGE_KEY } from '@/lib/storage';
import { createClient } from '@/lib/supabase/client';
import { applyChange, fetchCloud, SyncError } from '@/lib/cloud-repository';
import { canOfferImport, cloudKey, LEGACY_CLAIM_KEY, newCache, nextChange, readCache, revisionKey, sessionChanges, writeCache, type Change, type CloudCache } from '@/lib/cloud';

/** Sanitized user-facing label for a sync error, with no server internals. */
function syncErrorMessage(err: unknown): string {
  if (err instanceof SyncError) {
    switch (err.kind) {
      case 'auth':
        return 'Sign-in session expired. Please reload the page to sign in again.';
      case 'permission':
        return 'A permission error prevented synchronization. Try signing out and back in.';
      case 'conflict':
        return 'Another device changed this record. Pending changes remain saved on this device. Choose the cloud version only after reviewing the conflict.';
      case 'invalid':
        return err.operation === 'replay'
          ? `A pending ${err.entityType ?? 'account'} change was rejected by the server. It remains saved on this device so it can be recovered and retried.`
          : 'A cloud record could not be loaded. Try reloading the page.';
      case 'schema':
        return 'The app and cloud schema do not match. Pending changes remain saved on this device. Update the app or contact support.';
      case 'missing_segments':
        return 'A cloud session is incomplete. Contact support — your local data is untouched.';
      case 'network':
        return 'Cloud sync failed. Changes remain saved for this account on this device. Retry when connected.';
      default:
        return 'Cloud sync failed. Changes remain saved for this account on this device. Retry when connected.';
    }
  }
  return 'Cloud sync failed. Changes remain saved for this account on this device. Retry when connected.';
}

function logSyncDiagnostic(cause: unknown, pendingChanges: number): void {
  if (process.env.NODE_ENV !== 'development') return;
  if (cause instanceof SyncError) {
    console.error('[TimeHack sync]', {
      operation: cause.operation,
      resource: cause.resource,
      code: cause.serverCode ?? 'none',
      category: cause.kind,
      retryable: cause.retryable,
      eventType: cause.entityType,
      eventAction: cause.action,
      pendingChanges,
      pendingChangesPreserved: true,
    });
    return;
  }
  console.error('[TimeHack sync]', {
    operation: 'unknown',
    category: 'unknown',
    retryable: true,
    pendingChanges,
    pendingChangesPreserved: true,
  });
}

export function useTimer() {
  const [state, setState] = useState<TimerState>(emptyState);
  const [now, setNow] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const [legacyAvailable, setLegacyAvailable] = useState(false);
  const [legacyPreview, setLegacyPreview] = useState<TimerState | null>(null);
  const [conflict, setConflict] = useState(false);
  const cacheRef = useRef<CloudCache | null>(null);
  const userRef = useRef<string | null>(null);
  const clientRef = useRef<SupabaseClient | null>(null);
  const busyRef = useRef(false);
  const conflictRef = useRef(false);
  const syncRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    let mounted = true;
    const client = createClient();
    clientRef.current = client;
    const publish = (cache: CloudCache) => {
      if (!mounted || userRef.current !== cache.userId) return;
      cacheRef.current = cache; setState(cache.state); setPending(cache.queue.length); setReady(true);
    };
    const sync = async () => {
      const userId = userRef.current;
      if (!userId || busyRef.current || !cacheRef.current || conflictRef.current) return;
      busyRef.current = true;
      if (mounted) setSyncing(true);
      try {
        while (cacheRef.current?.queue.length && userRef.current === userId) {
          const change = cacheRef.current.queue[0];
          const revision = await applyChange(client, change);
          const latest = readCache(window.localStorage, userId) ?? cacheRef.current;
          if (!latest || latest.queue[0]?.eventId !== change.eventId) continue;
          latest.revisions[revisionKey(change.entityType, change.entityId)] = revision;
          latest.queue.shift();
          writeCache(window.localStorage, latest);
          publish(latest);
        }
        if (userRef.current !== userId) return;
        const remote = await fetchCloud(client, userId);
        const latest = readCache(window.localStorage, userId) ?? cacheRef.current;
        if (latest && !latest.queue.length) {
          latest.state = remote.state; latest.revisions = remote.revisions;
          writeCache(window.localStorage, latest); publish(latest);
        }
        if (mounted) setSyncError('');
      } catch (cause) {
        if (!mounted) return;
        logSyncDiagnostic(cause, cacheRef.current?.queue.length ?? 0);
        const stale = cause instanceof SyncError
          ? cause.kind === 'conflict'
          : typeof cause === 'object' && cause !== null && 'code' in cause && (cause.code === '40001' || cause.code === '23505');
        conflictRef.current = stale; setConflict(stale);
        setSyncError(syncErrorMessage(cause));
      } finally {
        busyRef.current = false;
        if (mounted) setSyncing(false);
      }
    };
    syncRef.current = sync;
    async function initialize() {
      try {
        const { data, error: authError } = await client.auth.getUser();
        if (authError || !data.user) throw authError ?? new Error('Sign in required');
        if (!mounted) return;
        const userId = data.user.id;
        userRef.current = userId;
        const cache = readCache(window.localStorage, userId) ?? newCache(userId);
        cacheRef.current = cache;
        if (window.localStorage.getItem(cloudKey(userId))) publish(cache);
        setLegacyAvailable(canOfferImport(window.localStorage, userId, !!window.localStorage.getItem(STORAGE_KEY)));
        setNow(Date.now());
        await sync();
      } catch {
        if (mounted) setError('Account data could not be loaded. Check your connection and browser storage, then retry. Existing data is unchanged.');
      }
    }
    void initialize();
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    const interval = window.setInterval(() => void syncRef.current(), 8000);
    const visible = () => { setNow(Date.now()); if (!document.hidden) void syncRef.current(); };
    const storage = (event: StorageEvent) => {
      const userId = userRef.current;
      if (userId && event.key === cloudKey(userId)) {
        try { const cache = readCache(window.localStorage, userId); if (cache) publish(cache); }
        catch { setError('The account cache could not be read. Tracking is paused to protect your data.'); setReady(false); }
      }
      if (userId && event.key === STORAGE_KEY)
        setLegacyAvailable(canOfferImport(window.localStorage, userId, !!event.newValue));
    };
    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (userRef.current && session?.user.id !== userRef.current) {
        userRef.current = null; cacheRef.current = null; setState(emptyState()); setLegacyPreview(null); setReady(false);
      }
    });
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    return () => { mounted = false; clearInterval(clock); clearInterval(interval); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', visible); listener.subscription.unsubscribe(); };
  }, []);

  function commitBatch(next: TimerState, changes: Pick<Change, 'entityType' | 'entityId' | 'action' | 'payload' | 'operation'>[]) {
    if (!changes.length) return false;
    const cache = cacheRef.current;
    if (!ready || !cache || conflictRef.current || cache.userId !== userRef.current) return false;
    try {
      const stored = readCache(window.localStorage, cache.userId);
      if (stored && JSON.stringify(stored) !== JSON.stringify(cache)) {
        cacheRef.current = stored; setState(stored.state); setPending(stored.queue.length);
        setError('Another tab changed this account. The latest saved data is loaded; please try your action again.');
        return false;
      }
      const normalized: TimerState = { ...next,
        active: next.active ? { ...next.active, sets: next.active.sets ?? [] } : null,
        completed: next.completed.map(item => ({ ...item, sets: item.sets ?? [] })) };
      const updated: CloudCache = { ...cache, state: normalized, queue: [...cache.queue] };
      for (const change of changes) updated.queue.push(nextChange(updated, change.entityType, change.entityId, change.action, change.payload, change.operation));
      writeCache(window.localStorage, updated);
      cacheRef.current = updated; setState(normalized); setPending(updated.queue.length); setNow(Date.now()); setError('');
      void syncRef.current();
      return true;
    } catch {
      setError('Your change could not be saved on this device. Check browser storage permissions or available space.');
      return false;
    }
  }
  function commit(next: TimerState, entityType: Change['entityType'], entityId: string, action: 'save' | 'delete', payload: Change['payload']) {
    return commitBatch(next, [{ entityType, entityId, action, payload }]);
  }
  function sessionUpdate(transform: (state: TimerState, time: number) => TimerState, createdId?: string) {
    const cache = cacheRef.current;
    if (!cache) return false;
    const next = transform(cache.state, Date.now());
    if (next === cache.state) return false;
    const id = createdId ?? cache.state.active?.id;
    const session = next.active?.id === id ? next.active : next.completed.find(item => item.id === id);
    return id && session ? commitBatch(next, sessionChanges(cache.state.active, session)) : false;
  }
  async function importLegacy() {
    const userId = userRef.current, client = clientRef.current, cache = cacheRef.current;
    if (!userId || !client || !cache || cache.queue.length || busyRef.current || !canOfferImport(window.localStorage, userId, !!window.localStorage.getItem(STORAGE_KEY))) return;
    try {
      const legacy = loadState(window.localStorage);
      const remote = await fetchCloud(client, userId);
      if (Object.keys(remote.revisions).length) {
        setSyncError('Import requires an empty cloud account. Browser data remains untouched.');
        return;
      }
      const count = legacy.habits.length + legacy.completed.length + (legacy.active ? 1 : 0);
      if (!count) { setLegacyAvailable(false); return; }
      if (!window.confirm(`Import ${legacy.habits.length} habits and ${legacy.completed.length + (legacy.active ? 1 : 0)} sessions from this browser? They may belong to someone else who used this browser. Confirm only if they are yours. Original browser data will remain untouched.`)) return;
      if (!canOfferImport(window.localStorage, userId, true)) throw new Error('Browser data claimed by another account');
      window.localStorage.setItem(LEGACY_CLAIM_KEY, userId);
      const queue = [
        ...legacy.habits.map(habit => nextChange(cache, 'habit', habit.id, 'import', habit)),
        ...[...legacy.completed, ...(legacy.active ? [legacy.active] : [])].map(session => nextChange(cache, 'session', session.id, 'import', session)),
      ];
      const updated = { ...cache, state: legacy, revisions: {}, queue };
      writeCache(window.localStorage, updated);
      cacheRef.current = updated; setState(legacy); setPending(queue.length); setReady(true); setLegacyAvailable(false);
      void syncRef.current();
    } catch {
      setSyncError('Import could not start. Browser data remains untouched; check its validity and storage permissions.');
    }
  }
  function previewLegacy() {
    const userId = userRef.current;
    if (!userId || !canOfferImport(window.localStorage, userId, !!window.localStorage.getItem(STORAGE_KEY))) return;
    try { setLegacyPreview(loadState(window.localStorage)); setSyncError(''); }
    catch { setSyncError('The older browser data could not be read. It remains untouched.'); }
  }
  async function useCloudVersion() {
    const cache = cacheRef.current, client = clientRef.current;
    if (!cache || !client || !conflictRef.current || !window.confirm('Back up pending changes in this browser and load the cloud version?')) return;
    try {
      const remote = await fetchCloud(client, cache.userId);
      window.localStorage.setItem(`timehack.conflict.backup.v1.${cache.userId}.${Date.now()}`, JSON.stringify(cache));
      const updated = { ...cache, ...remote, queue: [] };
      writeCache(window.localStorage, updated);
      cacheRef.current = updated; setState(updated.state); setPending(0);
      conflictRef.current = false; setConflict(false);
      setSyncError('Cloud version loaded. A backup of pending changes remains in this browser.');
    } catch { setSyncError('Could not load the cloud version. Pending changes remain saved on this device.'); }
  }
  return { state, now, ready: ready && !conflict, error, syncError, syncing, pending, legacyAvailable, legacyPreview, conflict,
    retry: () => { if (!userRef.current) window.location.reload(); else { conflictRef.current = false; setConflict(false); void syncRef.current(); } },
    previewLegacy, importLegacy, useCloudVersion,
    start: (name: string) => { const id = crypto.randomUUID(); return sessionUpdate((current, time) => { const activity = activityForName(current, name); return start(current, name, time, id, activity.id || null); }, id); },
    set: (description = 'SET', expectedActiveSetId: string | null = null) => { const id = crypto.randomUUID(); return sessionUpdate((current, time) => startSet(current, time, id, description, expectedActiveSetId)); },
    endSet: () => sessionUpdate(endSet), pause: () => sessionUpdate(pause), resume: () => sessionUpdate(resume),
    stop: (note = '') => sessionUpdate((current, time) => { const next = stop(current, time); if (next === current || !next.completed[0]) return next; return { ...next, completed: [{ ...next.completed[0], note: note.trim().slice(0, 2000) }, ...next.completed.slice(1)] }; }),
    logManual: (session: Session) => { const cache = cacheRef.current; if (!cache || cache.state.active?.id === session.id || cache.state.completed.some(item => item.id === session.id)) return false; return commit({ ...cache.state, completed: [session, ...cache.state.completed] }, 'session', session.id, 'save', session); },
    updateSession: (session: Session) => { try { const cache = cacheRef.current; if (!cache) return false; const before = cache.state.completed.find(item => item.id === session.id) ?? null; const changes = sessionChanges(before, session); if (before?.entryType === 'timer' && (before.startedAt !== session.startedAt || before.endedAt !== session.endedAt || JSON.stringify(before.segments) !== JSON.stringify(session.segments))) { const parent = changes.find(item => item.entityType === 'session'); if (parent) parent.operation = 'correct'; } return commitBatch(replaceCompletedSession(cache.state, session), changes); } catch { return false; } },
    saveHabit: (habit: Habit) => { try { const cache = cacheRef.current; if (!cache) return false; const next = saveHabit(cache.state, habit); return commit(next, 'habit', habit.id, 'save', next.habits.find(item => item.id === habit.id)!); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid habit'); return false; } },
    deleteHabit: (id: string) => {
      let cache = cacheRef.current;
      if (!cache?.state.habits.some(item => item.id === id)) return;
      if (cache.state.reminders.some(item => item.habitId === id)) {
        if (!commit(removeReminderFromState(cache.state, id), 'reminder', id, 'delete', {})) return;
        cache = cacheRef.current;
      }
      if (cache?.state.habits.some(item => item.id === id))
        commit({ ...cache.state, habits: cache.state.habits.filter(item => item.id !== id) }, 'habit', id, 'delete', {});
    },
    saveReminder: (reminder: HabitReminder) => { try { const cache = cacheRef.current; if (!cache) return false; const next = saveReminderInState(cache.state, reminder); return commit(next, 'reminder', reminder.habitId, 'save', next.reminders.find(item => item.habitId === reminder.habitId)!); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid reminder'); return false; } },
    deleteReminder: (habitId: string) => { const cache = cacheRef.current; if (cache?.state.reminders.some(item => item.habitId === habitId)) return commit(removeReminderFromState(cache.state, habitId), 'reminder', habitId, 'delete', {}); return false; },
    saveActivity: (activity: Activity) => { try { const cache = cacheRef.current; if (!cache) return false; const next = saveActivity(cache.state, activity); return commit(next, 'activity', activity.id, 'save', next.activities.find(item => item.id === activity.id)!); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid activity'); return false; } },
    deleteActivity: (id: string) => { const cache = cacheRef.current; if (cache?.state.activities.some(item => item.id === id)) return commit({ ...cache.state, activities: cache.state.activities.filter(item => item.id !== id) }, 'activity', id, 'delete', {}); return false; },
    saveProfile: (profile: Profile) => { try { const cache = cacheRef.current, userId = userRef.current; if (!cache || !userId) return false; const nextProfile = { displayName: validateDisplayName(profile.displayName) }; return commit({ ...cache.state, profile: nextProfile }, 'profile', userId, 'save', nextProfile); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid profile'); return false; } },
    remove: (id: string) => { const cache = cacheRef.current; if (cache?.state.completed.some(item => item.id === id)) commit(removeCompletedSession(cache.state, id), 'session', id, 'delete', {}); },
  };
}
