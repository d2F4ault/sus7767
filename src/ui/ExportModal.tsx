import { AlertTriangle, Check, Clapperboard, Copy, Film, Loader2, Shield, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { estimateBytes, exportWithEvents, webCodecsAvailable, type ExportProgress } from "../engine/exporter";
import { formatTime, type Song } from "../engine/midi";
import { buildManifest, downloadBlob, totalFrames } from "../engine/sync";
import type { QualityProfile, RenderSettings, SyncConfig } from "../engine/types";
import { cn } from "../utils/cn";
import { Section, Segmented, Select, Stat } from "./primitives";

const RESOLUTIONS = [
  { value: "3840x2160", label: "3840 × 2160 · 4K UHD" },
  { value: "2560x1440", label: "2560 × 1440 · 2K QHD" },
  { value: "1920x1080", label: "1920 × 1080 · Full HD (default)" },
  { value: "1280x720", label: "1280 × 720 · HD" },
  { value: "custom", label: "Custom size…" },
];
const FPS = [
  { value: 120, label: "120 fps · ultra high-speed" },
  { value: 60, label: "60 fps · standard precision (default)" },
  { value: 50, label: "50 fps · PAL broadcast" },
  { value: 30, label: "30 fps · standard video" },
  { value: 24, label: "24 fps · cinema" },
];
const PROFILES: { id: QualityProfile; title: string; sub: string; tag: string }[] = [
  { id: "rgb-lossless", title: "Bit-exact RGB master", sub: "Maximum-bitrate H.264 — pair with the CLI renderer for true QP 0", tag: "Archival" },
  { id: "yuv444-lossless", title: "Full-chroma 4:4:4 grade", sub: "Very high bitrate, tuned for NLE / colour-grading workflows", tag: "Editing" },
  { id: "compatible-lossless", title: "Universal player compatible", sub: "H.264 High 4:2:0 at a generous rate — plays everywhere", tag: "Everywhere" },
];

function fmtBytes(n: number) {
  if (n > 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}
function fmtEta(s: number) {
  if (!isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
}

function Ring({ pct }: { pct: number }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140" className="drop-shadow-[0_0_24px_rgba(226,178,86,.35)]">
      <defs>
        <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fbe3a0" />
          <stop offset="1" stopColor="#b8832d" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="70" r={r} fill="none" stroke="#241b13" strokeWidth="9" />
      <circle cx="70" cy="70" r={r} fill="none" stroke="url(#ring)" strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 70 70)" style={{ transition: "stroke-dashoffset .2s" }} />
      <text x="70" y="76" textAnchor="middle" className="tabular" fill="#fbf4e4" fontSize="30" fontWeight="700" fontFamily="Cormorant, serif">
        {Math.floor(pct)}%
      </text>
    </svg>
  );
}

export function ExportModal({
  song,
  settings,
  sync,
  setSync,
  autoStart,
  onClose,
}: {
  song: Song;
  settings: RenderSettings;
  sync: SyncConfig;
  setSync: (u: (s: SyncConfig) => SyncConfig) => void;
  autoStart?: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"config" | "running" | "done" | "error">("config");
  const [prog, setProg] = useState<ExportProgress | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ bytes: number; saved: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const resKey = `${sync.width}x${sync.height}`;
  const isCustom = !RESOLUTIONS.some((r) => r.value === resKey);
  const supported = webCodecsAvailable();
  const m = buildManifest(song, sync);
  const frames = totalFrames(song, sync);
  const baseName = song.fileName.replace(/\.(mid|midi)$/i, "");

  const run = useCallback(
    async (viaPicker: boolean) => {
      setError("");
      let writable: FileSystemWritableFileStream | undefined;
      const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<FileSystemFileHandle> };
      if (viaPicker && w.showSaveFilePicker) {
        try {
          const h = await w.showSaveFilePicker({ suggestedName: `${baseName}.mp4`, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
          writable = await h.createWritable();
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
          writable = undefined; // sandboxed iframe etc. → fall back to in-memory download
        }
      }
      const ac = new AbortController();
      abort.current = ac;
      setPhase("running");
      setProg({ frame: 0, total: frames, pct: 0, fps: 0, etaSeconds: 0, phase: "preparing" });
      try {
        const res = await exportWithEvents({ song, settings, sync, signal: ac.signal, writable, onProgress: setProg });
        if (res.blob) downloadBlob(res.blob, `${baseName}.mp4`);
        downloadBlob(new Blob([JSON.stringify(res.manifest, null, 2)], { type: "application/json" }), `${baseName}.mp4.sync.json`);
        setResult({ bytes: res.bytes, saved: writable ? "Streamed straight to disk" : "Downloaded to your browser's folder" });
        setPhase("done");
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setPhase("config");
          return;
        }
        setError((e as Error).message || String(e));
        setPhase("error");
      }
    },
    [baseName, frames, settings, song, sync],
  );

  useEffect(() => {
    if (autoStart && !started.current && supported) {
      started.current = true;
      void run(false);
    }
  }, [autoStart, run, supported]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && phase !== "running") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, phase]);

  const ffmpeg = `ffmpeg -i ${baseName}.mp4 -itsoffset ${m.synchronization.midiToVideoOffsetSeconds.toFixed(6)} -i audio.wav -c:v copy -c:a aac -b:a 320k muxed.mp4`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => phase !== "running" && onClose()} />
      <div role="dialog" aria-modal aria-label="Export MP4" className="glass noise relative flex max-h-full w-full max-w-[880px] animate-pop-in flex-col overflow-hidden rounded-[28px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brass-300/60 to-transparent" />
        <header className="relative flex items-center gap-4 border-b border-white/[0.07] px-6 py-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-brass-500/50 bg-gradient-to-b from-brass-400/30 to-brass-700/10 text-brass-200 shadow-[0_0_30px_-8px_rgba(226,178,86,.6),inset_0_1px_0_rgba(255,226,160,.25)]">
            <Clapperboard size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="serif text-[26px] font-bold leading-none text-bone-50">Export MP4</h2>
            <p className="mt-1.5 text-[12px] text-bone-500">Deterministic, silent, frame-exact renderer · identical pixels to the screen</p>
          </div>
          {phase !== "running" && (
            <button className="btn btn-icon" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          )}
        </header>

        {phase === "config" && (
          <>
            <div className="scroll grid flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-[1.15fr_1fr]">
              <div className="space-y-4">
                <Section title="Resolution">
                  <Select<string> label="Resolution preset" className="w-full" value={isCustom ? "custom" : resKey} options={RESOLUTIONS} onChange={(v) => {
                    if (v === "custom") return;
                    const [w, h] = v.split("x").map(Number);
                    setSync((s) => ({ ...s, width: w, height: h }));
                  }} />
                  <div className={cn("mt-3 grid grid-cols-2 gap-3", !isCustom && "opacity-60")}>
                    <label className="block">
                      <span className="eyebrow mb-1.5 block">Width (px)</span>
                      <input className="field w-full" type="number" min={320} max={7680} step={2} value={sync.width} onChange={(e) => setSync((s) => ({ ...s, width: Math.max(320, Math.min(7680, +e.target.value || 1920)) }))} />
                    </label>
                    <label className="block">
                      <span className="eyebrow mb-1.5 block">Height (px)</span>
                      <input className="field w-full" type="number" min={240} max={4320} step={2} value={sync.height} onChange={(e) => setSync((s) => ({ ...s, height: Math.max(240, Math.min(4320, +e.target.value || 1080)) }))} />
                    </label>
                  </div>
                </Section>

                <Section title="Frame Rate & Sync Lead-in" hint="Constant frame rate, constant offset">
                  <Select<number> label="Frame rate" className="w-full" value={sync.fps} options={FPS} onChange={(v) => setSync((s) => ({ ...s, fps: v }))} />
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="eyebrow mb-1.5 block">Lead-in offset (s)</span>
                      <input className="field w-full" type="number" min={0} max={30} step={0.5} value={sync.leadInSeconds} onChange={(e) => setSync((s) => ({ ...s, leadInSeconds: Math.max(0, Math.min(30, +e.target.value || 0)) }))} />
                    </label>
                    <label className="block">
                      <span className="eyebrow mb-1.5 block">Tail-out (s)</span>
                      <input className="field w-full" type="number" min={0} max={30} step={0.5} value={sync.tailOutSeconds} onChange={(e) => setSync((s) => ({ ...s, tailOutSeconds: Math.max(0, Math.min(30, +e.target.value || 0)) }))} />
                    </label>
                  </div>
                  <Segmented<number>
                    className="mt-3 w-full [&>button]:flex-1 [&>button]:justify-center"
                    value={sync.leadInSeconds === 0 ? 0 : sync.leadInSeconds === 2 ? 2 : -1}
                    onChange={(v) => setSync((s) => ({ ...s, leadInSeconds: v }))}
                    options={[
                      { value: 0, label: "0.0s · direct 1:1 layover" },
                      { value: 2, label: "2.0s · visual lead-in" },
                    ]}
                  />
                </Section>

                <Section title="Quality Profile">
                  <div className="space-y-1.5">
                    {PROFILES.map((p) => {
                      const on = sync.qualityProfile === p.id;
                      return (
                        <button key={p.id} onClick={() => setSync((s) => ({ ...s, qualityProfile: p.id }))} aria-pressed={on} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all", on ? "border-brass-500/70 bg-brass-500/[0.12] shadow-[0_0_24px_-10px_rgba(226,178,86,.7)]" : "border-white/[0.06] bg-black/20 hover:border-white/20")}>
                          <span className={cn("h-4 w-4 flex-none rounded-full border-2", on ? "border-brass-300 bg-brass-400 shadow-[0_0_10px_#e2b256]" : "border-white/20")} />
                          <span className="min-w-0 flex-1">
                            <span className={cn("block text-[12.5px] font-semibold", on ? "text-brass-200" : "text-bone-100")}>{p.title}</span>
                            <span className="block text-[11px] leading-snug text-bone-500">{p.sub}</span>
                          </span>
                          <span className="flex-none rounded-full border border-white/10 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-bone-400">{p.tag}</span>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              </div>

              <div className="space-y-4">
                <Section title="Sync Summary" right={<Shield size={16} className="text-verdi-400" />}>
                  <div className="divide-y divide-white/[0.05]">
                    <Stat accent label="Constant offset (t_video − t_midi)" value={`${m.synchronization.midiToVideoOffsetSeconds.toFixed(6)} s`} />
                    <Stat label="First note strike frame" value={`f#${m.synchronization.firstNoteVideoFrame}`} />
                    <Stat label="Exact frame count" value={frames.toLocaleString()} />
                    <Stat label="Video duration" value={formatTime(frames / sync.fps)} />
                    <Stat label="Estimated file size" value={`≈ ${fmtBytes(estimateBytes(song, sync))}`} />
                    <Stat label="Audio stream" value={<span className="inline-flex items-center gap-1.5 text-verdi-300"><VolumeX size={13} /> None · 0 tracks</span>} />
                    <Stat label="Manifest" value=".sync.json (auto-saved)" />
                  </div>
                </Section>

                <Section title="Automated Audio Layover" hint="Lay your rendered audio over the silent video with frame-exact alignment">
                  <div className="relative rounded-xl border border-white/[0.07] bg-black/40 p-3 pr-10">
                    <code className="block break-all font-mono text-[10.5px] leading-relaxed text-brass-200/90">{ffmpeg}</code>
                    <button
                      className="btn btn-icon btn-sm absolute right-2 top-2 !h-7 !w-7"
                      title="Copy command"
                      onClick={() => {
                        void navigator.clipboard?.writeText(ffmpeg);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1400);
                      }}
                    >
                      {copied ? <Check size={13} className="text-verdi-300" /> : <Copy size={13} />}
                    </button>
                  </div>
                </Section>

                {!supported && (
                  <div className="flex gap-3 rounded-2xl border border-red-400/30 bg-red-500/10 p-3.5 text-[12px] text-red-100">
                    <AlertTriangle size={18} className="mt-0.5 flex-none text-red-300" />
                    <p>WebCodecs isn’t available in this browser. Open Clavier in a current Chrome, Edge or Safari to render MP4 files.</p>
                  </div>
                )}
                <p className="flex gap-2 px-1 text-[11px] leading-relaxed text-bone-500">
                  <Volume2 size={13} className="mt-0.5 flex-none" />
                  <span>
                    Browser WebCodecs always encode 4:2:0 H.264. For mathematically bit-exact RGB, use the bundled <span className="font-mono text-bone-300">render_midi.py</span> CLI.
                  </span>
                </p>
              </div>
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-white/[0.07] bg-black/20 px-6 py-4">
              <div className="text-[12px] text-bone-500">
                <span className="font-semibold text-bone-200">{song.name.split(" — ")[0]}</span> · {sync.width}×{sync.height} @ {sync.fps} fps
              </div>
              <div className="flex gap-2.5">
                <button className="btn" onClick={onClose}>Cancel</button>
                <button className="btn btn-brass !h-10 !px-5 text-[13.5px]" disabled={!supported} onClick={() => void run(true)}>
                  <Film size={16} /> Render {frames.toLocaleString()} frames
                </button>
              </div>
            </footer>
          </>
        )}

        {phase === "running" && prog && (
          <div className="flex flex-col items-center gap-5 px-8 py-10">
            <Ring pct={prog.pct} />
            <div className="text-center">
              <div className="serif text-[24px] font-bold text-bone-50">
                {prog.phase === "preparing" ? "Preparing encoder…" : prog.phase === "finalizing" ? "Finalizing container…" : "Rendering frames"}
              </div>
              <p className="mt-1 text-[12px] text-bone-500">Keep this tab in the foreground for the fastest render.</p>
            </div>
            <div className="h-2.5 w-full max-w-[560px] overflow-hidden rounded-full border border-white/[0.08] bg-black/50">
              <div className="progress-sheen h-full animate-shimmer rounded-full" style={{ width: `${prog.pct}%`, transition: "width .2s" }} />
            </div>
            <div className="grid w-full max-w-[560px] grid-cols-3 gap-3">
              {[
                ["Frame", `${prog.frame.toLocaleString()} / ${prog.total.toLocaleString()}`],
                ["Render speed", prog.fps ? `${prog.fps.toFixed(0)} fps` : "—"],
                ["Time left", fmtEta(prog.etaSeconds)],
              ].map(([k, v]) => (
                <div key={k} className="card rounded-xl px-3 py-2.5 text-center">
                  <div className="eyebrow !text-[9px]">{k}</div>
                  <div className="tabular mt-1 text-[14px] font-semibold text-bone-50">{v}</div>
                </div>
              ))}
            </div>
            <button className="btn btn-danger" onClick={() => abort.current?.abort()}>
              <X size={14} /> Cancel render
            </button>
          </div>
        )}

        {phase === "done" && result && (
          <div className="flex flex-col items-center gap-4 px-8 py-12 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-verdi-400/50 bg-verdi-400/10 text-verdi-300 shadow-[0_0_40px_-6px_rgba(89,196,168,.6)]">
              <Check size={38} strokeWidth={2.5} />
            </div>
            <h3 className="serif text-[30px] font-bold text-bone-50">Render complete</h3>
            <p className="max-w-[460px] text-[13px] leading-relaxed text-bone-400">
              {frames.toLocaleString()} frames · {sync.width}×{sync.height} @ {sync.fps} fps · {result.bytes ? fmtBytes(result.bytes) : "saved"}. {result.saved}. The <span className="font-mono text-bone-200">.sync.json</span> manifest was saved alongside it.
            </p>
            <button className="btn btn-brass !h-10 !px-6" onClick={onClose}>Done</button>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-4 px-8 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-red-400/40 bg-red-500/10 text-red-300">
              <AlertTriangle size={30} />
            </div>
            <h3 className="serif text-[26px] font-bold text-bone-50">The render couldn’t finish</h3>
            <p className="max-w-[520px] rounded-xl border border-white/[0.07] bg-black/40 p-3 font-mono text-[11.5px] text-red-200/90">{error}</p>
            <div className="flex gap-2.5">
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn btn-brass" onClick={() => setPhase("config")}>
                <Loader2 size={14} /> Back to settings
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
