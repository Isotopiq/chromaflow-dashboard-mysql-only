import { useState, useEffect, useRef } from "react";

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function cn(...classes: (string | false | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}

// ─── Icons ────────────────────────────────────────────────────────────────────
export const Icons = {
  dashboard: <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="6" height="6" rx="0.5"/><rect x="9" y="1" width="6" height="6" rx="0.5"/><rect x="1" y="9" width="6" height="6" rx="0.5"/><rect x="9" y="9" width="6" height="6" rx="0.5"/></svg>,
  queue:     <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h9M2 12h6" strokeLinecap="round"/></svg>,
  folders:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1 4.5A1.5 1.5 0 012.5 3h3l1.5 2H13.5A1.5 1.5 0 0115 6.5v6A1.5 1.5 0 0113.5 14h-11A1.5 1.5 0 011 12.5v-8z"/></svg>,
  history:   <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M8 5v3.5L10.5 10" strokeLinecap="round"/></svg>,
  settings:  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M3.22 12.78l1.42-1.42M11.36 4.64l1.42-1.42" strokeLinecap="round"/></svg>,
  tray:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="14" height="14" rx="1"/><path d="M1 10h3l2 3h4l2-3h3"/></svg>,
  bell:      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1.5A4.5 4.5 0 003.5 6v3.5L2 11h12l-1.5-1.5V6A4.5 4.5 0 008 1.5zM6.5 13a1.5 1.5 0 003 0"/></svg>,
  eye:       <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 8S4 3 8 3s6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>,
  check:     <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M5.5 8l2 2 3-3" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  xCircle:   <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4" strokeLinecap="round"/></svg>,
  layers:    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 1L1 5l7 4 7-4-7-4zM1 11l7 4 7-4M1 8l7 4 7-4" strokeLinejoin="round"/></svg>,
  trash:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 4h10M5 4V2h6v2M4 4l1 10h6l1-10" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  cancel:    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M6 6l4 4M10 6l-4 4" strokeLinecap="round"/></svg>,
  retry:     <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2.5 8A5.5 5.5 0 108 2.5V1L5 3.5 8 6V4.5A3.5 3.5 0 114.5 8" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  copy:      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v7a1 1 0 001 1h2"/></svg>,
  folder:    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#2563EB" strokeWidth="1.5"><path d="M1 4.5A1.5 1.5 0 012.5 3h3l1.5 2H13.5A1.5 1.5 0 0115 6.5v6A1.5 1.5 0 0113.5 14h-11A1.5 1.5 0 011 12.5v-8z"/></svg>,
  chevronDown: <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  chevronUp:   <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10l4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>,
  search:    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4"/><path d="M9.5 9.5L13 13" strokeLinecap="round"/></svg>,
  // Windows title bar icons (very thin)
  winMin:    <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>,
  winMax:    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>,
  winRestore:<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2.5" y="0.5" width="7" height="7" stroke="currentColor"/><path d="M0.5 3v6.5H7" stroke="currentColor"/></svg>,
  winClose:  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M0.5 0.5l9 9M9.5 0.5l-9 9" stroke="currentColor" strokeLinecap="round"/></svg>,
};

// ─── Status badge ─────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    uploading: { label: "Uploading", cls: "bg-[#EBF1FE] text-[#2563EB] border border-[#BFCFFB]" },
    parsing:   { label: "Parsing",   cls: "bg-[#EBF1FE] text-[#2563EB] border border-[#BFCFFB]" },
    queued:    { label: "Queued",    cls: "bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]" },
    pending:   { label: "Needs metadata", cls: "bg-[#FFFBEB] text-[#B45309] border border-[#FDE68A]" },
    done:      { label: "Done",      cls: "bg-[#ECFDF3] text-[#15803D] border border-[#BBF7D0]" },
    failed:    { label: "Failed",    cls: "bg-[#FEF2F2] text-[#DC2626] border border-[#FECACA]" },
    cancelled: { label: "Cancelled", cls: "bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB]" },
    success:   { label: "Success",   cls: "bg-[#ECFDF3] text-[#15803D] border border-[#BBF7D0]" },
  };
  const s = map[status] ?? map.queued;
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-sm text-[10px] font-semibold tracking-wide", s.cls)}>
      {s.label}
    </span>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ value, status }: { value: number; status: string }) {
  const color = status === "done" ? "bg-[#16A34A]" : status === "failed" ? "bg-[#DC2626]" : "bg-[#2563EB]";
  return (
    <div className="w-full h-1.5 bg-[#E5E7EB] overflow-hidden rounded-sm">
      {status === "parsing" ? (
        <div className="h-full w-1/3 bg-[#2563EB] rounded-sm animate-pulse" />
      ) : (
        <div className={cn("h-full transition-all", color)} style={{ width: `${value}%` }} />
      )}
    </div>
  );
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
      className={cn(
        "relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full border-2 transition-colors duration-150",
        checked ? "bg-[#2563EB] border-[#2563EB]" : "bg-white border-[#D1D5DB]"
      )}
    >
      <span className={cn(
        "inline-block h-[12px] w-[12px] rounded-full bg-white shadow transition-transform duration-150 absolute top-[1px]",
        checked ? "translate-x-[13px]" : "translate-x-[1px]"
      )} style={{ boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />
    </button>
  );
}

// ─── Section divider ──────────────────────────────────────────────────────────
export function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mt-5 mb-4">
      <span className="text-[10px] font-semibold tracking-widest text-[#6B7280] uppercase">{label}</span>
      <div className="flex-1 h-px bg-[#E5E7EB]" />
    </div>
  );
}

// ─── Windows-style dropdown menu ──────────────────────────────────────────────
export interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
}

export function MenuDropdown({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "px-3 h-full text-[12px] transition-colors",
          open ? "bg-[#2563EB] text-white" : "text-[#374151] hover:bg-[#E5E7EB]"
        )}
      >
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 min-w-[160px] bg-white border border-[#D1D5DB] shadow-lg py-1" style={{ borderRadius: 0 }}>
          {items.map((item, i) =>
            item.separator ? (
              <div key={`sep-${i}`} className="my-1 h-px bg-[#E5E7EB] mx-2" />
            ) : (
              <button
                key={i}
                disabled={item.disabled}
                className={cn(
                  "w-full text-left px-4 py-1 text-[12px] transition-colors",
                  item.disabled
                    ? "text-[#9CA3AF] cursor-not-allowed"
                    : "text-[#1F2937] hover:bg-[#EBF1FE] hover:text-[#1D4ED8]"
                )}
                onClick={() => {
                  setOpen(false);
                  item.action?.();
                }}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}

// ─── SVG bar chart ────────────────────────────────────────────────────────────
export function HourlyBarChart({ data }: { data: { h: string; v: number }[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; value: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const W = 700;
  const H = 110;
  const paddingLeft = 28;
  const paddingBottom = 18;
  const paddingTop = 6;
  const chartW = W - paddingLeft;
  const chartH = H - paddingBottom - paddingTop;
  const maxVal = Math.max(...data.map((d) => d.v), 1);

  const barW = chartW / data.length;
  const gap = barW * 0.3;
  const bw = barW - gap;

  const yTicks = [0, Math.ceil(maxVal / 2), maxVal];

  return (
    <div className="relative w-full" style={{ height: 128 }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        onMouseLeave={() => setTooltip(null)}
      >
        {yTicks.map((t) => {
          const y = paddingTop + chartH - (t / maxVal) * chartH;
          return (
            <g key={t}>
              <line x1={paddingLeft} x2={W} y1={y} y2={y} stroke="#F3F4F6" strokeWidth="1" />
              <text x={paddingLeft - 4} y={y + 3} textAnchor="end" fontSize="8" fill="#9CA3AF">{t}</text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const x = paddingLeft + i * barW + gap / 2;
          const barH = Math.max((d.v / maxVal) * chartH, d.v > 0 ? 2 : 0);
          const y = paddingTop + chartH - barH;
          const isActive = tooltip?.label === d.h;
          return (
            <g key={i}
              onMouseEnter={() => {
                const svg = svgRef.current;
                if (!svg) return;
                const rect = svg.getBoundingClientRect();
                const scaleX = rect.width / W;
                const scaleY = rect.height / H;
                setTooltip({
                  x: (x + bw / 2) * scaleX,
                  y: y * scaleY,
                  label: d.h,
                  value: d.v,
                });
              }}
            >
              <rect x={x} y={paddingTop} width={bw} height={chartH} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={bw}
                height={barH}
                fill={d.v > 0 ? (isActive ? "#1D4ED8" : "#2563EB") : "#F3F4F6"}
                rx="1"
              />
            </g>
          );
        })}

        {data.map((d, i) => {
          if (i % 4 !== 0) return null;
          const x = paddingLeft + i * barW + barW / 2;
          return (
            <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="8" fill="#9CA3AF">{d.h}</text>
          );
        })}
      </svg>

      {tooltip && (
        <div
          className="absolute pointer-events-none bg-white border border-[#E5E7EB] text-[11px] text-[#111827] px-2 py-1 shadow-md whitespace-nowrap"
          style={{ left: tooltip.x, top: Math.max(0, tooltip.y - 32), transform: "translateX(-50%)", borderRadius: 2 }}
        >
          <span className="font-semibold">{tooltip.value}</span>
          <span className="text-[#9CA3AF] ml-1">uploads at {tooltip.label}</span>
        </div>
      )}
    </div>
  );
}
