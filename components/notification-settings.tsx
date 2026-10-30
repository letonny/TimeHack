'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function NotificationSettings() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const client = useMemo(() => createClient(), []);

  useEffect(() => {
    let active = true;
    const update = async () => {
      const available = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
      const { data: owner } = await client.auth.getUser();
      const worker = await navigator.serviceWorker?.getRegistration('/');
      worker?.active?.postMessage({ type: 'timehack-account', userId: owner.user?.id ?? '' });
      let deviceSubscribed = false;
      if (available && Notification.permission === 'granted') {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          const { data, error } = await client.rpc('timehack_push_subscription_active', { p_endpoint: subscription.endpoint });
          deviceSubscribed = !error && data === true;
        }
      }
      if (!active) return;
      setSupported(available);
      setPermission(available ? Notification.permission : 'unsupported');
      setSubscribed(deviceSubscribed);
    };
    const onVisible = () => { if (!document.hidden) void update(); };
    void update();
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [client]);

  async function enable() {
    setBusy(true); setMessage('');
    try {
      if (!publicKey) throw new Error('Push is not configured for this environment yet.');
      if (!supported) throw new Error('This browser does not support Web Push here.');
      const choice = await Notification.requestPermission();
      setPermission(choice);
      if (choice !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser or device settings.');
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      const ready = await navigator.serviceWorker.ready;
      const { data: owner } = await client.auth.getUser();
      if (!owner.user) throw new Error('Sign in before enabling notifications.');
      ready.active?.postMessage({ type: 'timehack-account', userId: owner.user.id });
      let subscription = await ready.pushManager.getSubscription() ?? await ready.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey),
      });
      const save = async () => {
        const value = subscription.toJSON();
        if (!value.keys?.p256dh || !value.keys.auth) throw new Error('The device did not provide push encryption keys.');
        return client.rpc('save_timehack_push_subscription', {
          p_endpoint: subscription.endpoint, p_p256dh: value.keys.p256dh,
          p_auth: value.keys.auth, p_label: navigator.platform.slice(0, 80),
        });
      };
      let { error } = await save();
      if (error?.code === '42501') {
        // The browser still holds a different account's endpoint. A fresh
        // subscription is created only after this account's explicit click.
        await subscription.unsubscribe();
        subscription = await ready.pushManager.subscribe({
          userVisibleOnly: true, applicationServerKey: applicationServerKey(publicKey),
        });
        ({ error } = await save());
      }
      if (error) throw new Error('The subscription could not be saved for this account.');
      setSubscribed(true); setMessage('Notifications enabled on this device.');
      void registration.update();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not enable notifications.'); }
    finally { setBusy(false); }
  }

  async function disable() {
    setBusy(true); setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const { error } = await client.rpc('disable_timehack_push_subscription', { p_endpoint: subscription.endpoint });
        if (error) throw new Error('Could not disable notifications for this account.');
        await subscription.unsubscribe();
      }
      setSubscribed(false); setMessage('Notifications disabled on this device.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Could not disable notifications.'); }
    finally { setBusy(false); }
  }

  async function testPush() {
    setBusy(true); setMessage('');
    try {
      const { data, error } = await client.functions.invoke('timehack-push', { body: { action: 'test' } });
      if (error) throw new Error('Test notification failed. Try again shortly.');
      setMessage(data?.sent ? `Test sent to ${data.sent} device${data.sent === 1 ? '' : 's'}.` : 'No active device accepted the test notification.');
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Test notification failed.'); }
    finally { setBusy(false); }
  }

  return <section className="panel p-5 sm:p-6" aria-labelledby="push-title">
    <p className="eyebrow">REMINDERS</p><h2 id="push-title" className="mt-1 text-xl font-bold sm:text-2xl">Device notifications</h2>
    <p className="mt-1 text-sm text-slate-400">Reminder schedules are saved with your account. Push delivery also needs permission on each device.</p>
    <p className="mt-2 text-xs text-slate-300">Status: {!supported ? 'Unsupported in this browser' : permission === 'denied' ? 'Blocked by browser settings' : subscribed ? 'Enabled on this device' : permission === 'granted' ? 'Permission granted; device not subscribed' : 'Permission not requested'}</p>
    {!supported && <p className="mt-2 text-xs text-amber-200">Web Push is unavailable in this browser or installation.</p>}
    <p className="mt-2 text-xs text-slate-400">iPhone/iPad: on iOS/iPadOS 16.4 or later, open TimeHack in Safari, tap Share → Add to Home Screen, open the installed app, then enable notifications there.</p>
    <div className="mt-3 flex flex-wrap gap-2">
      {supported && !subscribed && <button type="button" disabled={busy || !publicKey || permission === 'denied'} onClick={enable} className="rounded-xl bg-[#35c9f4] px-4 py-3 text-sm font-bold text-[#0d1117] disabled:opacity-50">Enable notifications</button>}
      {subscribed && <><button type="button" disabled={busy} onClick={disable} className="rounded-xl border border-white/15 px-4 py-3 text-sm disabled:opacity-50">Disable notifications</button><button type="button" disabled={busy} onClick={testPush} className="rounded-xl border border-cyan-300/25 bg-cyan-300/5 px-4 py-3 text-sm text-cyan-100 disabled:opacity-50">Send test notification</button></>}
    </div>
    {!publicKey && <p className="mt-2 text-xs text-amber-200">Push delivery is awaiting environment configuration.</p>}
    {message && <p role="status" className="mt-2 text-xs text-amber-100">{message}</p>}
  </section>;
}
