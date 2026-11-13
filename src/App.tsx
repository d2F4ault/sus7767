import { AlertTriangle, FileMusic, Minimize2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { exportWithEvents } from "./engine/exporter";
import { analyseSong, base64ToBytes, type Song, type TrackHand } from "./engine/midi";
import { Player } from "./engine/player";
import { loadBuiltIn, loadCustom } from "./engine/songs";
import { buildManifest, downloadBlob } from "./engine/sync";
import { DEFAULT_SETTINGS, DEFAULT_SYNC, type ColorMode, type KeyLabelMode, type NoteLabelMode, type RenderSettings, type SyncConfig } from "./engine/types";
import { ExportModal } from "./ui/ExportModal";
import { Header, Transport, type PanelId } from "./ui/chrome";
import { RepertoirePanel, StudyPanel, SyncPanel, TracksPanel } from "./ui/panels";

function initialSong(id: string | null): Song {
  try {
    return loadBuiltIn(id ?? "bach_846");
  } catch {
    return loadBuiltIn("bach_846");
  }
}

function Stage({ player }: { player: Player }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    player.attach(canvas.current);
    const measure = () => {
      const r = wrap.current!.getBoundingClientRect();
      player.setSize(r.width, r.height, Math.min(2, window.devicePixelRatio || 1));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(wrap.current!);
    measure();
    return () => {
      ro.disconnect();
      player.attach(null);
    };
  }, [player]);
  return (
    <div ref={wrap} className="absolute inset-0 overflow-hidden bg-ink-950">
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

const SAVED_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

export default function App() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [song, setSong] = useState<Song>(() => initialSong(params.get("song")));
  const [rev, setRev] = useState(0);
  const [settings, setSettings] = useState<RenderSettings>(() => {
    const s = { ...DEFAULT_SETTINGS };
    const cm = params.get("colormode") as ColorMode | null;
    if (cm && ["hand", "finger", "pitch", "colorblind", "monochrome"].includes(cm)) s.colorMode = cm;
    const nl = params.get("notelabel") as NoteLabelMode | null;
    if (nl && ["fingering", "noteName", "solfege", "scaleDegree", "none"].includes(nl)) s.noteLabelMode = nl;
    const kl = params.get("keylabel") as KeyLabelMode | null;
    if (kl && ["onlyC", "allWhite", "all88", "solfege", "none"].includes(kl)) s.keyLabelMode = kl;
    if (params.get("autozoom") === "1") s.autoZoomRange = true;
    return s;
  });
  const [sync, setSync] = useState<SyncConfig>(() => {
    const n = (k: string, d: number) => {
      const v = parseFloat(params.get(k) ?? "");
      return isFinite(v) && v >= 0 ? v : d;
    };
    return { ...DEFAULT_SYNC, fps: n("fps", 60) || 60, width: n("width", 1920) || 1920, height: n("height", 1080) || 1080, leadInSeconds: n("leadin", 2) };
  });
  const [panel, setPanel] = useState<PanelId>("none");
  const [zen, setZen] = useState(params.get("zen") === "1");
  const [exportOpen, setExportOpen] = useState(params.get("autoexport") === "1");
  const [speed, setSpeed] = useState(1);
  const [practice, setPractice] = useState(false);
  const [loop, setLoop] = useState({ on: false, start: 1, end: 4 });
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const playerRef = useRef<Player | null>(null);
  if (!playerRef.current) playerRef.current = new Player(song);
  const player = playerRef.current;
  const snap = useSyncExternalStore(player.subscribe, player.getSnapshot);

  const live = useRef({ song, settings, sync });
  live.current = { song, settings, sync };

  /* --- push React state into the player --- */
  useEffect(() => player.configure(settings, sync), [player, settings, sync]);
  useEffect(() => player.setSpeed(speed), [player, speed]);
  useEffect(() => player.setPractice(practice), [player, practice]);
  useEffect(() => player.setLoop({ ...loop, end: Math.min(Math.max(loop.start, loop.end), song.measures.length) }), [player, loop, song]);

  /* --- fonts must be ready before the canvas can use them --- */
  useEffect(() => {
    const fonts = ["600 12px Inter", "700 12px Inter", "500 12px Inter", "italic 700 20px Cormorant", "italic 600 20px Cormorant", "700 20px Cormorant"];
    void Promise.all(fonts.map((f) => document.fonts.load(f))).then(() => player.refresh());
  }, [player]);

  /* --- loading songs --- */
  const adopt = useCallback(
    (s: Song) => {
      setSong(s);
      setRev((r) => r + 1);
      setSettings((st) => ({ ...st, mutedTracks: [] }));
      setLoop({ on: false, start: 1, end: Math.min(4, s.measures.length) });
      player.setSong(s);
    },
    [player],
  );
  const selectBuiltIn = useCallback(
    (id: string) => {
      try {
        adopt(loadBuiltIn(id));
        setPanel("none");
      } catch (e) {
        setNotice((e as Error).message);
      }
    },
    [adopt],
  );
  const loadFile = useCallback(
    async (file: File) => {
      if (!/\.(mid|midi)$/i.test(file.name)) {
        setNotice(`“${file.name}” isn’t a .mid or .midi file.`);
        return;
      }
      try {
        adopt(loadCustom(new Uint8Array(await file.arrayBuffer()), file.name));
        setPanel("none");
      } catch (e) {
        setNotice(`Couldn’t read “${file.name}”: ${(e as Error).message}`);
      }
    },
    [adopt],
  );
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  /* --- drag & drop --- */
  useEffect(() => {
    let depth = 0;
    const over = (e: DragEvent) => e.preventDefault();
    const enter = (e: DragEvent) => {
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f) void loadFile(f);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [loadFile]);

  /* --- keyboard --- */
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return;
      if (el.getAttribute?.("role") === "slider" && (e.code === "ArrowLeft" || e.code === "ArrowRight")) return;
      if (exportOpen) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (el instanceof HTMLButtonElement) el.blur();
        player.toggle();
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (e.shiftKey) player.stepNote(1);
        else player.stepFrames(1);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (e.shiftKey) player.stepNote(-1);
        else player.stepFrames(-1);
      } else if (e.code === "KeyH") {
        e.preventDefault();
        setZen((z) => !z);
      } else if (e.code === "Home") {
        e.preventDefault();
        player.restart();
      } else if (e.code === "Escape") setPanel("none");
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [player, exportOpen]);

  /* --- hand reassignment --- */
  const onHand = useCallback(
    (track: number, hand: TrackHand) => {
      song.tracks[track].hand = hand;
      analyseSong(song);
      setRev((r) => r + 1);
      player.refresh();
    },
    [song, player],
  );

  /* --- automation surface: window.Clavier --- */
  useEffect(() => {
    const api = {
      isReady: () => true,
      seekToVideoFrame: (f: number) => {
        player.seekFrame(f);
        player.drawNow();
        return { frame: f, midiTime: player.t };
      },
      seekToMidiTime: (t: number) => {
        player.pause();
        player.seek(t);
        player.drawNow();
        return { midiTime: player.t };
      },
      getFramePixelsRGBA: () => {
        const c = player.getCanvas();
        const ctx = c?.getContext("2d");
        return c && ctx ? ctx.getImageData(0, 0, c.width, c.height).data : new Uint8ClampedArray(0);
      },
      getFrameDataUrl: (type = "image/png") => player.getCanvas()?.toDataURL(type) ?? "",
      getSyncManifest: () => buildManifest(live.current.song, live.current.sync),
      loadBuiltInSong: (id: string) => {
        selectBuiltIn(id);
        return true;
      },
      loadMidiBase64: (b64: string, name = "automated.mid") => {
        const s = loadCustom(base64ToBytes(b64), name);
        adopt(s);
        return buildManifest(s, live.current.sync);
      },
      loadMidiBytes: (bytes: Uint8Array, name = "automated.mid") => {
        const s = loadCustom(bytes, name);
        adopt(s);
        return buildManifest(s, live.current.sync);
      },
      setRenderConfig: (c: Partial<RenderSettings>) => setSettings((s) => ({ ...s, ...c })),
      setSyncConfig: (c: Partial<SyncConfig>) => setSync((s) => ({ ...s, ...c })),
      exportMp4: async (o: { fps?: number; width?: number; height?: number; leadInSeconds?: number; onProgress?: (pct: number, frame: number, total: number) => void } = {}) => {
        const cfg: SyncConfig = { ...live.current.sync, ...(o.fps && { fps: o.fps }), ...(o.width && { width: o.width }), ...(o.height && { height: o.height }), ...(o.leadInSeconds !== undefined && { leadInSeconds: o.leadInSeconds }) };
        const res = await exportWithEvents({ song: live.current.song, settings: live.current.settings, sync: cfg, onProgress: (p) => o.onProgress?.(p.pct, p.frame, p.total) });
        const base = live.current.song.fileName.replace(/\.(mid|midi)$/i, "");
        if (res.blob) downloadBlob(res.blob, `${base}.mp4`);
        return res.manifest;
      },
    };
    (window as unknown as Record<string, unknown>).Clavier = api;
    (window as unknown as Record<string, unknown>).MidianoAncientAPI = api;
  }, [player, adopt, selectBuiltIn]);

  const togglePanel = (p: PanelId) => setPanel((cur) => (cur === p ? "none" : p));

  return (
    <div className="app-bg relative flex h-full flex-col overflow-hidden">
      {!zen && (
        <Header
          song={song}
          settings={settings}
          setSettings={setSettings}
          panel={panel}
          togglePanel={togglePanel}
          onOpenFile={() => fileInput.current?.click()}
          onExport={() => setExportOpen(true)}
          onZen={() => setZen(true)}
        />
      )}

      <main className="relative min-h-0 flex-1">
        <Stage player={player} />

        {zen && (
          <button className="btn absolute right-3 top-3 z-40 !bg-[#15100c]/85 backdrop-blur" onClick={() => setZen(false)} title="Restore controls (H)">
            <Minimize2 size={14} className="text-brass-400" />
            Show studio bar
            <span className="kbd">H</span>
          </button>
        )}

        {!zen && panel === "repertoire" && <RepertoirePanel song={song} onSelect={selectBuiltIn} onOpenFile={() => fileInput.current?.click()} onClose={() => setPanel("none")} />}
        {!zen && panel === "tracks" && <TracksPanel song={song} rev={rev} settings={settings} setSettings={setSettings} onHand={onHand} loop={loop} setLoop={setLoop} onClose={() => setPanel("none")} />}
        {!zen && panel === "teaching" && <StudyPanel settings={settings} setSettings={setSettings} practice={practice} setPractice={setPractice} onClose={() => setPanel("none")} />}
        {!zen && panel === "syncInspector" && <SyncPanel song={song} sync={sync} t={snap.t} onSeekFrame={(f) => player.seekFrame(f)} onClose={() => setPanel("none")} />}

        {notice && (
          <div className="glass absolute left-1/2 top-4 z-40 flex max-w-[min(560px,92%)] -translate-x-1/2 animate-pop-in items-center gap-3 rounded-2xl border-red-400/30 px-4 py-3 text-[12.5px] text-red-100">
            <AlertTriangle size={17} className="flex-none text-red-300" />
            <span className="flex-1">{notice}</span>
            <button className="text-bone-400 hover:text-bone-50" onClick={() => setNotice(null)} aria-label="Dismiss">
              <X size={15} />
            </button>
          </div>
        )}

        {dragging && (
          <div className="absolute inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink-950/80 p-8 backdrop-blur-md">
            <div className="flex h-full max-h-[420px] w-full max-w-[760px] flex-col items-center justify-center gap-4 rounded-[32px] border-2 border-dashed border-brass-400/70 bg-brass-500/[0.06] shadow-[0_0_80px_-20px_rgba(226,178,86,.6)]">
              <FileMusic size={56} className="text-brass-300" strokeWidth={1.4} />
              <div className="serif text-[34px] font-bold text-bone-50">Drop to load your MIDI</div>
              <div className="text-[13px] text-bone-400">.mid and .midi files · everything stays in your browser</div>
            </div>
          </div>
        )}
      </main>

      {!zen && <Transport player={player} snap={snap} song={song} sync={sync} speed={speed} setSpeed={setSpeed} loopRange={loop} />}

      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void loadFile(f);
          e.target.value = "";
        }}
      />

      {exportOpen && <ExportModal song={song} settings={settings} sync={sync} setSync={setSync} autoStart={params.get("autoexport") === "1"} onClose={() => setExportOpen(false)} />}
    </div>
  );
}

void SAVED_SPEEDS;
