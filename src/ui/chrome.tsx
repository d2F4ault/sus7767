import {
  Clapperboard,
  ChevronDown,
  FolderOpen,
  Maximize2,
  Music2,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  StepBack,
  StepForward,
  Table2,
  Users,
} from "lucide-react";
import { useCallback, useRef, type ReactNode } from "react";
import { formatTime, type Song } from "../engine/midi";
import type { Player, PlayerSnapshot } from "../engine/player";
import { shortTitle } from "../engine/songs";
import { midiTimeOfFrame, totalFrames } from "../engine/sync";
import type { HandFilter, KeyLabelMode, NoteLabelMode, RenderSettings, SyncConfig } from "../engine/types";
import { cn } from "../utils/cn";
import { Segmented, Select } from "./primitives";

export type PanelId = "none" | "repertoire" | "tracks" | "teaching" | "syncInspector";

/* ------------------------------ logo ------------------------------ */

export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="lg-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbe3a0" />
          <stop offset="0.5" stopColor="#d4a24c" />
          <stop offset="1" stopColor="#7a5518" />
        </linearGradient>
        <linearGradient id="lg-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b2a1a" />
          <stop offset="1" stopColor="#170f09" />
        </linearGradient>
        <linearGradient id="lg-ivory" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#d9ccb0" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="46" height="46" rx="12" fill="url(#lg-body)" stroke="url(#lg-brass)" strokeWidth="1.5" />
      <rect x="3.5" y="3.5" width="41" height="41" rx="9.5" fill="none" stroke="rgba(255,226,170,.15)" />
      <rect x="8" y="9" width="32" height="5" rx="1.5" fill="#6e2535" />
      <rect x="8" y="9" width="32" height="1.5" fill="#e2b256" />
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={8.4 + i * 8} y="15" width="7.2" height="24" rx="1.8" fill="url(#lg-ivory)" />
      ))}
      {[0, 1].map((i) => (
        <rect key={i} x={13.6 + i * 8} y="15" width="5" height="14.5" rx="1.4" fill="#120c08" stroke="#000" strokeWidth=".4" />
      ))}
    </svg>
  );
}

/* ----------------------------- header ----------------------------- */

interface HeaderProps {
  song: Song;
  settings: RenderSettings;
  setSettings: (u: (s: RenderSettings) => RenderSettings) => void;
  panel: PanelId;
  togglePanel: (p: PanelId) => void;
  onOpenFile: () => void;
  onExport: () => void;
  onZen: () => void;
}

function NavButton({ active, icon, label, onClick, title, collapse = "sm" }: { active?: boolean; icon: ReactNode; label: string; onClick: () => void; title: string; collapse?: "sm" | "xl" | "md" }) {
  const hide = collapse === "xl" ? "hidden min-[1900px]:inline" : collapse === "md" ? "hidden md:inline" : "hidden min-[1750px]:inline";
  return (
    <button className="btn" data-active={active ? "true" : "false"} onClick={onClick} title={title} aria-pressed={active}>
      <span className="text-brass-400">{icon}</span>
      <span className={hide}>{label}</span>
    </button>
  );
}

export function Header({ song, settings, setSettings, panel, togglePanel, onOpenFile, onExport, onZen }: HeaderProps) {
  const hands: { value: HandFilter; label: ReactNode; title: string }[] = [
    { value: "both", label: "Both Hands", title: "Show both hands" },
    {
      value: "right",
      label: (
        <>
          <i className="h-2 w-2 rounded-full bg-[#f2b84b] shadow-[0_0_8px_#f2b84b]" />
          R.H.
        </>
      ),
      title: "Right hand only (gold)",
    },
    {
      value: "left",
      label: (
        <>
          <i className="h-2 w-2 rounded-full bg-[#4fc4a8] shadow-[0_0_8px_#4fc4a8]" />
          L.H.
        </>
      ),
      title: "Left hand only (verdigris)",
    },
  ];
  const noteLabels: { value: NoteLabelMode; label: string }[] = [
    { value: "fingering", label: "Notes · Fingering" },
    { value: "noteName", label: "Notes · Pitch (C, D, E)" },
    { value: "solfege", label: "Notes · Solfège (Do, Re)" },
    { value: "scaleDegree", label: "Notes · Scale Degree" },
    { value: "none", label: "Notes · Clean Bars" },
  ];
  const keyLabels: { value: KeyLabelMode; label: string }[] = [
    { value: "onlyC", label: "Keys · Octave C" },
    { value: "allWhite", label: "Keys · All Naturals" },
    { value: "all88", label: "Keys · All 88 Keys" },
    { value: "solfege", label: "Keys · Solfège" },
    { value: "none", label: "Keys · Unlabeled" },
  ];

  return (
    <header className="bar bar-top relative z-30 flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      {/* brand */}
      <div className="flex items-center gap-3 pr-1">
        <div className="drop-shadow-[0_4px_14px_rgba(226,178,86,.28)]">
          <Logo size={42} />
        </div>
        <div className="leading-none">
          <div className="flex items-baseline gap-2">
            <span className="serif brass-text text-[28px] font-bold tracking-tight">Clavier</span>
            <span className="rounded border border-brass-500/40 bg-brass-500/10 px-1.5 py-[1px] text-[9.5px] font-bold tracking-wider text-brass-300">88</span>
          </div>
          <div className="mt-1 hidden text-[10px] font-semibold uppercase tracking-[0.17em] text-bone-500 min-[1900px]:block">A0–C8 · Pedagogical Visualizer &amp; Lossless Renderer</div>
        </div>
      </div>

      <div className="divider-v mx-0.5 hidden h-8 md:block" />

      {/* piece + file */}
      <button
        className="btn !h-[42px] max-w-[290px] min-w-0 !justify-start !gap-2.5 !px-3 text-left"
        data-active={panel === "repertoire" ? "true" : "false"}
        onClick={() => togglePanel("repertoire")}
        title="Select a built-in piece or load a MIDI file"
      >
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-gradient-to-b from-brass-500/25 to-brass-700/10 text-brass-300 ring-1 ring-brass-500/30">
          <Music2 size={14} />
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[12.5px] font-semibold text-bone-50">{shortTitle(song.name)}</span>
          <span className="block truncate text-[10.5px] font-normal text-bone-500">{song.artist ?? "MIDI file"}</span>
        </span>
        <ChevronDown size={14} className={cn("flex-none text-bone-500 transition-transform", panel === "repertoire" && "rotate-180")} />
      </button>
      <button className="btn !h-[42px]" onClick={onOpenFile} title="Open any .mid / .midi file (or drag & drop anywhere)">
        <FolderOpen size={15} className="text-brass-400" />
        <span className="hidden min-[1750px]:inline">Open MIDI</span>
      </button>

      <div className="flex-1" />

      {/* view controls */}
      <div className="hidden items-center gap-2 xl:flex">
        <Segmented value={settings.activeHandFilter} options={hands} onChange={(v) => setSettings((s) => ({ ...s, activeHandFilter: v }))} />
        <Select<NoteLabelMode> className="w-[176px]" label="Note label mode" value={settings.noteLabelMode} options={noteLabels} onChange={(v) => setSettings((s) => ({ ...s, noteLabelMode: v }))} />
        <Select<KeyLabelMode> className="w-[150px]" label="Key label mode" value={settings.keyLabelMode} options={keyLabels} onChange={(v) => setSettings((s) => ({ ...s, keyLabelMode: v }))} />
      </div>
      <div className="divider-v mx-0.5 hidden h-8 xl:block" />

      {/* panels */}
      <div className="flex items-center gap-2">
        <NavButton active={panel === "tracks"} icon={<Users size={15} />} label="Voices & Hands" title="Voice / hand assignment, fingering & practice loop" onClick={() => togglePanel("tracks")} />
        <NavButton active={panel === "teaching"} icon={<SlidersHorizontal size={15} />} label="Study Aids" title="Visual & pedagogical settings" onClick={() => togglePanel("teaching")} />
        <NavButton active={panel === "syncInspector"} icon={<Table2 size={15} />} label="Sync Proof" collapse="xl" title="Frame-exact MIDI-to-video sync table" onClick={() => togglePanel("syncInspector")} />
        <button className="btn btn-brass" onClick={onExport} title="Render a silent, frame-exact MP4 and sync manifest">
          <Clapperboard size={15} />
          <span>Export MP4</span>
        </button>
        <button className="btn btn-icon" onClick={onZen} title="Distraction-free view (H)" aria-label="Distraction-free view">
          <Maximize2 size={15} className="text-bone-300" />
        </button>
      </div>
    </header>
  );
}

/* ---------------------------- transport ---------------------------- */

interface TransportProps {
  player: Player;
  snap: PlayerSnapshot;
  song: Song;
  sync: SyncConfig;
  speed: number;
  setSpeed: (v: number) => void;
  loopRange: { on: boolean; start: number; end: number };
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export function Transport({ player, snap, song, sync, speed, setSpeed, loopRange }: TransportProps) {
  const total = totalFrames(song, sync);
  const tMin = -sync.leadInSeconds;
  const tMax = song.duration + sync.tailOutSeconds;
  const span = tMax - tMin;
  const frac = Math.max(0, Math.min(1, (snap.t - tMin) / span));
  const trackRef = useRef<HTMLDivElement>(null);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const r = trackRef.current!.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      player.seek(tMin + f * span);
    },
    [player, tMin, span],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    seekFromEvent(e.clientX);
    const move = (ev: PointerEvent) => seekFromEvent(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") player.seek(player.t + 2), e.preventDefault(), e.stopPropagation();
    if (e.key === "ArrowLeft") player.seek(player.t - 2), e.preventDefault(), e.stopPropagation();
  };

  // density sparkline
  const bins = song.densityBins;
  const pts = bins.map((b, i) => `${((i + 0.5) / bins.length) * 100},${100 - b * 100}`).join(" ");
  const leadFrac = sync.leadInSeconds / span;
  const mA = song.measures[Math.max(0, Math.min(song.measures.length - 1, loopRange.start - 1))];
  const mB = song.measures[loopRange.end];
  const loopA = mA ? (mA.time - tMin) / span : 0;
  const loopB = (mB ? mB.time : song.duration) - tMin;

  return (
    <footer className="bar bar-bottom relative z-30 flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
      {/* transport buttons */}
      <div className="flex items-center gap-1.5">
        <button className="btn btn-icon" onClick={() => player.restart()} title="Back to start of lead-in (Home)" aria-label="Restart">
          <SkipBack size={15} />
        </button>
        <button className="btn btn-icon" onClick={() => player.stepNote(-1)} title="Previous note strike (Shift + ←)" aria-label="Previous note">
          <Rewind size={15} />
        </button>
        <button className="btn !px-2" onClick={() => player.stepFrames(-1)} title="Step back one exact video frame (←)" aria-label="Back one frame">
          <StepBack size={15} />
          <span className="tabular text-[11px] text-bone-400">1f</span>
        </button>
        <button className="btn btn-brass btn-play" onClick={() => player.toggle()} title="Play / Pause (Space)">
          {snap.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          <span>{snap.playing ? "Pause" : "Play"}</span>
        </button>
        <button className="btn !px-2" onClick={() => player.stepFrames(1)} title="Step forward one exact video frame (→)" aria-label="Forward one frame">
          <span className="tabular text-[11px] text-bone-400">1f</span>
          <StepForward size={15} />
        </button>
        <button className="btn btn-icon" onClick={() => player.stepNote(1)} title="Next note strike (Shift + →)" aria-label="Next note">
          <SkipForward size={15} />
        </button>
        <Select<number>
          className="ml-1 w-[92px]"
          label="Practice tempo"
          value={speed}
          onChange={setSpeed}
          options={SPEEDS.map((s) => ({ value: s, label: `${s.toFixed(2)}×` }))}
        />
      </div>

      {/* timeline */}
      <div className="flex min-w-[260px] flex-1 items-center gap-3">
        <span className="tabular w-[74px] text-right text-[12.5px] font-semibold text-bone-100">{formatTime(snap.t)}</span>
        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Timeline"
          aria-valuemin={0}
          aria-valuemax={Math.round(tMax)}
          aria-valuenow={Math.round(snap.t)}
          onPointerDown={onPointerDown}
          onKeyDown={onKey}
          className="group relative h-10 flex-1 cursor-pointer touch-none select-none rounded-lg"
        >
          {/* track */}
          <div className="absolute inset-x-0 bottom-0 top-0 overflow-hidden rounded-lg border border-[#33291e] bg-gradient-to-b from-[#120d0a] to-[#1a140f] shadow-[inset_0_2px_6px_rgba(0,0,0,.6)]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
              <defs>
                <linearGradient id="dens" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#e2b256" stopOpacity=".55" />
                  <stop offset="1" stopColor="#e2b256" stopOpacity=".05" />
                </linearGradient>
              </defs>
              <g transform={`translate(${leadFrac * 100},0) scale(${(song.duration / span)},1)`}>
                <polygon points={`0,100 ${pts} 100,100`} fill="url(#dens)" />
              </g>
            </svg>
            {/* lead-in zone */}
            <div className="absolute inset-y-0 left-0 border-r border-dashed border-brass-500/30 bg-white/[0.025]" style={{ width: `${leadFrac * 100}%` }} />
            {/* loop range */}
            {loopRange.on && (
              <div
                className="absolute inset-y-0 border-x border-verdi-400/70 bg-verdi-400/15"
                style={{ left: `${loopA * 100}%`, width: `${Math.max(0.4, ((loopB - tMin) / span - loopA) * 100)}%` }}
              />
            )}
            {/* progress */}
            <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-brass-500/10 to-brass-400/30" style={{ width: `${frac * 100}%` }} />
          </div>
          {/* playhead */}
          <div className="pointer-events-none absolute inset-y-[-3px] w-[2px] -translate-x-1/2 rounded-full bg-gradient-to-b from-brass-200 to-brass-500 shadow-[0_0_12px_rgba(240,203,127,.9)]" style={{ left: `${frac * 100}%` }}>
            <div className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full border border-brass-700 bg-brass-200 shadow-[0_0_8px_rgba(240,203,127,.9)]" />
          </div>
        </div>
        <span className="tabular w-[60px] text-[12.5px] font-medium text-bone-500">{formatTime(song.duration, false)}</span>
      </div>

      {/* readouts */}
      <div className="flex items-stretch gap-3 text-[11.5px]">
        <div className="flex flex-col justify-center leading-tight">
          <span className="eyebrow !text-[9px]">Measure</span>
          <span className="tabular text-[14px] font-semibold text-bone-100">{snap.measure > 0 ? snap.measure : "—"}</span>
        </div>
        <div className="divider-v" />
        <div className="flex flex-col justify-center leading-tight">
          <span className="eyebrow !text-[9px]">Video</span>
          <span className="tabular text-[13px] font-semibold text-verdi-300">
            {formatTime(snap.t + sync.leadInSeconds)} <span className="text-bone-500">· f#{Math.max(0, snap.frame)}</span>
            <span className="hidden text-bone-600 xl:inline"> / {total}</span>
          </span>
        </div>
      </div>
    </footer>
  );
}

export { midiTimeOfFrame };
