import { ChevronDown, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../utils/cn";

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />;
}

export function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  icon,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: ReactNode;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className="group flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 transition-colors hover:bg-white/[0.035]"
    >
      {icon && <span className="text-brass-500/80 transition-colors group-hover:text-brass-300">{icon}</span>}
      <div className="min-w-0 flex-1">
        <div className={cn("text-[12.5px] font-medium leading-snug transition-colors", checked ? "text-bone-100" : "text-bone-300")}>{label}</div>
        {hint && <div className="mt-0.5 text-[11px] leading-snug text-bone-500">{hint}</div>}
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <Switch checked={checked} onChange={onChange} label={label} />
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("seg", className)} role="group">
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
  className,
  icon,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("relative inline-flex items-center", className)}>
      {icon && <span className="pointer-events-none absolute left-2.5 text-brass-500">{icon}</span>}
      <select
        aria-label={label}
        className={cn("field w-full", icon && "pl-8")}
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-bone-500" />
    </div>
  );
}

export function Slider({ value, min, max, step, onChange, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; label: string }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input
      aria-label={label}
      type="range"
      className="rng"
      min={min}
      max={max}
      step={step}
      value={value}
      style={{ ["--p" as string]: `${p}%` }}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  );
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const set = (v: number) => onChange(Math.max(min, Math.min(max, Math.round(v) || min)));
  return (
    <div className="inline-flex items-center overflow-hidden rounded-[10px] border border-[#3a2e22] bg-[#16110d] shadow-[inset_0_2px_4px_rgba(0,0,0,.45)]">
      <button type="button" aria-label={`${label} −`} className="h-[32px] w-8 text-bone-400 transition-colors hover:bg-white/5 hover:text-brass-300" onClick={() => set(value - 1)}>
        −
      </button>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => set(parseInt(e.target.value, 10))}
        className="tabular h-[32px] w-12 border-x border-[#2e241a] bg-transparent text-center text-[12.5px] font-semibold text-bone-100 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      <button type="button" aria-label={`${label} +`} className="h-[32px] w-8 text-bone-400 transition-colors hover:bg-white/5 hover:text-brass-300" onClick={() => set(value + 1)}>
        +
      </button>
    </div>
  );
}

export function Section({ title, hint, children, right }: { title: string; hint?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card rounded-2xl p-3.5">
      <div className="mb-2.5 flex items-start justify-between gap-3 px-1">
        <div>
          <h3 className="serif text-[17px] font-bold leading-tight text-bone-50">{title}</h3>
          {hint && <p className="mt-0.5 text-[11px] leading-snug text-bone-500">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PanelHeader({ title, subtitle, icon, onClose }: { title: string; subtitle?: string; icon: ReactNode; onClose: () => void }) {
  return (
    <header className="relative flex items-center gap-3 border-b border-white/[0.07] px-5 py-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-brass-500/40 bg-gradient-to-b from-brass-500/20 to-brass-700/10 text-brass-300 shadow-[inset_0_1px_0_rgba(255,226,160,.2)]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="serif text-[22px] font-bold leading-none text-bone-50">{title}</h2>
        {subtitle && <p className="mt-1.5 truncate text-[11.5px] text-bone-500">{subtitle}</p>}
      </div>
      <button className="btn btn-icon btn-sm !h-8 !w-8" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
        <X size={15} />
      </button>
    </header>
  );
}

export function Stat({ label, value, accent }: { label: string; value: ReactNode; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-[11.5px] text-bone-500">{label}</span>
      <span className={cn("tabular text-right text-[12px] font-semibold", accent ? "text-brass-300" : "text-bone-100")}>{value}</span>
    </div>
  );
}

export function DifficultyPips({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-[3px]" title={`Difficulty ${level} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <span key={i} className={cn("h-1.5 w-3.5 rounded-full", i <= level ? "bg-gradient-to-r from-brass-300 to-brass-500 shadow-[0_0_6px_rgba(226,178,86,.5)]" : "bg-white/10")} />
      ))}
    </span>
  );
}
