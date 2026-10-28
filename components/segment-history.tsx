import { formatDurationMilliseconds, sessionIntervals, type Session } from '@/lib/timer';
export function SegmentHistory({ session, now }: { session: Session; now: number }) {
    const intervals = sessionIntervals(session, now);
    let study = 0, breaks = 0;
    return <details className="mt-5 w-full border-t border-white/8 pt-4 text-sm text-slate-400"><summary className="cursor-pointer">SET interval breakdown ({intervals.length})</summary><ol className="mt-3 space-y-2">{intervals.map((interval, index) => {
        const number = interval.kind === 'study' ? ++study : ++breaks;
        return <li key={index} className="flex flex-wrap justify-between gap-2 rounded-lg bg-white/[.025] px-3 py-2"><span>{interval.kind === 'break' ? 'Break' : 'Study'} #{number}{interval.endedAt === null ? ' · running' : ''}{interval.segmentCount > 1 ? ' · paused time excluded' : ''}</span><span className="text-xs text-slate-500">{new Date(interval.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })} – {interval.endedAt === null ? 'now' : new Date(interval.endedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span><span className="font-mono text-xs text-slate-300">{formatDurationMilliseconds(interval.milliseconds)}</span></li>;
    })}</ol></details>;
}
