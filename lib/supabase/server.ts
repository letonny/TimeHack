import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseConfig } from './config';

export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabaseConfig();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(items) {
        try {
          items.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies. Proxy refreshes the session.
        }
      },
    },
  });
}
