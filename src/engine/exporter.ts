import { ArrayBufferTarget, FileSystemWritableFileStreamTarget, Muxer } from "mp4-muxer";
import type { Song } from "./midi";
import { drawFrame } from "./renderer";
import { buildManifest, midiTimeOfFrame, totalFrames, type SyncManifest } from "./sync";
import type { RenderSettings, SyncConfig } from "./types";

export interface ExportProgress {
  frame: number;
  total: number;
  pct: number;
  fps: number; // render speed
  etaSeconds: number;
  phase: "preparing" | "rendering" | "finalizing" | "done";
}

export interface ExportOptions {
  song: Song;
  settings: RenderSettings;
  sync: SyncConfig;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
  writable?: FileSystemWritableFileStream;
}

export interface ExportResult {
  blob: Blob | null;
  manifest: SyncManifest;
  bytes: number;
}

export function webCodecsAvailable() {
  return typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
}

const BITRATE_FACTOR = { "rgb-lossless": 0.7, "yuv444-lossless": 0.55, "compatible-lossless": 0.28 } as const;

export function estimateBytes(song: Song, sync: SyncConfig) {
  const bits = bitrateFor(sync);
  const dur = totalFrames(song, sync) / sync.fps;
  return (bits * dur * 0.35) / 8; // scenes are mostly static, rate control rarely hits the cap
}

function bitrateFor(sync: SyncConfig) {
  const raw = sync.width * sync.height * sync.fps * BITRATE_FACTOR[sync.qualityProfile];
  return Math.round(Math.min(240e6, Math.max(8e6, raw)));
}

async function pickConfig(sync: SyncConfig): Promise<VideoEncoderConfig> {
  const codecs = ["avc1.640034", "avc1.640033", "avc1.64002a", "avc1.640028", "avc1.64001f", "avc1.4d0028", "avc1.42001f"];
  for (const codec of codecs) {
    for (const hw of ["prefer-hardware", "no-preference"] as const) {
      const cfg: VideoEncoderConfig = {
        codec,
        width: sync.width,
        height: sync.height,
        bitrate: bitrateFor(sync),
        framerate: sync.fps,
        latencyMode: "quality",
        hardwareAcceleration: hw,
        avc: { format: "avc" },
      };
      try {
        const r = await VideoEncoder.isConfigSupported(cfg);
        if (r.supported) return cfg;
      } catch {
        /* try next */
      }
    }
  }
  throw new Error("No supported H.264 encoder configuration was found for this resolution / frame-rate in this browser.");
}

export async function exportMp4(opts: ExportOptions): Promise<ExportResult> {
  const { song, settings, signal, onProgress } = opts;
  const sync: SyncConfig = { ...opts.sync, width: opts.sync.width & ~1, height: opts.sync.height & ~1 };
  if (!webCodecsAvailable()) throw new Error("WebCodecs (VideoEncoder) is not available in this browser. Use a recent Chrome, Edge or Safari.");
  const manifest = buildManifest(song, sync);
  const total = totalFrames(song, sync);
  onProgress?.({ frame: 0, total, pct: 0, fps: 0, etaSeconds: 0, phase: "preparing" });

  const cfg = await pickConfig(sync);
  const target = opts.writable ? new FileSystemWritableFileStreamTarget(opts.writable) : new ArrayBufferTarget();
  const muxer = new Muxer({
    target: target as ArrayBufferTarget,
    video: { codec: "avc", width: sync.width, height: sync.height, frameRate: sync.fps },
    fastStart: opts.writable ? false : "in-memory",
    firstTimestampBehavior: "offset",
  });
  let encError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encError = e instanceof Error ? e : new Error(String(e))),
  });
  encoder.configure(cfg);

  const canvas = document.createElement("canvas");
  canvas.width = sync.width;
  canvas.height = sync.height;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const frameDur = Math.round(1e6 / sync.fps);
  const t0 = performance.now();
  const keyEvery = Math.max(1, Math.round(sync.fps * 2));

  try {
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
      if (encError) throw encError;
      drawFrame(ctx, song, midiTimeOfFrame(i, sync), settings, { width: sync.width, height: sync.height, dpr: 1, hitEps: 0.5 / sync.fps });
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / sync.fps), duration: frameDur });
      encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      if (i % 5 === 0 || i === total - 1) {
        const el = (performance.now() - t0) / 1000;
        const fps = (i + 1) / Math.max(0.001, el);
        onProgress?.({ frame: i + 1, total, pct: ((i + 1) / total) * 100, fps, etaSeconds: (total - i - 1) / Math.max(1, fps), phase: "rendering" });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.({ frame: total, total, pct: 100, fps: 0, etaSeconds: 0, phase: "finalizing" });
    await encoder.flush();
    if (encError) throw encError;
    muxer.finalize();
    encoder.close();
  } catch (e) {
    try {
      encoder.close();
    } catch {
      /* already closed */
    }
    if (opts.writable) {
      try {
        await opts.writable.abort();
      } catch {
        /* ignore */
      }
    }
    throw e;
  }
  let blob: Blob | null = null;
  let bytes = 0;
  if (opts.writable) {
    await opts.writable.close();
  } else {
    const buf = (target as ArrayBufferTarget).buffer;
    bytes = buf.byteLength;
    blob = new Blob([buf], { type: "video/mp4" });
  }
  onProgress?.({ frame: total, total, pct: 100, fps: 0, etaSeconds: 0, phase: "done" });
  return { blob, manifest, bytes };
}

/** Same as exportMp4 but also fires `clavier-export-progress` / `clavier-export-complete` DOM events for automation. */
export async function exportWithEvents(opts: ExportOptions): Promise<ExportResult> {
  const res = await exportMp4({
    ...opts,
    onProgress: (p) => {
      opts.onProgress?.(p);
      window.dispatchEvent(new CustomEvent("clavier-export-progress", { detail: p }));
    },
  });
  window.dispatchEvent(new CustomEvent("clavier-export-complete", { detail: { manifest: res.manifest, bytes: res.bytes } }));
  return res;
}
