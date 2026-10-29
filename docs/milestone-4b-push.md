# Milestone 4B push setup

The 4B migration has been applied to hosted Supabase. Do not run it again. Push delivery remains off until the Edge Function and Cron are deployed and activated. The browser never receives the VAPID private key or Supabase service role key. This change does not alter the existing sync queue or 4A reminder rows.

## Keys and deployment

1. Generate one VAPID key pair in a trusted terminal: `npx web-push generate-vapid-keys --json`. Save both values in a password manager; do not commit them. The public key goes in Vercel and `.env.local` as `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a `mailto:` contact) as Supabase Edge Function secrets. The same pair must remain stable; rotating it requires devices to subscribe again.
2. Generate a long random `TIMEHACK_WORKER_SECRET` with a password manager or `openssl rand -base64 48`. Set it as a Supabase Edge Function secret. Store the same value in Supabase Vault as `timehack_worker_secret`. Do not put it in browser or Vercel public variables.
3. Confirm the already-applied migration `20261029010000_milestone_4b_push.sql` is listed in remote migration history. Do not reapply or edit it.
4. Deploy with `npx supabase functions deploy timehack-push --no-verify-jwt`. `supabase/config.toml` also records this mode. Gateway JWT verification must be off because the Cron request has a private worker secret rather than a user JWT. The function verifies that secret on scheduled calls, or calls Supabase Auth `getUser` with the bearer JWT on user test calls. Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` into Edge Functions; confirm they are available in your project. Keep the service role key out of Vercel and browser bundles.
5. Redeploy the website after setting `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in Vercel Production. Next.js embeds public environment variables at build time; changing the setting alone does not update an existing iPhone installation's JavaScript. Reopen the installed PWA after the new website deployment, then use the rate-limited “Send test notification” button before enabling Cron.

The Edge Function uses the maintained `web-push` package for RFC 8291 encryption and VAPID. Supported push services are Apple, Firebase, Mozilla, and Windows Notification Service HTTPS endpoints. Unknown endpoint hosts are rejected to prevent server-side requests to arbitrary hosts.

## Schedule only after a real device test

Enable `pg_cron` and `pg_net` in Supabase, then store the project URL and worker secret in Vault. Execute the following in the SQL editor after replacing placeholders. Vault values are never stored in repository SQL:

```sql
select vault.create_secret('https://YOUR-PROJECT.supabase.co', 'timehack_project_url');
select vault.create_secret('YOUR-LONG-WORKER-SECRET', 'timehack_worker_secret');

select cron.schedule('timehack-habit-push-every-minute', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'timehack_project_url') || '/functions/v1/timehack-push',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-timehack-worker-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'timehack_worker_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
$$);
```

To pause delivery, run `select cron.unschedule('timehack-habit-push-every-minute');`. Review Cron run history and Edge Function logs after activation. The worker processes at most 5,000 enabled reminder candidates per run and up to 20 active devices per account; expand with cursor batching if usage reaches these limits.

## Delivery behavior

Cron calls the worker every minute. A reminder is eligible during the 15 minutes after its resolved scheduled instant. The shared 4A resolver chooses the first occurrence of a repeated wall time and the first valid minute after a DST gap. The 4A candidate view excludes disabled/deleted reminders and soft-deleted habits. A service-only SQL function checks completed study intervals and duration entries for the habit's local day before suppression.

`push_deliveries` has one row per device, habit, local date, and kind. An atomic claim prevents simultaneous sends from overlapping workers. A failed or timed-out claim can be retried after two minutes, up to three attempts. A network timeout may mean the push service accepted a notification that the worker could not confirm, so a retry can duplicate a notification. A `404` or `410` response expires that device subscription. There is no promise of exact-once external delivery. Test pushes are limited to one request per account per minute and do not reveal subscription credentials. The service worker compares each push's account ID with the account last signed into the PWA and suppresses messages for another account.

## Local and iPhone checks

For localhost, add the public key to `.env.local`, start `npm run dev`, sign in, enable notifications, and press “Send test notification.” Localhost supports service workers on compatible desktop browsers. Confirm the Network tab shows successful `save_timehack_push_subscription` and `timehack-push` calls; do not share Authorization headers or endpoint/key values. Check that a clicked push focuses TimeHack and reaches the habit card. Refresh and verify the device still shows enabled. Disable and confirm it stops receiving tests.

On iPhone or iPad running iOS/iPadOS 16.4 or later, use a deployed HTTPS origin in Safari. Choose Share → Add to Home Screen, launch the installed TimeHack icon, sign in, and tap Enable notifications there. Confirm the OS prompt, send a test push, close the app, and confirm receipt and click navigation. Then create a short-term reminder for the local time zone and verify closed-app delivery. Repeat on another device for the same account. Check existing habits, sessions, reminder settings, and cloud sync after refresh. Do not clear local browser data during this test.

Supabase Cron, Edge Function invocations, database storage, and push-provider traffic can incur usage or plan limits. Vercel Hobby Cron is not used. Production delivery is unverified until an installed, subscribed device receives a scheduled reminder while TimeHack is closed.
