import type { GoalProgress } from '@/lib/analytics';

export function ProgressRing({ progress, label, size = 112, color = '#5eead4' }: { progress: GoalProgress; label: string; size?: number; color?: string }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress.visualPercentage / 100);
  const actual = Math.round(progress.percentage);
  return <div className="relative shrink-0" style={{ width: size, height: size }}>
    <svg viewBox="0 0 100 100" className="-rotate-90" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.visualPercentage)} aria-valuetext={`${progress.minutes.toFixed(1)} of ${progress.goalMinutes} minutes, ${actual}%`}>
      <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="8" className="text-[#0b1424]" />
      <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} className="transition-[stroke-dashoffset] duration-300" />
    </svg>
    <div aria-hidden="true" className="absolute inset-0 flex flex-col items-center justify-center">
      <span className="text-xl font-semibold text-white">{actual}%</span>
      <span className="text-[10px] text-slate-400">today</span>
    </div>
  </div>;
}
