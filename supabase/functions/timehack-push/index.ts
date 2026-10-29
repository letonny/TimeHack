// Deploy with verify_jwt = false. This handler authenticates both call paths.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import webpush from 'npm:web-push@3.6.7';
import { dueOccurrence, type PushCandidate } from '../../../lib/push-eligibility.ts';

const required = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const validPushHost = (endpoint: string) => {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.port && (
      url.hostname === 'fcm.googleapis.com' ||
      url.hostname === 'updates.push.services.mozilla.com' ||
      url.hostname === 'web.push.apple.com' ||
      url.hostname.endsWith('.push.apple.com') ||
      url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
};

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth_key: string };

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const secret = required('TIMEHACK_WORKER_SECRET');
    const isWorker = request.headers.get('x-timehack-worker-secret') === secret;
    const url = required('SUPABASE_URL');
    const service = createClient(url, required('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
    const bearer = request.headers.get('authorization')?.replace(/^Bearer /i, '') ?? '';
    let testUser: string | null = null;
    if (!isWorker) {
      if (!bearer) return json({ error: 'Authentication required' }, 401);
      const userClient = createClient(url, required('SUPABASE_ANON_KEY'), {
        global: { headers: { Authorization: `Bearer ${bearer}` } }, auth: { persistSession: false },
      });
      const { data: auth, error: authError } = await userClient.auth.getUser(bearer);
      if (authError || !auth.user) return json({ error: 'Authentication required' }, 401);
      const { data: allowed, error: limitError } = await userClient.rpc('claim_timehack_push_test');
      if (limitError) throw limitError;
      if (!allowed) return json({ error: 'Wait one minute before testing again' }, 429);
      testUser = auth.user.id;
    }

    webpush.setVapidDetails(required('VAPID_SUBJECT'), required('VAPID_PUBLIC_KEY'), required('VAPID_PRIVATE_KEY'));
    let sent = 0, failed = 0, scanned = 0;
    const now = Date.now();
    const send = async (sub: Subscription, habitId: string, localDate: string, occurrence: number, kind: 'test' | 'scheduled') => {
      if (!validPushHost(sub.endpoint)) { failed++; return; }
      let token: string | null = null;
      if (kind === 'scheduled') {
        const { data, error } = await service.rpc('claim_timehack_push_delivery', {
          p_subscription_id: sub.id, p_habit_id: habitId,
          p_local_date: localDate, p_occurrence_at: new Date(occurrence).toISOString(),
        });
        if (error) throw error;
        token = data;
        if (!token) return;
      }
      let status = 0;
      try {
        const payload = JSON.stringify({ userId: sub.user_id, habitId, tag: kind === 'test' ? 'timehack-test' : `timehack-${habitId}-${localDate}` });
        const response = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, payload, { TTL: 3600, timeout: 10000 });
        status = response.statusCode;
        sent++;
      } catch (error) {
        status = typeof error === 'object' && error !== null && 'statusCode' in error ? Number(error.statusCode) : 0;
        failed++;
      }
      if (status === 404 || status === 410) {
        await service.from('push_subscriptions').update({ status: 'expired', last_error_code: status, updated_at: new Date().toISOString() }).eq('id', sub.id);
      }
      if (token) {
        await service.from('push_deliveries').update({
          state: status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'expired' : 'failed',
          http_status: status || null,
          lease_until: new Date(now + 120000).toISOString(), updated_at: new Date().toISOString(),
        }).eq('subscription_id', sub.id).eq('habit_id', habitId).eq('local_date', localDate).eq('kind', 'scheduled').eq('claim_token', token);
      }
    };

    if (testUser) {
      const { data, error } = await service.from('push_subscriptions').select('id,user_id,endpoint,p256dh,auth_key')
        .eq('user_id', testUser).eq('status', 'active').limit(20);
      if (error) throw error;
      for (const sub of (data ?? []) as Subscription[]) await send(sub, '', '', now, 'test');
      return json({ sent, failed, devices: data?.length ?? 0 });
    }

    // Bounded scan; every minute Cron rechecks the last 15 minutes, so a short
    // outage or delayed worker invocation can still be delivered.
    for (let offset = 0; offset < 5000; offset += 200) {
      const { data, error } = await service.from('habit_reminder_delivery_candidates')
        .select('user_id,habit_id,local_time,time_zone,weekday_mask,skip_if_goal_complete')
        .order('user_id').order('habit_id').range(offset, offset + 199);
      if (error) throw error;
      const candidates = (data ?? []) as PushCandidate[];
      for (const row of candidates) {
        scanned++;
        const due = dueOccurrence(row, now);
        if (!due) continue;
        const { localDate, occurrence } = due;
        if (row.skip_if_goal_complete) {
          const { data: complete, error: progressError } = await service.rpc('timehack_habit_goal_complete', {
            p_user_id: row.user_id, p_habit_id: row.habit_id, p_local_date: localDate, p_time_zone: row.time_zone,
          });
          if (progressError) throw progressError;
          if (complete) continue;
        }
        const { data: subs, error: subError } = await service.from('push_subscriptions')
          .select('id,user_id,endpoint,p256dh,auth_key').eq('user_id', row.user_id).eq('status', 'active').limit(20);
        if (subError) throw subError;
        for (const sub of (subs ?? []) as Subscription[]) await send(sub, row.habit_id, localDate, occurrence, 'scheduled');
      }
      if (candidates.length < 200) break;
    }
    return json({ scanned, sent, failed });
  } catch (error) {
    console.error('timehack-push failed', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'Delivery worker failed' }, 500);
  }
});
