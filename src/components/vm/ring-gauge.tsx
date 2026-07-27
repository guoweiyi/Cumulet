"use client";

/** Small SVG ring gauge (0..1). */
export function RingGauge({
  value,
  label,
  sublabel,
  color = "#2563eb",
}: {
  value: number;
  label: string;
  sublabel?: string;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={r} fill="none" stroke="#f1f1f1" strokeWidth="9" />
        <circle
          cx="48"
          cy="48"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="9"
          strokeLinecap="round"
          strokeDasharray={`${clamped * c} ${c}`}
          transform="rotate(-90 48 48)"
          className="transition-all duration-700"
        />
        <text x="48" y="52" textAnchor="middle" className="fill-neutral-800 text-[15px] font-semibold">
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {sublabel && <span className="text-[10px] text-neutral-400">{sublabel}</span>}
    </div>
  );
}
