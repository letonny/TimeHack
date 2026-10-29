/* Push only: never cache authenticated pages, Supabase requests, or timer state. */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'timehack-account') return;
  const account = typeof event.data.userId === 'string' ? event.data.userId : '';
  event.waitUntil(new Promise((resolve, reject) => {
    const open = indexedDB.open('timehack-push-owner', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('owner');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const transaction = open.result.transaction('owner', 'readwrite');
      transaction.objectStore('owner').put(account, 'userId');
      transaction.oncomplete = () => { open.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }));
});

function currentAccount() {
  return new Promise((resolve) => {
    const open = indexedDB.open('timehack-push-owner', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('owner');
    open.onerror = () => resolve('');
    open.onsuccess = () => {
      const request = open.result.transaction('owner').objectStore('owner').get('userId');
      request.onsuccess = () => { open.result.close(); resolve(request.result || ''); };
      request.onerror = () => { open.result.close(); resolve(''); };
    };
  });
}

self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data?.json() ?? {}; } catch { /* Ignore malformed payloads. */ }
  const habitId = typeof message.habitId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(message.habitId)
    ? message.habitId : '';
  const url = habitId ? '/#habit-' + encodeURIComponent(habitId) : '/';
  event.waitUntil((async () => {
    if (!message.userId || await currentAccount() !== message.userId) return;
    await self.registration.showNotification('TimeHack reminder', {
      body: 'A habit is ready for your attention.',
      icon: '/icon-192.png', badge: '/icon-192.png',
      tag: typeof message.tag === 'string' ? message.tag : 'timehack-reminder',
      data: { url },
    });
  })());
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
