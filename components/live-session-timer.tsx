'use client';

import { useEffect, useState } from 'react';
import { activeSet, formatDurationMilliseconds, isRunning, sessionIntervals, setDuration, summarizeSession, type Session } from '@/lib/timer';

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
  const mode = current.kind === 'break' ? 'Legacy break' : session.name;
  const currentSet = activeSet(session);
  return <div className="py-8 text-center sm:py-10">
    <p className={`mx-auto inline-flex rounded-full px-3 py-1 text-xs font-semibold ${current.kind === 'break' ? 'bg-amber-300/10 text-amber-200' : 'bg-teal-300/10 text-teal-200'}`}>{running ? '●' : 'Ⅱ'} {running ? mode : `${mode} paused`}</p>
    <p className="mt-5 text-xs font-medium tracking-[.16em] text-slate-400 uppercase">{session.name} · total activity</p>
    <p className="mt-3 text-[clamp(2.5rem,10vw,5.4rem)] leading-none font-medium tracking-tight text-white" aria-label={`${session.name} total ${formatDurationMilliseconds(summary.studyMilliseconds)}`}><MillisecondTime milliseconds={summary.studyMilliseconds}/></p>
    {currentSet && <div className="mx-auto mt-6 max-w-md rounded-2xl border border-teal-300/25 bg-teal-300/5 p-4"><p className="text-sm font-medium text-teal-200">SET · {currentSet.description}</p><p className="mt-2 text-3xl text-white"><MillisecondTime milliseconds={setDuration(currentSet, now)}/></p></div>}
    <div className="mx-auto mt-7 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
      <div className="rounded-xl bg-white/[.035] p-3"><p className="text-[10px] text-slate-500 uppercase sm:text-xs">Activity</p><p className="mt-1 font-mono text-xs text-teal-200 sm:text-base">{formatDurationMilliseconds(summary.studyMilliseconds)}</p></div>
      <div className="rounded-xl bg-white/[.035] p-3"><p className="text-[10px] text-slate-500 uppercase sm:text-xs">Legacy breaks</p><p className="mt-1 font-mono text-xs text-amber-200 sm:text-base">{formatDurationMilliseconds(summary.breakMilliseconds)}</p></div>
      <div className="rounded-xl bg-white/[.035] p-3"><p className="text-[10px] text-slate-500 uppercase sm:text-xs">Tracked</p><p className="mt-1 font-mono text-xs text-white sm:text-base">{formatDurationMilliseconds(summary.trackedMilliseconds)}</p></div>
    </div>
  </div>;
}
