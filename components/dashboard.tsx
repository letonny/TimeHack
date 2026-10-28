'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useTimer } from '@/hooks/use-timer';
import { duration, formatDuration, isRunning, todaySummary } from '@/lib/timer';
import { HabitTracker } from './habit-tracker';
import { SegmentHistory } from './segment-history';
import { StatCard } from './stat-card';
import { ActivityHistory } from './activity-history';
import { logout } from '@/app/auth/actions';
import { useFormStatus } from 'react-dom';
function SignOutButton() {
    const { pending } = useFormStatus();
    return <button type="submit" disabled={pending} className="rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/10">{pending ? 'Signing out…' : 'Sign out'}</button>;
}
export function Dashboard() {
    const timer = useTimer();
    const [name, setName] = useState('');
    const active = timer.state.active;
    const onBreak = active?.segments.at(-1)?.kind === 'break';
    const running = active ? isRunning(active) : false;
    const summary = timer.now === null ? null : todaySummary(timer.state, timer.now);
    return <div className="min-h-screen"><header className="border-b border-white/8"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-5 sm:px-8"><Link href="/" className="flex items-center gap-3 text-xl font-bold tracking-tight"><span aria-hidden="true" className="flex size-9 items-center justify-center rounded-xl bg-teal-300 text-lg text-[#0b1424]">↗</span>TimeHack<span className="sr-only"> home</span></Link><div className="flex items-center gap-4"><span className="hidden text-xs text-slate-400 sm:inline">Your time, intentionally.</span><form action={logout}><SignOutButton /></form></div></div></header>
    <main className="mx-auto max-w-6xl px-5 py-9 sm:px-8 sm:py-12"><div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="eyebrow">MAKE ROOM FOR WHAT MATTERS</p><h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">A little more focused.</h1><p className="mt-3 text-sm text-slate-400 sm:text-base">One activity at a time. Make today count.</p></div><p className="text-sm text-slate-400">{timer.now !== null ? new Date(timer.now).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : 'Getting your day ready…'}</p></div>
    {timer.error && <p role="alert" className="mb-6 rounded-xl border border-amber-300/30 bg-amber-300/10 p-4 text-sm text-amber-100">{timer.error}</p>}
    <section aria-labelledby="today-title"><h2 id="today-title" className="mb-4 text-sm font-medium text-slate-300">Today overview</h2><div className="grid gap-4 sm:grid-cols-2"><StatCard label="Total tracked time" value={summary ? formatDuration(summary.milliseconds) : '—'} note="Productive time today · breaks and pauses excluded"/><StatCard label="Completed sessions" value={summary ? String(summary.count).padStart(2, '0') : '—'} note="Sessions finished today"/></div></section>
    <section aria-labelledby="timer-title" className="panel relative mt-8 overflow-hidden"><div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-teal-400/5 blur-3xl"/><div className="relative p-6 sm:p-8"><div className="flex items-center justify-between gap-4"><h2 id="timer-title" className="text-lg font-semibold">Focus timer</h2><span role="status" className="rounded-full bg-teal-300/10 px-3 py-1 text-xs text-teal-200">{!timer.ready ? 'Loading' : active ? running ? onBreak ? '● On break' : '● Studying' : 'Ⅱ Paused' : 'Ready when you are'}</span></div>
    <form onSubmit={event => { event.preventDefault(); timer.start(name); }} className="mt-7"><label htmlFor="activity" className="text-sm text-slate-300">What are you working on?</label><input id="activity" value={active?.name ?? name} onChange={event => setName(event.target.value)} disabled={!!active || !timer.ready} maxLength={120} autoComplete="off" placeholder="e.g. Reading, deep work, a new idea…" className="mt-3 w-full rounded-xl border border-white/10 bg-[#0b1424] px-4 py-3.5 text-base text-white placeholder:text-slate-500 disabled:opacity-70"/>
    <div className="py-10 text-center sm:py-12"><p className="font-mono text-[clamp(2.8rem,10vw,5.5rem)] leading-none font-medium tracking-tight tabular-nums text-white" aria-label="Productive study time">{formatDuration(active && timer.now !== null ? duration(active, timer.now) : 0)}</p><p className="mt-4 text-sm text-slate-400">{active ? running ? onBreak ? 'On break. Press SET to resume studying.' : 'Stay with it. Press SET to start a break.' : 'Take a breath. Resume when you’re ready.' : 'Give your next activity a little space.'}</p></div>
    <div className="mx-auto flex max-w-md flex-wrap gap-3">{!active ? <button type="submit" disabled={!timer.ready || !name.trim()} className="primary flex-1">▶ <span className="ml-2">Start session</span></button> : <><button type="button" disabled={!timer.ready || !running} onClick={timer.set} className="primary flex-1" aria-label={onBreak ? "SET: resume studying" : "SET: start break"}>SET<span className="mt-1 block text-xs">{onBreak ? 'Study' : 'Break'}</span></button><button type="button" disabled={!timer.ready} onClick={running ? timer.pause : timer.resume} className="primary flex-1">{running ? 'Ⅱ Pause' : '▶ Resume'}</button><button type="button" disabled={!timer.ready} onClick={timer.stop} className="flex-1 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold hover:bg-white/10">■ Finish</button></>}</div></form>
    <p className="mt-6 text-center text-xs leading-relaxed text-slate-500">Saved on this device. Your timer stays with you when you refresh.</p></div></section>
    {active && timer.now !== null && <div className="panel mt-4 p-6"><SegmentHistory session={active} now={timer.now}/></div>}
    <HabitTracker state={timer.state} now={timer.now} ready={timer.ready} onSave={timer.saveHabit} onDelete={timer.deleteHabit} onTrack={timer.start}/>
    <ActivityHistory sessions={timer.state.completed} onDelete={timer.remove}/>
    <footer className="mt-8 flex flex-wrap justify-between gap-3 text-xs leading-relaxed text-slate-500"><p>Small steps. Meaningful progress.</p><p>Habits and sessions are saved on this device.</p></footer>
    </main></div>;
}
