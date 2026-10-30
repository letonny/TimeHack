'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { login, signup, type AuthState } from '@/app/auth/actions';

const initialAuthState: AuthState = { error: null, success: null };

export function AuthForm({ mode }: { mode: 'login' | 'signup' }) {
  const [state, action, pending] = useActionState(mode === 'login' ? login : signup, initialAuthState);
  const params = useSearchParams();
  const isSignup = mode === 'signup';
  return <main className="flex min-h-screen items-center justify-center px-5 py-12">
    <div className="w-full max-w-md">
      <Link href="/login" className="mb-10 flex items-center justify-center gap-3 text-2xl font-bold tracking-tight"><span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-teal-300 text-[#0b1424]">↗</span>TimeHack</Link>
      <div className="panel p-7 sm:p-9">
        <p className="eyebrow">MAKE TIME MATTER</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="mt-2 text-sm text-slate-400">{isSignup ? 'Start making room for what matters.' : 'Sign in to get back to your day.'}</p>
        {params.get('error') && <p role="alert" className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{params.get('error')}</p>}
        {state.error && <p role="alert" className="mt-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-3 text-sm text-amber-100">{state.error}</p>}
        {state.success && <p role="status" className="mt-6 rounded-xl border border-teal-300/30 bg-teal-300/10 p-3 text-sm text-teal-100">{state.success}</p>}
        <form action={action} className="mt-7 space-y-5">
          <div><label htmlFor="email" className="block text-sm text-slate-300">Email</label><input id="email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="mt-2 w-full rounded-xl border border-white/10 bg-[var(--background)] px-4 py-3 text-white placeholder:text-slate-500" /></div>
          <div><label htmlFor="password" className="block text-sm text-slate-300">Password</label><input id="password" name="password" type="password" required minLength={isSignup ? 6 : undefined} autoComplete={isSignup ? 'new-password' : 'current-password'} className="mt-2 w-full rounded-xl border border-white/10 bg-[var(--background)] px-4 py-3 text-white" /></div>
          {isSignup && <div><label htmlFor="confirmPassword" className="block text-sm text-slate-300">Confirm password</label><input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className="mt-2 w-full rounded-xl border border-white/10 bg-[var(--background)] px-4 py-3 text-white" /></div>}
          <button type="submit" disabled={pending} className="primary w-full">{pending ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}</button>
        </form>
        <p className="mt-7 text-center text-sm text-slate-400">{isSignup ? 'Already have an account?' : 'New to TimeHack?'} <Link href={isSignup ? '/login' : '/signup'} className="font-medium text-teal-300 hover:text-teal-200">{isSignup ? 'Sign in' : 'Create an account'}</Link></p>
      </div>
      <p className="mt-6 text-center text-xs text-slate-500">Habits and sessions sync with your account.</p>
    </div>
  </main>;
}
