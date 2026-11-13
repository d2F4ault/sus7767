import {
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Gauge,
  Layers,
  Library,
  Palette,
  Repeat,
  SlidersHorizontal,
  Table2,
  Users,
  Waves,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { noteName, formatTime, type Hand, type Song, type TrackHand } from "../engine/midi";
import { REPERTOIRE, shortTitle } from "../engine/songs";
import { buildManifest, downloadManifest, frameOfMidiTime, offsetSeconds } from "../engine/sync";
import type { ColorMode, RenderSettings, SyncConfig } from "../engine/types";
import { cn } from "../utils/cn";
import { DifficultyPips, PanelHeader, Section, Segmented, Slider, Stat, Stepper, ToggleRow } from "./primitives";

export function Drawer({ side = "right", width = 420, children, label }: { side?: "left" | "right"; width?: number; children: ReactNode; label: string }) {
  return (
    <aside
      aria-label={label}
      style={{ width: `min(${width}px, calc(100% - 24px))` }}
      className={cn(
        "glass absolute bottom-3 top-3 z-20 flex flex-col overflow-hidden rounded-3xl",
        side === "right" ? "right-3 animate-drawer-in" : "left-3 animate-drawer-in-left",
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass-300/50 to-transparent" />
      {children}
    </aside>
  );
}

/* ------------------------------ repertoire ------------------------------ */

export function RepertoirePanel({ song, onSelect, onOpenFile, onClose }: { song: Song; onSelect: (id: string) => void; onOpenFile: () => void; onClose: () => void }) {
  return (
    <Drawer side="left" width={500} label="Repertoire">
      <PanelHeader title="Repertoire" subtitle="Bundled inside this file — zero internet required" icon={<Library size={19} />} onClose={onClose} />
      <div className="scroll flex-1 space-y-2.5 overflow-y-auto p-4">
        {REPERTOIRE.map((m, i) => {
          const active = song.id === m.id;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={cn(
                "group relative flex w-full items-center gap-3.5 overflow-hidden rounded-2xl border p-3.5 text-left transition-all",
                active
                  ? "border-brass-500/70 bg-gradient-to-br from-brass-500/[0.16] to-brass-700/[0.05] shadow-[0_0_30px_-10px_rgba(226,178,86,.6),inset_0_1px_0_rgba(255,226,160,.14)]"
                  : "border-white/[0.07] bg-white/[0.02] hover:-translate-y-px hover:border-brass-500/40 hover:bg-white/[0.045]",
              )}
            >
              <div
                className={cn(
                  "serif flex h-12 w-12 flex-none items-center justify-center rounded-xl border text-[22px] font-bold",
                  active ? "border-brass-400/70 bg-brass-500/20 text-brass-200" : "border-white/10 bg-black/30 text-bone-400 group-hover:text-brass-300",
                )}
              >
                {["I", "II", "III", "IV", "V", "VI"][i]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="serif truncate text-[17px] font-bold leading-tight text-bone-50">{shortTitle(m.name)}</span>
                  {active && <span className="flex-none rounded-full bg-brass-400 px-2 py-[1px] text-[9px] font-extrabold uppercase tracking-wider text-ink-900">Loaded</span>}
                </div>
                <div className="mt-0.5 truncate text-[12px] text-bone-300">{m.artist}</div>
                <div className="mt-1.5 flex items-center justify-between gap-3">
                  <span className="truncate text-[10.5px] text-bone-500">{m.piece}</span>
                  <DifficultyPips level={m.difficulty ?? 1} />
                </div>
              </div>
            </button>
          );
        })}
        <div className="hairline my-3" />
        <button onClick={onOpenFile} className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-dashed border-brass-500/40 bg-brass-500/[0.04] py-5 text-[13px] font-semibold text-brass-300 transition-colors hover:border-brass-400 hover:bg-brass-500/10">
          <FolderOpen size={17} />
          Load custom .MID / .MIDI from disk
        </button>
        <p className="px-2 pt-1 text-center text-[11px] text-bone-500">…or simply drag &amp; drop a MIDI file anywhere on the window.</p>
      </div>
    </Drawer>
  );
}

/* ------------------------------ voices & hands ------------------------------ */

export function TracksPanel({
  song,
  rev,
  settings,
  setSettings,
  onHand,
  loop,
  setLoop,
  onClose,
}: {
  song: Song;
  rev: number;
  settings: RenderSettings;
  setSettings: (u: (s: RenderSettings) => RenderSettings) => void;
  onHand: (track: number, hand: TrackHand) => void;
  loop: { on: boolean; start: number; end: number };
  setLoop: (l: { on: boolean; start: number; end: number }) => void;
  onClose: () => void;
}) {
  void rev;
  const maxM = song.measures.length;
  const toggleMute = (i: number) =>
    setSettings((s) => ({ ...s, mutedTracks: s.mutedTracks.includes(i) ? s.mutedTracks.filter((x) => x !== i) : [...s.mutedTracks, i] }));
  return (
    <Drawer label="Voices and hands">
      <PanelHeader title="Voices & Hands" subtitle="Beam-search dynamic-programming fingering (1 = thumb … 5 = pinky)" icon={<Users size={19} />} onClose={onClose} />
      <div className="scroll flex-1 space-y-3.5 overflow-y-auto p-4">
        <Section title="Voices" hint={`${song.tracks.length} voice${song.tracks.length === 1 ? "" : "s"} · ${song.notes.length.toLocaleString()} notes`}>
          <div className="space-y-2">
            {song.tracks.map((t) => {
              const muted = settings.mutedTracks.includes(t.index);
              const rh = t.resolvedHand === "R";
              const split = t.resolvedHand === "split";
              return (
                <div key={t.index} className={cn("rounded-xl border p-3 transition-opacity", muted ? "border-white/5 bg-black/20 opacity-55" : "border-white/[0.08] bg-black/20")}>
                  <div className="flex items-center gap-3">
                    <span
                      className="h-9 w-1.5 flex-none rounded-full"
                      style={{ background: split ? "linear-gradient(#f2b84b,#4fc4a8)" : rh ? "#f2b84b" : "#4fc4a8", boxShadow: `0 0 12px ${split ? "#c9b97a" : rh ? "#f2b84b" : "#4fc4a8"}80` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-bone-50">{t.name}</div>
                      <div className="tabular mt-0.5 text-[11px] text-bone-500">
                        {t.noteCount.toLocaleString()} notes · {noteName(t.lo)}–{noteName(t.hi)}
                      </div>
                    </div>
                    <button className="btn btn-icon btn-sm" onClick={() => toggleMute(t.index)} title={muted ? "Show this voice" : "Hide this voice"} aria-label={muted ? "Show voice" : "Hide voice"}>
                      {muted ? <EyeOff size={14} /> : <Eye size={14} className="text-brass-400" />}
                    </button>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-bone-500">Assigned hand &amp; pigment</span>
                    <Segmented<TrackHand>
                      value={t.hand}
                      onChange={(h) => onHand(t.index, h)}
                      options={[
                        { value: "auto", label: "Auto" },
                        { value: "R", label: "Right" },
                        { value: "L", label: "Left" },
                      ]}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="Practice Loop" hint="Repeat a passage by measure (A–B loop)" right={<ToggleChip checked={loop.on} onChange={(v) => setLoop({ ...loop, on: v })} />}>
          <div className={cn("grid grid-cols-2 gap-3 transition-opacity", !loop.on && "opacity-50")}>
            <div>
              <div className="eyebrow mb-1.5">Start measure</div>
              <Stepper label="Start measure" min={1} max={maxM} value={loop.start} onChange={(v) => setLoop({ ...loop, start: v, end: Math.max(loop.end, v) })} />
            </div>
            <div>
              <div className="eyebrow mb-1.5">End measure</div>
              <Stepper label="End measure" min={1} max={maxM} value={Math.max(loop.start, loop.end)} onChange={(v) => setLoop({ ...loop, end: Math.max(v, loop.start) })} />
            </div>
          </div>
          <p className="mt-3 flex items-center gap-1.5 px-1 text-[11px] text-bone-500">
            <Repeat size={12} /> Song has {maxM} measures · the loop region is shaded on the timeline.
          </p>
        </Section>
      </div>
    </Drawer>
  );
}

function ToggleChip({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className="btn btn-sm" data-active={checked ? "true" : "false"} aria-pressed={checked} onClick={() => onChange(!checked)}>
      <Repeat size={12} /> {checked ? "Looping" : "Enable A–B"}
    </button>
  );
}

/* ------------------------------ study aids ------------------------------ */

const COLOR_OPTIONS: { id: ColorMode; title: string; sub: string; swatch: string[] }[] = [
  { id: "hand", title: "By Hand / Voice", sub: "Burnished gold & verdigris", swatch: ["#f2b84b", "#4fc4a8"] },
  { id: "finger", title: "By Finger 1–5", sub: "Old-world mineral palette", swatch: ["#ea695c", "#f0a24a", "#ebd46a", "#5bba8b", "#5b94d9"] },
  { id: "pitch", title: "By Pitch Class", sub: "Twelve-tone chromatic", swatch: ["#e6604f", "#f1a340", "#d6dd58", "#4fc18a", "#4a9cdc", "#9b6fe1", "#cd67c6"] },
  { id: "colorblind", title: "Colorblind Safe", sub: "Okabe–Ito high contrast", swatch: ["#E69F00", "#56B4E9"] },
  { id: "monochrome", title: "Monochrome", sub: "Bone ivory & parchment", swatch: ["#f1e8d4", "#a99e88"] },
];

export function StudyPanel({
  settings,
  setSettings,
  practice,
  setPractice,
  onClose,
}: {
  settings: RenderSettings;
  setSettings: (u: (s: RenderSettings) => RenderSettings) => void;
  practice: boolean;
  setPractice: (v: boolean) => void;
  onClose: () => void;
}) {
  const set = <K extends keyof RenderSettings>(k: K, v: RenderSettings[K]) => setSettings((s) => ({ ...s, [k]: v }));
  const layers: { label: string; hint: string; on: boolean; apply: (v: boolean) => void }[] = [
    { label: "Octave & semitone lane rules", hint: "Vertical C and F boundaries across the lanes", on: settings.showKeyLaneGuides, apply: (v) => set("showKeyLaneGuides", v) },
    {
      label: "Measure lines & numerals",
      hint: "Horizontal barlines with classical numbering",
      on: settings.showMeasureLines,
      apply: (v) => setSettings((s) => ({ ...s, showMeasureLines: v, showMeasureNumbers: v })),
    },
    { label: "Quarter-note beat subdivisions", hint: "Subtle hairlines between barlines", on: settings.showBeatLines, apply: (v) => set("showBeatLines", v) },
    {
      label: "Damper pedal resonance plumes",
      hint: "CC 64 sustain tails and the “Ped.” indicator",
      on: settings.showSustainTails,
      apply: (v) => setSettings((s) => ({ ...s, showSustainTails: v, showSustainPedal: v })),
    },
    {
      label: "Chord & Roman-numeral brackets",
      hint: "Brackets in the lanes plus the chord banner",
      on: settings.showChordBrackets,
      apply: (v) => setSettings((s) => ({ ...s, showChordBrackets: v, showChordBanner: v })),
    },
    { label: "Anticipatory key pre-glow", hint: "Fallboard dots before each strike", on: settings.showIncomingKeyPreview, apply: (v) => set("showIncomingKeyPreview", v) },
    { label: "Illuminated key-strike contact line", hint: "A brass sync aid at the moment of impact", on: settings.showStrikeContactBar, apply: (v) => set("showStrikeContactBar", v) },
    { label: "Concert-grand black key offsets", hint: "Authentic asymmetric black-key placement", on: settings.acousticBlackKeyOffsets, apply: (v) => set("acousticBlackKeyOffsets", v) },
    { label: "88-key minimap overview strip", hint: "Docked beneath the keyboard", on: settings.showKeyMinimap, apply: (v) => set("showKeyMinimap", v) },
    { label: "Velocity-sensitive strike bloom", hint: "Luminous bloom and sparks on impact", on: settings.showAcousticBloom, apply: (v) => set("showAcousticBloom", v) },
    { label: "Workshop dust motes", hint: "Ambient drifting particles in the lamplight", on: settings.ambientDust, apply: (v) => set("ambientDust", v) },
    { label: "Spell accidentals as flats (♭)", hint: "Instead of sharps (♯) in all labels", on: settings.useFlats, apply: (v) => set("useFlats", v) },
  ];
  const fast = settings.noteFallSeconds;

  return (
    <Drawer label="Study aids">
      <PanelHeader title="Study Aids" subtitle="Every setting applies identically to the screen and the exported MP4" icon={<SlidersHorizontal size={19} />} onClose={onClose} />
      <div className="scroll flex-1 space-y-3.5 overflow-y-auto p-4">
        <Section title="Pigment System" right={<Palette size={16} className="text-brass-500" />}>
          <div className="grid grid-cols-1 gap-1.5">
            {COLOR_OPTIONS.map((o) => {
              const on = settings.colorMode === o.id;
              return (
                <button
                  key={o.id}
                  onClick={() => set("colorMode", o.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all",
                    on ? "border-brass-500/70 bg-brass-500/[0.12] shadow-[0_0_24px_-10px_rgba(226,178,86,.7)]" : "border-white/[0.06] bg-black/20 hover:border-white/20",
                  )}
                  aria-pressed={on}
                >
                  <span className="flex w-[92px] flex-none -space-x-1">
                    {o.swatch.slice(0, 5).map((c, i) => (
                      <i key={i} className="h-5 w-5 rounded-full border-2 border-[#171210]" style={{ background: c, boxShadow: `0 0 10px ${c}55` }} />
                    ))}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[12.5px] font-semibold", on ? "text-brass-200" : "text-bone-100")}>{o.title}</span>
                    <span className="block text-[11px] text-bone-500">{o.sub}</span>
                  </span>
                  <span className={cn("h-4 w-4 flex-none rounded-full border-2 transition-all", on ? "border-brass-300 bg-brass-400 shadow-[0_0_10px_#e2b256]" : "border-white/20")} />
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Falling Speed" hint="Lookahead window of the note lanes" right={<span className="tabular rounded-md border border-brass-500/40 bg-brass-500/10 px-2 py-0.5 text-[12px] font-bold text-brass-300">{fast.toFixed(1)}s</span>}>
          <div className="px-1">
            <Slider label="Falling speed lookahead" min={1} max={5} step={0.1} value={fast} onChange={(v) => set("noteFallSeconds", +v.toFixed(1))} />
            <div className="mt-1 flex justify-between text-[10.5px] font-semibold text-bone-500">
              <button onClick={() => set("noteFallSeconds", 1)} className="hover:text-brass-300">Fast scroll · 1.0s</button>
              <button onClick={() => set("noteFallSeconds", 2.4)} className="hover:text-brass-300">Balanced · 2.4s</button>
              <button onClick={() => set("noteFallSeconds", 5)} className="hover:text-brass-300">Dense · 5.0s</button>
            </div>
          </div>
        </Section>

        <Section title="Keyboard Span" right={<Gauge size={16} className="text-brass-500" />}>
          <Segmented<string>
            className="w-full [&>button]:flex-1 [&>button]:justify-center"
            value={settings.autoZoomRange ? "fit" : "full"}
            onChange={(v) => set("autoZoomRange", v === "fit")}
            options={[
              { value: "full", label: "Full 88 keys (A0–C8)" },
              { value: "fit", label: "Fit piece range" },
            ]}
          />
        </Section>

        <Section title="Manuscript & Pedagogical Layers" right={<Layers size={16} className="text-brass-500" />}>
          <div className="-mx-1 space-y-0.5">
            {layers.map((l) => (
              <ToggleRow key={l.label} label={l.label} hint={l.hint} checked={l.on} onChange={l.apply} />
            ))}
          </div>
        </Section>

        <Section title="Practice Mode" right={<Waves size={16} className="text-brass-500" />}>
          <div className="-mx-1">
            <ToggleRow label="Practice step: auto-pause at each note" hint="Playback halts on every strike; press Space to continue" checked={practice} onChange={setPractice} />
          </div>
        </Section>
      </div>
    </Drawer>
  );
}

/* ------------------------------ sync proof ------------------------------ */

const ROW_H = 30;

export function SyncPanel({ song, sync, t, onSeekFrame, onClose }: { song: Song; sync: SyncConfig; t: number; onSeekFrame: (f: number) => void; onClose: () => void }) {
  const m = useMemo(() => buildManifest(song, sync), [song, sync]);
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(320);
  const off = offsetSeconds(sync);
  const notes = song.notes;
  const first = Math.max(0, Math.floor(scroll / ROW_H) - 4);
  const last = Math.min(notes.length, Math.ceil((scroll + viewH) / ROW_H) + 4);
  // current note index (last note with start <= t)
  let cur = -1;
  {
    let lo = 0;
    let hi = notes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (notes[mid].start <= t + 1e-4) {
        cur = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
  }
  const s = m.synchronization;
  return (
    <Drawer label="Frame-exact sync proof" width={560}>
      <PanelHeader title="Sync Proof" subtitle="Click any note or tempo event to seek to its exact strike frame" icon={<Table2 size={19} />} onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <div className="card rounded-2xl p-4">
          <div className="mb-2 flex items-center justify-between rounded-xl border border-brass-500/30 bg-brass-500/[0.07] px-3 py-2.5">
            <span className="eyebrow !text-brass-400">Sync law</span>
            <span className="tabular font-mono text-[12.5px] font-semibold text-brass-200">
              t<sub>video</sub> = t<sub>midi</sub> + {off.toFixed(6)}s
            </span>
          </div>
          <Stat label="Constant frame offset" value={`+${s.midiToVideoOffsetFrames} frames @ ${sync.fps} fps`} />
          <Stat label="First note strike" value={`MIDI ${s.firstNoteMidiTimeSeconds.toFixed(3)}s → Video ${s.firstNoteVideoTimeSeconds.toFixed(3)}s · f#${s.firstNoteVideoFrame}`} />
          <Stat label="Last note release" value={`MIDI ${s.lastNoteOffMidiTimeSeconds.toFixed(3)}s → Video ${s.lastNoteOffVideoTimeSeconds.toFixed(3)}s · f#${s.lastNoteOffVideoFrame}`} />
          <div className="mt-2 flex justify-end">
            <button className="btn btn-sm" onClick={() => downloadManifest(song, sync)}>
              <Download size={13} className="text-brass-400" /> Download .sync.json manifest
            </button>
          </div>
        </div>

        <div className="card rounded-2xl p-3">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="serif text-[15px] font-bold text-bone-50">Tempo map</span>
            <span className="text-[11px] text-bone-500">{song.tempos.length} tempo zone{song.tempos.length === 1 ? "" : "s"}</span>
          </div>
          <div className="scroll max-h-[116px] overflow-y-auto rounded-lg border border-white/5 bg-black/25">
            <table className="tabular w-full text-[11.5px]">
              <thead className="sticky top-0 bg-[#1a140f] text-left text-[10px] uppercase tracking-wider text-bone-500">
                <tr>
                  <th className="px-2.5 py-1.5 font-semibold">Tick</th>
                  <th className="px-2.5 py-1.5 font-semibold">BPM</th>
                  <th className="px-2.5 py-1.5 font-semibold">MIDI t(s)</th>
                  <th className="px-2.5 py-1.5 font-semibold">Video frame</th>
                </tr>
              </thead>
              <tbody>
                {song.tempos.map((tp, i) => (
                  <tr key={i} onClick={() => onSeekFrame(frameOfMidiTime(tp.time, sync))} className="cursor-pointer border-t border-white/[0.04] transition-colors hover:bg-brass-500/10">
                    <td className="px-2.5 py-1 text-bone-500">{tp.tick}</td>
                    <td className="px-2.5 py-1 font-semibold text-brass-300">{tp.bpm.toFixed(1)}</td>
                    <td className="px-2.5 py-1">{tp.time.toFixed(3)}</td>
                    <td className="px-2.5 py-1 text-verdi-300">f#{frameOfMidiTime(tp.time, sync)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card flex min-h-0 flex-1 flex-col rounded-2xl p-3">
          <div className="mb-1.5 flex items-center justify-between px-1">
            <span className="serif text-[15px] font-bold text-bone-50">Note event map</span>
            <span className="text-[11px] text-bone-500">{notes.length.toLocaleString()} events</span>
          </div>
          <div className="tabular grid grid-cols-[44px_1fr_58px_1fr_1fr_1fr] gap-1 rounded-t-lg bg-[#1a140f] px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-bone-500">
            <span>#</span>
            <span>Key</span>
            <span>Hand</span>
            <span>MIDI on</span>
            <span>Video on</span>
            <span>Frame</span>
          </div>
          <div
            className="scroll relative min-h-[120px] flex-1 overflow-y-auto rounded-b-lg border border-white/5 bg-black/25"
            ref={(el) => {
              if (el && Math.abs(el.clientHeight - viewH) > 2) setViewH(el.clientHeight);
            }}
            onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          >
            <div style={{ height: notes.length * ROW_H, position: "relative" }}>
              {notes.slice(first, last).map((n, j) => {
                const i = first + j;
                const frame = frameOfMidiTime(n.start, sync);
                return (
                  <div
                    key={n.id}
                    onClick={() => onSeekFrame(frame)}
                    style={{ position: "absolute", top: i * ROW_H, height: ROW_H, left: 0, right: 0 }}
                    className={cn(
                      "tabular grid cursor-pointer grid-cols-[44px_1fr_58px_1fr_1fr_1fr] items-center gap-1 border-t border-white/[0.035] px-2 text-[11.5px] transition-colors",
                      i === cur ? "bg-brass-500/20 font-semibold text-bone-50 shadow-[inset_2px_0_0_#e2b256]" : "hover:bg-white/[0.05]",
                    )}
                  >
                    <span className="text-bone-600">{i + 1}</span>
                    <span className="font-semibold text-brass-300">
                      {noteName(n.midi)} <span className="font-normal text-bone-600">({n.midi})</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <i className="h-1.5 w-1.5 rounded-full" style={{ background: n.hand === ("R" as Hand) ? "#f2b84b" : "#4fc4a8" }} />
                      {n.hand}·{n.finger}
                    </span>
                    <span>{formatTime(n.start)}</span>
                    <span>{formatTime(n.start + off)}</span>
                    <span className="text-verdi-300">f#{frame}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
