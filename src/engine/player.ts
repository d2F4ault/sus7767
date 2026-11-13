import { chordAt, formatTime, measureAt, pedalAt, tempoAt, type Chord, type Song } from "./midi";
import { drawFrame } from "./renderer";
import { frameOfMidiTime, midiTimeOfFrame, totalFrames } from "./sync";
import type { RenderSettings, SyncConfig } from "./types";
import { DEFAULT_SETTINGS, DEFAULT_SYNC } from "./types";

export interface PlayerSnapshot {
  t: number;
  playing: boolean;
  bpm: number;
  chord: Chord | null;
  measure: number;
  pedal: boolean;
  frame: number;
}

export interface LoopState {
  on: boolean;
  start: number;
  end: number;
}

/** Owns the transport clock and the live canvas. React reads it through subscribe()/getSnapshot(). */
export class Player {
  song: Song;
  settings: RenderSettings = DEFAULT_SETTINGS;
  sync: SyncConfig = DEFAULT_SYNC;
  t = 0;
  playing = false;
  speed = 1;
  loop: LoopState = { on: false, start: 1, end: 4 };
  practice = false;

  private canvas: HTMLCanvasElement | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private dirty = true;
  private lastEmit = 0;
  private listeners = new Set<() => void>();
  snapshot: PlayerSnapshot;

  constructor(song: Song) {
    this.song = song;
    this.t = -this.sync.leadInSeconds;
    this.snapshot = this.makeSnapshot();
    this.loopFn = this.loopFn.bind(this);
    this.raf = requestAnimationFrame(this.loopFn);
  }

  /* ---- react binding ---- */
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  getSnapshot = () => this.snapshot;

  private makeSnapshot(): PlayerSnapshot {
    const t = this.t;
    return {
      t,
      playing: this.playing,
      bpm: tempoAt(this.song, Math.max(0, t)).bpm,
      chord: chordAt(this.song, t),
      measure: measureAt(this.song, t),
      pedal: pedalAt(this.song, t),
      frame: frameOfMidiTime(t, this.sync),
    };
  }
  private emit() {
    this.snapshot = this.makeSnapshot();
    this.lastEmit = performance.now();
    this.listeners.forEach((l) => l());
  }

  /* ---- configuration ---- */
  attach(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.dirty = true;
  }
  setSize(w: number, h: number, dpr: number) {
    this.w = Math.max(320, Math.round(w));
    this.h = Math.max(200, Math.round(h));
    this.dpr = dpr;
    if (this.canvas) {
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
    }
    this.dirty = true;
  }
  setSong(song: Song) {
    this.song = song;
    this.playing = false;
    this.t = -this.sync.leadInSeconds;
    this.dirty = true;
    this.emit();
  }
  configure(settings: RenderSettings, sync: SyncConfig) {
    const leadChanged = sync.leadInSeconds !== this.sync.leadInSeconds;
    this.settings = settings;
    this.sync = sync;
    if (leadChanged && !this.playing && this.t < 0) this.t = -sync.leadInSeconds;
    this.dirty = true;
    this.emit();
  }
  refresh() {
    this.dirty = true;
    this.emit();
  }

  /* ---- transport ---- */
  play() {
    if (this.playing) return;
    const end = this.song.duration + this.sync.tailOutSeconds;
    if (this.t >= end - 0.01) this.t = -this.sync.leadInSeconds;
    this.playing = true;
    this.last = performance.now();
    this.emit();
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    this.dirty = true;
    this.emit();
  }
  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
  seek(t: number) {
    const end = this.song.duration + this.sync.tailOutSeconds;
    this.t = Math.max(-this.sync.leadInSeconds, Math.min(end, t));
    this.dirty = true;
    this.emit();
  }
  seekFrame(frame: number) {
    this.pause();
    const f = Math.max(0, Math.min(totalFrames(this.song, this.sync) - 1, frame));
    this.seek(midiTimeOfFrame(f, this.sync));
  }
  stepFrames(n: number) {
    this.pause();
    const f = frameOfMidiTime(this.t, this.sync) + n;
    this.seekFrame(f);
  }
  stepNote(dir: 1 | -1) {
    this.pause();
    const ns = this.song.notes;
    const cur = this.t;
    if (dir === 1) {
      for (const n of ns) if (n.start > cur + 0.002) return this.seekFrame(frameOfMidiTime(n.start, this.sync));
    } else {
      for (let i = ns.length - 1; i >= 0; i--) if (ns[i].start < cur - 0.002) return this.seekFrame(frameOfMidiTime(ns[i].start, this.sync));
    }
  }
  restart() {
    this.pause();
    this.seek(-this.sync.leadInSeconds);
  }
  setSpeed(v: number) {
    this.speed = v;
  }
  setLoop(l: LoopState) {
    this.loop = l;
  }
  setPractice(v: boolean) {
    this.practice = v;
  }

  /* ---- drawing ---- */
  drawNow(ctx?: CanvasRenderingContext2D) {
    const c = ctx ?? this.canvas?.getContext("2d");
    if (!c || !this.w) return;
    drawFrame(c, this.song, this.t, this.settings, { width: this.w, height: this.h, dpr: this.dpr, hitEps: 0.5 / this.sync.fps });
    this.dirty = false;
  }
  getCanvas() {
    return this.canvas;
  }

  private loopFn(now: number) {
    this.raf = requestAnimationFrame(this.loopFn);
    if (this.playing) {
      const dt = Math.min(0.1, ((now - this.last) / 1000) * this.speed);
      this.last = now;
      let nt = this.t + dt;
      const song = this.song;
      const end = song.duration + this.sync.tailOutSeconds;
      if (this.loop.on && song.measures.length) {
        const a = song.measures[Math.max(0, Math.min(song.measures.length - 1, this.loop.start - 1))];
        const b = song.measures[this.loop.end]; // start of the measure after the loop end
        const aT = a.time;
        const bT = b ? b.time : song.duration;
        if (nt >= bT) nt = aT;
      }
      if (this.practice) {
        for (const n of song.notes) {
          if (n.start <= this.t + 1e-4) continue;
          if (n.start <= nt + 1e-4) {
            this.t = n.start;
            this.playing = false;
            this.dirty = true;
            this.emit();
            break;
          }
          break;
        }
      }
      if (this.playing) {
        if (nt >= end) {
          this.t = end;
          this.playing = false;
          this.dirty = true;
          this.emit();
        } else {
          this.t = nt;
          this.dirty = true;
          if (now - this.lastEmit > 66) this.emit();
        }
      }
    }
    if (this.dirty) this.drawNow();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.listeners.clear();
  }
}

export { formatTime };
