import { Dashboard } from '@/components/dashboard';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { Suspense } from 'react';

async function AuthenticatedDashboard() {
    await connection();
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims) redirect('/login');
    return <Dashboard />;
}

export default function Home() {
    return <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-sm text-slate-400">Loading your dashboard…</main>}><AuthenticatedDashboard /></Suspense>;
}
