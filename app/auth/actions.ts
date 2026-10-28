'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { validateCredentials } from '@/lib/auth-validation';

export type AuthState = { error: string | null; success: string | null };

export async function login(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const validation = validateCredentials(email, password);
  if (validation) return { error: validation, success: null };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message, success: null };
  redirect('/');
}

export async function signup(_state: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const validation = validateCredentials(email, password, true);
  if (validation) return { error: validation, success: null };
  if (password !== String(formData.get('confirmPassword') ?? '')) return { error: 'Passwords do not match.', success: null };
  const origin = (await headers()).get('origin');
  if (!origin) return { error: 'Could not determine this site’s address. Please try again.', success: null };
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${origin}/auth/callback` } });
  if (error) return { error: error.message, success: null };
  if (data.session) redirect('/');
  return { error: null, success: 'Check your email for a confirmation link, then sign in.' };
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
