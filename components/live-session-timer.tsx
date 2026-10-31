'use client';

import { useEffect, useState } from 'react';
import { activeSet, formatDurationMilliseconds, isRunning, sessionIntervals, setDuration, summarizeSession, type Session } from '@/lib/timer';

export function ReadyTimerDial() {
  return <div className="relative mx-auto mt-7 size-[min(75vw,300px)]"><svg viewBox="0 0 100 100" className="size-full" aria-hidden="true"><circle cx="50" cy="50" r="43" fill="none" stroke="#344650" strokeWidth="5"/></svg><div className="absolute inset-0 flex flex-col items-center justify-center text-center"><span className="text-xs font-bold tracking-[.15em] text-[#8db6c2] uppercase">Ready to start</span><span className="mt-3 text-4xl font-bold tabular-nums text-white">00:00:00</span><span className="mt-2 text-xs text-[#9ba8b8]">Choose your activity below</span></div></div>;
}

function MillisecondTime({ milliseconds }: { milliseconds: number }) {
  const formatted = formatDurationMilliseconds(milliseconds);
  const [whole, fraction] = formatted.split('.');
  return <span className="font-mono tabular-nums"><span>{whole}</span><span className="text-[.52em] text-teal-300">.{fraction}</span></span>;
}

export function LiveSessionTimer({ session, initialNow }: { session: Session; initialNow: number }) {
  const running = isRunning(session);
  const [now, setNow] = useState(initialNow);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let lastPaint = 0;
    const paint = (time: number) => {
      if (time - lastPaint >= 30) {
        lastPaint = time;
        setNow(Date.now());
      }
      frame = window.requestAnimationFrame(paint);
    };
    frame = window.requestAnimationFrame(paint);
    const visible = () => { if (!document.hidden) setNow(Date.now()); };
    document.addEventListener('visibilitychange', visible);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visible); };
  }, [running, session.id, session.segments.length]);

  const summary = summarizeSession(session, now);
  const current = sessionIntervals(session, now).at(-1)!;
  const mode = current.kind === 'break' ? 'Legacy break' : current.kind === 'travel_out' ? `Travel to ${session.destination || 'destination'}` : current.kind === 'travel_return' ? `Return trip${session.returnDestination ? ` to ${session.returnDestination}` : ''}` : session.name;
  const currentSet = activeSet(session);
  const circumference = 2 * Math.PI * 43;
  const currentHour = summary.studyMilliseconds % 3_600_000;
  return <div className="py-5 text-center sm:py-7">
    <p className={`mx-auto inline-flex rounded-full px-3 py-1 text-xs font-semibold ${current.kind === 'break' ? 'bg-amber-300/10 text-amber-200' : 'bg-emerald-300/10 text-emerald-200'}`}>{running ? '●' : 'Ⅱ'} {running ? mode : `${mode} paused`}</p>
    <div className="relative mx-auto mt-4 size-[min(75vw,300px)]"><svg viewBox="0 0 100 100" className="size-full" aria-hidden="true"><defs><linearGradient id="timer-dial-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#35c9f4"/><stop offset="1" stopColor="#42d9a2"/></linearGradient></defs><circle cx="50" cy="50" r="43" fill="none" stroke="#344650" strokeWidth="5"/>{currentHour > 0 && <circle cx="50" cy="50" r="43" fill="none" stroke="url(#timer-dial-gradient)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${currentHour / 3_600_000 * circumference} ${circumference}`} transform="rotate(-90 50 50)"/>}</svg><div className="absolute inset-0 flex flex-col items-center justify-center"><span className="text-[10px] font-bold tracking-[.14em] text-[#9ec8d0] uppercase">Productive time</span><p className="mt-2 text-[clamp(1.65rem,4vw,3rem)] font-bold tracking-tight text-white" aria-label={`${session.name} total ${formatDurationMilliseconds(summary.studyMilliseconds)}`}><MillisecondTime milliseconds={summary.studyMilliseconds}/></p><span className="mt-2 text-[10px] text-[#9ba8b8]">Arc shows minutes in current hour</span></div></div>
    <div className="mx-auto mt-5 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
      <div className="min-w-0 rounded-xl border border-white/8 bg-white/[.035] p-2 sm:p-3"><p className="text-[10px] text-slate-400 uppercase">Productive</p><p className="mt-1 truncate font-mono text-[11px] text-emerald-200 sm:text-sm" title={formatDurationMilliseconds(summary.studyMilliseconds)}>{formatDurationMilliseconds(summary.studyMilliseconds)}</p></div>
      <div className="min-w-0 rounded-xl border border-white/8 bg-white/[.035] p-2 sm:p-3"><p className="text-[10px] text-slate-400 uppercase">Breaks</p><p className="mt-1 truncate font-mono text-[11px] text-amber-200 sm:text-sm" title={formatDurationMilliseconds(summary.breakMilliseconds)}>{formatDurationMilliseconds(summary.breakMilliseconds)}</p></div>
      <div className="min-w-0 rounded-xl border border-white/8 bg-white/[.035] p-2 sm:p-3"><p className="text-[10px] text-slate-400 uppercase">Tracked</p><p className="mt-1 truncate font-mono text-[11px] text-white sm:text-sm" title={formatDurationMilliseconds(summary.trackedMilliseconds)}>{formatDurationMilliseconds(summary.trackedMilliseconds)}</p></div>
    </div>
    {session.tripPhase && <div className="mx-auto mt-3 grid max-w-2xl grid-cols-2 gap-2 text-xs"><div className="rounded-xl border border-white/8 bg-white/[.035] p-3"><p className="text-slate-400">Travel time</p><p className="mt-1 font-mono text-sky-200">{formatDurationMilliseconds(summary.travelMilliseconds)}</p></div><div className="rounded-xl border border-white/8 bg-white/[.035] p-3"><p className="text-slate-400">Full commitment</p><p className="mt-1 font-mono text-white">{formatDurationMilliseconds(summary.commitmentMilliseconds)}</p></div></div>}
    {currentSet && <div className="mx-auto mt-5 max-w-md rounded-2xl border border-cyan-300/25 bg-cyan-300/5 p-4"><p className="text-sm font-semibold text-cyan-200">SET · {currentSet.description}</p><p className="mt-2 text-2xl text-white"><MillisecondTime milliseconds={setDuration(currentSet, now)}/></p><p className="mt-1 text-xs text-[#9ba8b8]">Runs inside the main activity</p></div>}
  </div>;
}
