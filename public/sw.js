/* Push only: never cache authenticated pages, Supabase requests, or timer state. */
self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Ignore malformed payloads. */ }
  const habitId = typeof message.habitId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(message.habitId)
    ? message.habitId : '';
  const url = habitId ? '/#habit-' + encodeURIComponent(habitId) : '/';
  event.waitUntil(self.registration.showNotification('TimeHack reminder', {
    body: 'A habit is ready for your attention.',
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: typeof message.tag === 'string' ? message.tag : 'timehack-reminder',
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = event.notification.data?.url || '/';
  const destination = new URL(path, self.location.origin);
  if (destination.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin === self.location.origin) {
        await windowClient.focus();
        if ('navigate' in windowClient) await windowClient.navigate(destination.href);
        return;
      }
    }
    await self.clients.openWindow(destination.href);
  })());
});
