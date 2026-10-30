export function HomeSummaryDial({ label, value, progress, color, caption }: {
  label: string; value: string; progress?: number; color: string; caption?: string;
}) {
  const normalized = progress === undefined ? 0 : Math.max(0, Math.min(1, progress));
  return <div className="home-summary-dial min-w-0 rounded-[1.6rem] px-1 py-4 text-center sm:px-4 sm:py-6" aria-label={`${label}: ${value}`}>
    <div className="relative mx-auto size-[clamp(5.4rem,12vw,10rem)] rounded-full" style={{ background: `radial-gradient(circle, color-mix(in srgb, ${color} 10%, transparent), transparent 73%)` }}>
      <svg viewBox="0 0 100 100" className="size-full" aria-hidden="true"><circle cx="50" cy="50" r="41" fill="none" stroke={`color-mix(in srgb, ${color} 21%, #343a3f)`} strokeWidth="6"/>{normalized > 0 && <circle cx="50" cy="50" r="41" fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${normalized * 257.61} 257.61`} transform="rotate(-90 50 50)"/>}</svg>
      <span className="absolute inset-0 flex items-center justify-center text-[clamp(1rem,3vw,2.2rem)] font-bold tracking-tight tabular-nums text-white">{value}</span>
    </div>
    <p className="mt-3 text-[10px] font-bold tracking-[.12em] text-[#dce6e8] uppercase sm:text-sm">{label}</p>
    {caption && <p className="mt-1 text-[10px] text-[#9aabb0] sm:text-xs">{caption}</p>}
  </div>;
}
