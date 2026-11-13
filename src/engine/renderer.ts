/* ------------------------------------------------------------------ *
 *  Clavier · 88-key canvas renderer
 *  Deterministic: the picture is a pure function of (song, t, settings).
 *  Used both for the live view and the frame-exact MP4 exporter.
 * ------------------------------------------------------------------ */
import {
  SOLFEGE,
  SOLFEGE_FLAT,
  chordAt,
  firstVisibleIndex,
  isBlack,
  measureAt,
  noteName,
  pedalAt,
  tempoAt,
  type Chord,
  type NoteEvent,
  type Song,
} from "./midi";
import type { ColorMode, RenderSettings } from "./types";

export const SERIF = '"Cormorant", "Iowan Old Style", "Palatino Linotype", Georgia, serif';
export const SANS = '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/* ------------------------------ canvas glue ------------------------------ */

type AnyCanvas = HTMLCanvasElement;
let canvasFactory: (w: number, h: number) => AnyCanvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
export function setCanvasFactory(f: (w: number, h: number) => AnyCanvas) {
  canvasFactory = f;
}

/* -------------------------------- colour -------------------------------- */

type RGB = [number, number, number];
const rgbCache = new Map<string, RGB>();
function toRgb(hex: string): RGB {
  let v = rgbCache.get(hex);
  if (!v) {
    const h = hex.replace("#", "");
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(hex, v);
  }
  return v;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function rgba(hex: string, a: number) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
const hx = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0");
function mix(a: string, b: string, t: number) {
  const A = toRgb(a);
  const B = toRgb(b);
  return `#${hx(A[0] + (B[0] - A[0]) * t)}${hx(A[1] + (B[1] - A[1]) * t)}${hx(A[2] + (B[2] - A[2]) * t)}`;
}
const shadeCache = new Map<string, string>();
function lighten(hex: string, amt: number) {
  const k = hex + "L" + amt;
  let v = shadeCache.get(k);
  if (!v) shadeCache.set(k, (v = mix(hex, "#ffffff", amt)));
  return v;
}
function darken(hex: string, amt: number) {
  const k = hex + "D" + amt;
  let v = shadeCache.get(k);
  if (!v) shadeCache.set(k, (v = mix(hex, "#000000", amt)));
  return v;
}
function luminance(hex: string) {
  const [r, g, b] = toRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

export const HAND_COLORS = { R: "#f2b84b", L: "#4fc4a8" };
export const FINGER_COLORS = ["#ffffff", "#ea695c", "#f0a24a", "#ebd46a", "#5bba8b", "#5b94d9"];
export const PITCH_COLORS = [
  "#e6604f",
  "#ee8046",
  "#f1a340",
  "#efc94b",
  "#d6dd58",
  "#90d05e",
  "#4fc18a",
  "#40bdb8",
  "#4a9cdc",
  "#6c80e1",
  "#9b6fe1",
  "#cd67c6",
];
export const COLORBLIND = { R: "#E69F00", L: "#56B4E9" };
export const MONO = { R: "#f1e8d4", L: "#a99e88" };

export function noteColor(n: NoteEvent, mode: ColorMode): string {
  switch (mode) {
    case "finger":
      return FINGER_COLORS[n.finger] ?? HAND_COLORS.R;
    case "pitch":
      return PITCH_COLORS[n.midi % 12];
    case "colorblind":
      return COLORBLIND[n.hand];
    case "monochrome":
      return MONO[n.hand];
    default:
      return HAND_COLORS[n.hand];
  }
}

/* --------------------------- keyboard geometry --------------------------- */

const WHITE_IDX: number[] = [];
{
  let w = 0;
  for (let k = 0; k < 88; k++) {
    if (isBlack(k + 21)) WHITE_IDX.push(w - 1);
    else WHITE_IDX.push(w++);
  }
}
const BLACK_OFFSET: Record<number, number> = { 1: -0.075, 3: 0.075, 6: -0.1, 8: 0, 10: 0.1 };

export interface Layout {
  W: number;
  H: number;
  u: number;
  laneH: number;
  railH: number;
  keysTop: number;
  keysH: number;
  frontY: number;
  frontH: number;
  miniY: number;
  miniH: number;
  lo: number;
  hi: number;
  wkw: number;
  bkw: number;
  bkh: number;
  x0: number;
  kx: Float64Array; // left x of every key (white) / black key body
  kw: Float64Array; // width of every key
  key: string;
}

function computeLayout(W: number, H: number, s: RenderSettings, song: Song): Layout {
  const u = clamp(H / 900, 0.85, 2.6);
  let lo = 0;
  let hi = 87;
  if (s.autoZoomRange) {
    lo = song.minKey;
    hi = song.maxKey;
    if (isBlack(lo + 21)) lo--;
    if (isBlack(hi + 21)) hi++;
    // at least ~3 octaves, rounded out to whole white keys
    while (hi - lo < 35) {
      if (lo > 0) lo--;
      if (hi < 87) hi++;
      if (lo === 0 && hi === 87) break;
    }
    while (lo > 0 && isBlack(lo + 21)) lo--;
    while (hi < 87 && isBlack(hi + 21)) hi++;
    lo = Math.max(0, lo - 1);
    hi = Math.min(87, hi + 1);
    while (lo > 0 && isBlack(lo + 21)) lo--;
    while (hi < 87 && isBlack(hi + 21)) hi++;
  }
  const w0 = WHITE_IDX[lo];
  const whiteCount = WHITE_IDX[hi] - w0 + 1;
  const wkw = W / whiteCount;
  const bkw = wkw * 0.6;
  const keysH = Math.round(clamp(H * s.pianoHeightRatio, 90 * u, H * 0.36));
  const bkh = keysH * 0.6643;
  const railH = Math.round(14 * u);
  const frontH = Math.round(7 * u);
  const miniH = s.showKeyMinimap ? Math.round(34 * u) : 0;
  const laneH = H - miniH - frontH - keysH - railH;
  const kx = new Float64Array(88);
  const kw = new Float64Array(88);
  for (let k = 0; k < 88; k++) {
    const midi = k + 21;
    if (isBlack(midi)) {
      const off = s.acousticBlackKeyOffsets ? (BLACK_OFFSET[midi % 12] ?? 0) : 0;
      const centre = (WHITE_IDX[k] + 1 - w0) * wkw + off * wkw;
      kw[k] = bkw;
      kx[k] = centre - bkw / 2;
    } else {
      kw[k] = wkw;
      kx[k] = (WHITE_IDX[k] - w0) * wkw;
    }
  }
  return {
    W,
    H,
    u,
    laneH,
    railH,
    keysTop: laneH + railH,
    keysH,
    frontY: laneH + railH + keysH,
    frontH,
    miniY: H - miniH,
    miniH,
    lo,
    hi,
    wkw,
    bkw,
    bkh,
    x0: 0,
    kx,
    kw,
    key: `${W}x${H}|${lo}-${hi}|${s.pianoHeightRatio}|${s.showKeyMinimap}|${s.acousticBlackKeyOffsets}|${s.showKeyLaneGuides}`,
  };
}

/* ------------------------------ drawing helpers ------------------------------ */

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}
/** rect with only the bottom corners rounded */
function rrBottom(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.closePath();
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${px}px`;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, m) + "…").width <= maxW) lo = m;
    else hi = m - 1;
  }
  return text.slice(0, Math.max(1, lo)).trimEnd() + "…";
}

// seeded hash → [0,1)
function hash(n: number) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  x -= Math.floor(x);
  return x;
}

/* -------------------------------- textures -------------------------------- */

let feltPattern: CanvasPattern | null = null;
let woodPattern: CanvasPattern | null = null;
function getFelt(ctx: CanvasRenderingContext2D) {
  if (feltPattern) return feltPattern;
  const c = canvasFactory(96, 96);
  const g = c.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, 96, 96);
  const img = g.getImageData(0, 0, 96, 96);
  for (let i = 0; i < 96 * 96; i++) {
    const v = hash(i * 1.37) * 90 + (i % 96 % 2 === 0 ? 10 : 0);
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v * 0.9;
    img.data[i * 4 + 2] = v * 0.9;
    img.data[i * 4 + 3] = 70;
  }
  g.putImageData(img, 0, 0);
  feltPattern = ctx.createPattern(c, "repeat");
  return feltPattern;
}
function getWood(ctx: CanvasRenderingContext2D) {
  if (woodPattern) return woodPattern;
  const c = canvasFactory(256, 32);
  const g = c.getContext("2d")!;
  for (let y = 0; y < 32; y++) {
    const a = 0.05 + hash(y * 3.1) * 0.12;
    g.fillStyle = hash(y * 9.7) > 0.5 ? `rgba(255,205,140,${a * 0.6})` : `rgba(0,0,0,${a})`;
    g.fillRect(0, y, 256, 1);
  }
  woodPattern = ctx.createPattern(c, "repeat");
  return woodPattern;
}

/* --------------------------- static background cache --------------------------- */

interface StaticCache {
  key: string;
  dpr: number;
  canvas: AnyCanvas;
}
const bgCaches = new Map<string, StaticCache>();

function buildBackground(L: Layout, s: RenderSettings, dpr: number): AnyCanvas {
  const c = canvasFactory(Math.max(1, Math.round(L.W * dpr)), Math.max(1, Math.round(L.laneH * dpr)));
  const g = c.getContext("2d")!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { W, laneH: h, u } = L;
  // base
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#080605");
  grad.addColorStop(0.5, "#100b08");
  grad.addColorStop(1, "#1b130d");
  g.fillStyle = grad;
  g.fillRect(0, 0, W, h);
  // warm lamp glow from the keyboard
  const rg = g.createRadialGradient(W / 2, h, 0, W / 2, h, Math.max(W, h) * 0.75);
  rg.addColorStop(0, "rgba(214,150,72,0.13)");
  rg.addColorStop(0.5, "rgba(160,96,44,0.04)");
  rg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rg;
  g.fillRect(0, 0, W, h);
  // black key lanes (darker columns)
  for (let k = L.lo; k <= L.hi; k++) {
    if (!isBlack(k + 21)) continue;
    const lg = g.createLinearGradient(L.kx[k], 0, L.kx[k] + L.kw[k], 0);
    lg.addColorStop(0, "rgba(0,0,0,0.34)");
    lg.addColorStop(0.5, "rgba(0,0,0,0.22)");
    lg.addColorStop(1, "rgba(0,0,0,0.34)");
    g.fillStyle = lg;
    g.fillRect(L.kx[k], 0, L.kw[k], h);
  }
  // white-key lane alternation (very subtle) – improves tracking of columns
  for (let k = L.lo; k <= L.hi; k++) {
    if (isBlack(k + 21)) continue;
    if (WHITE_IDX[k] % 2 === 0) {
      g.fillStyle = "rgba(255,226,170,0.012)";
      g.fillRect(L.kx[k], 0, L.kw[k], h);
    }
  }
  // lane rules: strong at C, soft at F
  if (s.showKeyLaneGuides) {
    for (let k = L.lo; k <= L.hi; k++) {
      const pc = (k + 21) % 12;
      if (pc !== 0 && pc !== 5) continue;
      const x = Math.round(L.kx[k]) + 0.5;
      const isC = pc === 0;
      const lg = g.createLinearGradient(0, 0, 0, h);
      lg.addColorStop(0, isC ? "rgba(236,200,138,0.04)" : "rgba(236,200,138,0.015)");
      lg.addColorStop(1, isC ? "rgba(236,200,138,0.30)" : "rgba(236,200,138,0.11)");
      g.strokeStyle = lg;
      g.lineWidth = isC ? Math.max(1, 1.3 * u) : Math.max(1, 0.9 * u);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
  }
  // vignette top & sides
  const vt = g.createLinearGradient(0, 0, 0, h * 0.32);
  vt.addColorStop(0, "rgba(0,0,0,0.62)");
  vt.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = vt;
  g.fillRect(0, 0, W, h * 0.32);
  const vs = g.createLinearGradient(0, 0, W, 0);
  vs.addColorStop(0, "rgba(0,0,0,0.42)");
  vs.addColorStop(0.12, "rgba(0,0,0,0)");
  vs.addColorStop(0.88, "rgba(0,0,0,0)");
  vs.addColorStop(1, "rgba(0,0,0,0.42)");
  g.fillStyle = vs;
  g.fillRect(0, 0, W, h);
  return c;
}

/* -------------------------------- labels -------------------------------- */

const DEGREES = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];
function noteLabel(n: NoteEvent, s: RenderSettings, song: Song): string {
  switch (s.noteLabelMode) {
    case "fingering":
      return String(n.finger);
    case "noteName":
      return noteName(n.midi, s.useFlats, false);
    case "solfege":
      return (s.useFlats ? SOLFEGE_FLAT : SOLFEGE)[n.midi % 12];
    case "scaleDegree": {
      const tonic = (((7 * song.keySig.sharps) % 12) + 12) % 12;
      const t = song.keySig.minor ? (tonic + 9) % 12 : tonic;
      return DEGREES[(n.midi - t + 120) % 12];
    }
    default:
      return "";
  }
}

/* --------------------------------- frame --------------------------------- */

export interface FrameOptions {
  width: number; // logical px
  height: number;
  dpr: number;
  hitEps?: number; // strike tolerance in seconds (half a video frame when exporting)
}

export interface FrameStats {
  bpm: number;
  chord: Chord | null;
  measure: number;
  pedal: boolean;
  active: number;
}

interface KeyState {
  press: number;
  color: string;
  vel: number;
  start: number;
}

const FILTER_EMPTY: number[] = [];

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  song: Song,
  t: number,
  s: RenderSettings,
  o: FrameOptions,
): FrameStats {
  const { width: W, height: H, dpr } = o;
  const eps = o.hitEps ?? 0.004;
  const L = computeLayout(W, H, s, song);
  const { u, laneH, railH } = L;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";

  /* background */
  const bgKey = `${L.key}@${dpr}`;
  let bg = bgCaches.get(bgKey);
  if (!bg) {
    if (bgCaches.size >= 4) bgCaches.delete(bgCaches.keys().next().value as string);
    bgCaches.set(bgKey, (bg = { key: L.key, dpr, canvas: buildBackground(L, s, dpr) }));
  }
  ctx.drawImage(bg.canvas, 0, 0, W, laneH);

  const fall = s.noteFallSeconds;
  const yOf = (time: number) => laneH - ((time - t) / fall) * laneH;
  const muted = s.mutedTracks.length ? new Set(s.mutedTracks) : null;
  const handOk = (n: NoteEvent) =>
    (s.activeHandFilter === "both" || (s.activeHandFilter === "right" ? n.hand === "R" : n.hand === "L")) && !(muted && muted.has(n.track));

  /* ambient dust */
  if (s.ambientDust) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 54; i++) {
      const sp = 0.012 + hash(i * 5.3) * 0.03;
      const x = (hash(i * 1.7) * W + Math.sin(t * (0.2 + hash(i) * 0.3) + i) * 26 * u + W) % W;
      const y = (((hash(i * 3.9) - t * sp) % 1) + 1) % 1 * laneH;
      const r = (0.5 + hash(i * 8.1) * 1.4) * u;
      const a = (0.1 + 0.25 * (0.5 + 0.5 * Math.sin(t * (0.6 + hash(i * 2.2)) + i * 3))) * clamp((laneH - y) / (laneH * 0.4) + 0.2, 0, 1);
      const dg = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      dg.addColorStop(0, `rgba(255,214,150,${a})`);
      dg.addColorStop(1, "rgba(255,214,150,0)");
      ctx.fillStyle = dg;
      ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }
    ctx.restore();
  }

  /* pedal resonance wash */
  const pedal = pedalAt(song, t);
  if (pedal && s.showSustainPedal) {
    const pg = ctx.createLinearGradient(0, laneH * 0.55, 0, laneH);
    pg.addColorStop(0, "rgba(214,140,70,0)");
    pg.addColorStop(1, "rgba(214,140,70,0.10)");
    ctx.fillStyle = pg;
    ctx.fillRect(0, laneH * 0.55, W, laneH * 0.45);
  }

  /* measure & beat lines */
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, laneH);
  ctx.clip();
  const tTop = t + fall;
  if (s.showMeasureLines || s.showBeatLines) {
    const ms = song.measures;
    // binary search for first measure with time >= t - small
    let a = 0;
    let b = ms.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (ms[m].time < t - 1e-6) a = m + 1;
      else b = m;
    }
    ctx.textBaseline = "alphabetic";
    // include the beats of the previous measure that are still on screen
    const startI = Math.max(0, a - 1);
    for (let i = startI; i < ms.length; i++) {
      const m = ms[i];
      if (m.time > tTop && (m.beats[0] ?? Infinity) > tTop) break;
      if (s.showBeatLines) {
        for (const bt of m.beats) {
          if (bt < t || bt > tTop) continue;
          const y = Math.round(yOf(bt)) + 0.5;
          ctx.strokeStyle = "rgba(236,208,160,0.075)";
          ctx.lineWidth = Math.max(1, 0.9 * u);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
      }
      if (s.showMeasureLines && m.time >= t - 1e-6 && m.time <= tTop) {
        const y = Math.round(yOf(m.time)) + 0.5;
        const lg = ctx.createLinearGradient(0, 0, W, 0);
        lg.addColorStop(0, "rgba(238,206,146,0.34)");
        lg.addColorStop(0.5, "rgba(238,206,146,0.18)");
        lg.addColorStop(1, "rgba(238,206,146,0.34)");
        ctx.strokeStyle = lg;
        ctx.lineWidth = Math.max(1, 1.3 * u);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
        if (s.showMeasureNumbers) {
          ctx.font = `italic 600 ${Math.round(15 * u)}px ${SERIF}`;
          ctx.fillStyle = "rgba(240,212,158,0.62)";
          ctx.textAlign = "left";
          ctx.fillText(String(m.number), 12 * u, y - 5 * u);
        }
      }
    }
  }

  /* gather visible notes, key states */
  const keyState: (KeyState | null)[] = new Array(88).fill(null);
  const visible: NoteEvent[] = [];
  const incoming: NoteEvent[] = [];
  const startIdx = firstVisibleIndex(song, t - 0.12);
  const notes = song.notes;
  let activeCount = 0;
  for (let i = startIdx; i < notes.length; i++) {
    const n = notes[i];
    if (n.start > tTop) break;
    if (!handOk(n)) continue;
    visible.push(n);
    const sounding = n.start <= t + eps && t < n.visEnd;
    let press = 0;
    if (sounding) {
      press = clamp((t - n.start + eps) / 0.045, 0.0, 1);
      press = 1 - Math.pow(1 - Math.max(press, 0.18), 2);
      activeCount++;
    } else if (t >= n.visEnd && t < n.visEnd + 0.11) press = 1 - (t - n.visEnd) / 0.11;
    if (press > 0) {
      const prev = keyState[n.key];
      if (!prev || (sounding && n.start >= prev.start) || press > prev.press) {
        keyState[n.key] = { press: sounding ? press : Math.max(press, 0), color: noteColor(n, s.colorMode), vel: n.vel, start: n.start };
      }
    }
    if (n.start > t + eps && n.start <= t + s.incomingLookAheadSeconds) incoming.push(n);
  }

  /* sustain tails */
  if (s.showSustainTails && s.showSustainPedal) {
    for (const n of visible) {
      if (n.sustainEnd <= n.visEnd + 0.05) continue;
      const col = noteColor(n, s.colorMode);
      const yTop = yOf(n.sustainEnd);
      const yBot = yOf(n.visEnd);
      if (yBot < 0 || yTop > laneH) continue;
      const tw = Math.max(2 * u, L.kw[n.key] * 0.3);
      const x = L.kx[n.key] + (L.kw[n.key] - tw) / 2;
      const tg = ctx.createLinearGradient(0, yTop, 0, yBot);
      tg.addColorStop(0, rgba(col, 0));
      tg.addColorStop(1, rgba(col, 0.26));
      ctx.fillStyle = tg;
      rr(ctx, x, yTop, tw, Math.max(1, yBot - yTop), tw / 2);
      ctx.fill();
    }
  }

  /* chord brackets */
  if (s.showChordBrackets) {
    ctx.textAlign = "center";
    for (const c of song.chords) {
      if (c.start > tTop) break;
      if (c.start < t - 0.02 || c.end - c.start < 0.2) continue;
      const y = yOf(c.start);
      if (y + 30 * u > laneH || y < 20 * u) continue;
      const x1 = L.kx[c.keyLo];
      const x2 = L.kx[c.keyHi] + L.kw[c.keyHi];
      const by = y + 5 * u;
      ctx.strokeStyle = "rgba(244,224,180,0.55)";
      ctx.lineWidth = Math.max(1, 1.3 * u);
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(x1 + 2 * u, by - 4 * u);
      ctx.lineTo(x1 + 2 * u, by);
      ctx.lineTo(x2 - 2 * u, by);
      ctx.lineTo(x2 - 2 * u, by - 4 * u);
      ctx.stroke();
      const cx = (x1 + x2) / 2;
      ctx.font = `italic 700 ${Math.round(15 * u)}px ${SERIF}`;
      ctx.fillStyle = "rgba(250,232,196,0.92)";
      ctx.fillText(c.symbol, cx, by + 16 * u);
      if (c.roman) {
        ctx.font = `500 ${Math.round(9.5 * u)}px ${SANS}`;
        ctx.fillStyle = "rgba(226,204,160,0.6)";
        ctx.fillText(c.roman, cx, by + 28 * u);
      }
    }
  }

  /* falling notes */
  const gap = 1.6 * u;
  const radiusRatio = 0.22;
  const activeBeams: { x: number; w: number; col: string; vel: number; age: number; id: number }[] = [];
  for (const n of visible) {
    const col = noteColor(n, s.colorMode);
    const black = isBlack(n.midi);
    const kwid = L.kw[n.key];
    const nw = Math.max(2, kwid * (black ? 0.84 : 0.88));
    const x = L.kx[n.key] + (kwid - nw) / 2;
    const yb = yOf(n.start) - gap;
    let yt = yOf(n.visEnd);
    if (yb < 0 || yt > laneH) continue;
    if (yb - yt < 4 * u) yt = yb - 4 * u;
    const h = yb - yt;
    const active = n.start <= t + eps && t < n.visEnd;
    const r = Math.min(nw * radiusRatio, 9 * u, h / 2);
    const bright = 0.84 + 0.16 * (n.vel / 127);
    let base = black ? darken(col, 0.16) : col;
    if (bright < 1) base = darken(col, (1 - bright) * 0.5 + (black ? 0.16 : 0));

    ctx.save();
    if (active) {
      ctx.shadowColor = rgba(col, 0.75);
      ctx.shadowBlur = 20 * u;
    } else {
      // cheap soft glow
      ctx.fillStyle = rgba(col, 0.1);
      rr(ctx, x - 2 * u, yt - 2 * u, nw + 4 * u, h + 4 * u, r + 2 * u);
      ctx.fill();
    }
    const gr = ctx.createLinearGradient(0, yt, 0, yb);
    gr.addColorStop(0, lighten(base, active ? 0.34 : 0.2));
    gr.addColorStop(0.18, lighten(base, active ? 0.18 : 0.08));
    gr.addColorStop(0.75, base);
    gr.addColorStop(1, darken(base, 0.26));
    ctx.fillStyle = gr;
    rr(ctx, x, yt, nw, h, r);
    ctx.fill();
    ctx.restore();

    // bevel: left sheen, top rim, bottom edge
    ctx.save();
    rr(ctx, x, yt, nw, h, r);
    ctx.clip();
    const sh = ctx.createLinearGradient(x, 0, x + nw, 0);
    sh.addColorStop(0, "rgba(255,255,255,0.30)");
    sh.addColorStop(0.18, "rgba(255,255,255,0.06)");
    sh.addColorStop(0.7, "rgba(255,255,255,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.22)");
    ctx.fillStyle = sh;
    ctx.fillRect(x, yt, nw, h);
    // bottom (strike) edge flare
    const fh = Math.min(h, 16 * u);
    const fg = ctx.createLinearGradient(0, yb - fh, 0, yb);
    fg.addColorStop(0, "rgba(255,255,255,0)");
    fg.addColorStop(1, active ? "rgba(255,255,255,0.38)" : "rgba(255,255,255,0.12)");
    ctx.fillStyle = fg;
    ctx.fillRect(x, yb - fh, nw, fh);
    ctx.restore();
    ctx.lineWidth = Math.max(1, 1 * u);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    rr(ctx, x + 0.5, yt + 0.5, nw - 1, h - 1, Math.max(0, r - 0.5));
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    rr(ctx, x - 0.5, yt - 0.5, nw + 1, h + 1, r + 0.5);
    ctx.stroke();

    // label
    if (s.noteLabelMode !== "none") {
      const lab = noteLabel(n, s, song);
      const fs = clamp(nw * 0.5, 8 * u, 18 * u);
      if (lab && nw >= 11 * u * 0.9 && h >= fs * 1.4) {
        ctx.font = `700 ${Math.round(fs)}px ${SANS}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const dark = luminance(base) > 0.5;
        ctx.fillStyle = dark ? "rgba(30,16,4,0.9)" : "rgba(255,247,230,0.95)";
        if (!dark) {
          ctx.shadowColor = "rgba(0,0,0,0.45)";
          ctx.shadowBlur = 2 * u;
        }
        ctx.fillText(lab, x + nw / 2, yb - fs * 0.95);
        ctx.shadowBlur = 0;
        ctx.textBaseline = "alphabetic";
      }
    }
    if (active) activeBeams.push({ x: L.kx[n.key], w: kwid, col, vel: n.vel, age: t - n.start, id: n.id });
  }

  /* additive bloom: beams, sparks */
  if (s.showAcousticBloom && activeBeams.length) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const b of activeBeams) {
      const cx = b.x + b.w / 2;
      const v = 0.5 + 0.5 * (b.vel / 127);
      const env = Math.exp(-Math.max(0, b.age) * 2.2) * 0.65 + 0.35;
      const beamH = laneH * 0.3 * v;
      const bg = ctx.createLinearGradient(0, laneH - beamH, 0, laneH);
      bg.addColorStop(0, rgba(b.col, 0));
      bg.addColorStop(1, rgba(b.col, 0.34 * env));
      ctx.fillStyle = bg;
      ctx.fillRect(b.x, laneH - beamH, b.w, beamH);
      const R = (b.w * 2.1 + 26 * u) * v;
      const rg2 = ctx.createRadialGradient(cx, laneH, 0, cx, laneH, R);
      rg2.addColorStop(0, rgba(lighten(b.col, 0.35), 0.62 * env));
      rg2.addColorStop(0.35, rgba(b.col, 0.22 * env));
      rg2.addColorStop(1, rgba(b.col, 0));
      ctx.fillStyle = rg2;
      ctx.fillRect(cx - R, laneH - R, R * 2, R);
      // sparks
      if (b.age >= 0 && b.age < 0.42) {
        for (let j = 0; j < 7; j++) {
          const seed = b.id * 13 + j * 3.7;
          const ang = -Math.PI / 2 + (hash(seed) - 0.5) * 1.5;
          const spd = (70 + hash(seed + 1) * 150) * u;
          const a = b.age;
          const px = cx + Math.cos(ang) * spd * a;
          const py = laneH + Math.sin(ang) * spd * a + 220 * u * a * a;
          const life = 1 - a / 0.42;
          const sz = (0.8 + hash(seed + 2) * 1.6) * u * (0.4 + life);
          ctx.fillStyle = rgba(lighten(b.col, 0.5), 0.8 * life);
          ctx.beginPath();
          ctx.arc(px, py, sz, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    ctx.restore();
  }
  ctx.restore(); // end lane clip

  /* strike contact bar */
  if (s.showStrikeContactBar) {
    const lg = ctx.createLinearGradient(0, 0, W, 0);
    lg.addColorStop(0, "rgba(226,178,96,0)");
    lg.addColorStop(0.1, "rgba(226,178,96,0.5)");
    lg.addColorStop(0.5, "rgba(255,226,160,0.85)");
    lg.addColorStop(0.9, "rgba(226,178,96,0.5)");
    lg.addColorStop(1, "rgba(226,178,96,0)");
    ctx.fillStyle = lg;
    ctx.fillRect(0, laneH - 2 * u, W, 2 * u);
    const hg = ctx.createLinearGradient(0, laneH - 14 * u, 0, laneH);
    hg.addColorStop(0, "rgba(226,178,96,0)");
    hg.addColorStop(1, "rgba(226,178,96,0.12)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, laneH - 14 * u, W, 14 * u);
    // lit contact segments on active keys
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = L.lo; k <= L.hi; k++) {
      const ks = keyState[k];
      if (!ks) continue;
      ctx.fillStyle = rgba(lighten(ks.color, 0.4), 0.9 * ks.press);
      ctx.fillRect(L.kx[k] + 1, laneH - 2.5 * u, L.kw[k] - 2, 2.5 * u);
    }
    ctx.restore();
  }

  /* damper rail (wine baize + brass) */
  {
    const y = laneH;
    const gr = ctx.createLinearGradient(0, y, 0, y + railH);
    gr.addColorStop(0, "#6e2535");
    gr.addColorStop(0.5, "#561b29");
    gr.addColorStop(1, "#32101a");
    ctx.fillStyle = gr;
    ctx.fillRect(0, y, W, railH);
    const felt = getFelt(ctx);
    if (felt) {
      ctx.fillStyle = felt;
      ctx.fillRect(0, y, W, railH);
    }
    // brass trim
    const tg = ctx.createLinearGradient(0, y, 0, y + 2.2 * u);
    tg.addColorStop(0, "#fbe3a0");
    tg.addColorStop(0.5, "#d4a24c");
    tg.addColorStop(1, "#8f6322");
    ctx.fillStyle = tg;
    ctx.fillRect(0, y, W, Math.max(1.5, 2.2 * u));
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, y + railH - 1.5 * u, W, 1.5 * u);
    const bt = ctx.createLinearGradient(0, y + railH - 2.8 * u, 0, y + railH);
    bt.addColorStop(0, "#c9983f");
    bt.addColorStop(1, "#6b4a17");
    ctx.fillStyle = bt;
    ctx.fillRect(0, y + railH - 1.2 * u, W, 1.2 * u);
    // glow from active keys onto the baize
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let k = L.lo; k <= L.hi; k++) {
      const ks = keyState[k];
      if (!ks) continue;
      const cx = L.kx[k] + L.kw[k] / 2;
      const R = L.kw[k] * 1.5 + 8 * u;
      const rg = ctx.createRadialGradient(cx, y + railH / 2, 0, cx, y + railH / 2, R);
      rg.addColorStop(0, rgba(ks.color, 0.7 * ks.press));
      rg.addColorStop(1, rgba(ks.color, 0));
      ctx.fillStyle = rg;
      ctx.fillRect(cx - R, y, R * 2, railH);
    }
    // incoming key pre-glow: fallboard dots
    if (s.showIncomingKeyPreview) {
      const seen = new Set<number>();
      for (const n of incoming) {
        if (seen.has(n.key)) continue;
        seen.add(n.key);
        const ramp = 1 - (n.start - t) / s.incomingLookAheadSeconds;
        const col = noteColor(n, s.colorMode);
        const cx = L.kx[n.key] + L.kw[n.key] / 2;
        const rad = (2 + 3.2 * ramp) * u;
        const dg = ctx.createRadialGradient(cx, y + railH / 2, 0, cx, y + railH / 2, rad * 3);
        dg.addColorStop(0, rgba(lighten(col, 0.3), 0.95 * ramp));
        dg.addColorStop(0.35, rgba(col, 0.5 * ramp));
        dg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = dg;
        ctx.fillRect(cx - rad * 3, y, rad * 6, railH);
      }
    }
    ctx.restore();
  }

  /* keys */
  drawKeys(ctx, L, s, keyState, incoming, t);

  /* front board */
  {
    const y = L.frontY;
    const gr = ctx.createLinearGradient(0, y, 0, y + L.frontH);
    gr.addColorStop(0, "#5a3a20");
    gr.addColorStop(0.35, "#3d2614");
    gr.addColorStop(1, "#1f1209");
    ctx.fillStyle = gr;
    ctx.fillRect(0, y, W, L.frontH);
    const wood = getWood(ctx);
    if (wood) {
      ctx.fillStyle = wood;
      ctx.fillRect(0, y, W, L.frontH);
    }
    ctx.fillStyle = "rgba(255,214,160,0.28)";
    ctx.fillRect(0, y, W, Math.max(1, 1 * u));
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, y + L.frontH - 1, W, 1);
  }

  /* minimap */
  if (L.miniH > 0) drawMinimap(ctx, L, keyState);

  /* HUD */
  const tp = tempoAt(song, Math.max(0, t));
  const chord = chordAt(song, t);
  const measure = measureAt(song, t);
  if (s.showHudMetadata) drawHud(ctx, L, song, tp.bpm, pedal && s.showSustainPedal, measure);
  if (s.showChordBanner && chord) drawChordBanner(ctx, L, chord, t);

  void FILTER_EMPTY;
  return { bpm: tp.bpm, chord, measure, pedal, active: activeCount };
}

/* --------------------------------- keys --------------------------------- */

function drawKeys(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  s: RenderSettings,
  ks: (KeyState | null)[],
  incoming: NoteEvent[],
  t: number,
) {
  const { u, keysTop: top, keysH: kh, wkw } = L;
  const gapPx = Math.max(1, wkw * 0.045);
  const radius = clamp(wkw * 0.16, 2, 6.5 * u);

  // shared ivory gradients
  const ivory = ctx.createLinearGradient(0, top, 0, top + kh);
  ivory.addColorStop(0, "#d8cdb3");
  ivory.addColorStop(0.06, "#f2eadb");
  ivory.addColorStop(0.5, "#f8f2e4");
  ivory.addColorStop(0.88, "#ebe1c8");
  ivory.addColorStop(1, "#cdbf9f");

  // pre-compute incoming ramp per key
  const inc = new Map<number, number>();
  if (s.showIncomingKeyPreview) {
    for (const n of incoming) {
      const ramp = 1 - (n.start - t) / s.incomingLookAheadSeconds;
      if (!inc.has(n.key) || ramp > inc.get(n.key)!) inc.set(n.key, ramp);
    }
  }
  const incColor = new Map<number, string>();
  for (const n of incoming) if (!incColor.has(n.key)) incColor.set(n.key, noteColor(n, s.colorMode));

  // white keys
  for (let k = L.lo; k <= L.hi; k++) {
    if (isBlack(k + 21)) continue;
    const st = ks[k];
    const p = st ? st.press : 0;
    const x = L.kx[k] + gapPx / 2;
    const w = L.kw[k] - gapPx;
    const dy = p * 2.6 * u;
    const y = top + dy;
    const h = kh - dy - p * 1.2 * u;
    // body
    if (p > 0.01) {
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, mix("#d8cdb3", "#a79a7c", p));
      g.addColorStop(0.08, mix("#f2eadb", "#cbbfa5", p));
      g.addColorStop(0.55, mix("#f8f2e4", "#e0d5ba", p));
      g.addColorStop(1, mix("#cdbf9f", "#b3a584", p));
      ctx.fillStyle = g;
    } else ctx.fillStyle = ivory;
    rrBottom(ctx, x, y, w, h, radius);
    ctx.fill();

    // colour wash on press
    if (st && p > 0.01) {
      ctx.save();
      rrBottom(ctx, x, y, w, h, radius);
      ctx.clip();
      const wg = ctx.createLinearGradient(0, y, 0, y + h);
      wg.addColorStop(0, rgba(st.color, 0.92 * p));
      wg.addColorStop(0.45, rgba(st.color, 0.62 * p));
      wg.addColorStop(1, rgba(st.color, 0.28 * p));
      ctx.fillStyle = wg;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    } else if (inc.has(k)) {
      const r = inc.get(k)!;
      const col = incColor.get(k)!;
      ctx.save();
      rrBottom(ctx, x, y, w, h, radius);
      ctx.clip();
      const wg = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
      wg.addColorStop(0, rgba(col, 0.34 * r));
      wg.addColorStop(1, rgba(col, 0));
      ctx.fillStyle = wg;
      ctx.fillRect(x, y, w, h);
      ctx.restore();
    }

    // side bevels
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x + 0.5, y + 2 * u, Math.max(1, wkw * 0.045), h - 10 * u);
    ctx.fillStyle = "rgba(90,66,30,0.22)";
    ctx.fillRect(x + w - Math.max(1, wkw * 0.06), y + 2 * u, Math.max(1, wkw * 0.06), h - 10 * u);

    // front lip
    const lipH = Math.max(6, 11 * u);
    const lg = ctx.createLinearGradient(0, y + h - lipH, 0, y + h);
    lg.addColorStop(0, "rgba(255,255,255,0.55)");
    lg.addColorStop(0.08, "rgba(255,255,255,0)");
    lg.addColorStop(0.5, "rgba(120,92,48,0.10)");
    lg.addColorStop(1, "rgba(100,72,30,0.38)");
    ctx.save();
    rrBottom(ctx, x, y, w, h, radius);
    ctx.clip();
    ctx.fillStyle = lg;
    ctx.fillRect(x, y + h - lipH, w, lipH);
    ctx.restore();
    // subtle outline
    ctx.strokeStyle = "rgba(60,40,16,0.34)";
    ctx.lineWidth = 1;
    rrBottom(ctx, x + 0.5, y, w - 1, h - 0.5, radius);
    ctx.stroke();
  }
  // shadow cast by the damper rail
  {
    const sg = ctx.createLinearGradient(0, top, 0, top + 16 * u);
    sg.addColorStop(0, "rgba(20,8,6,0.55)");
    sg.addColorStop(1, "rgba(20,8,6,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(0, top, L.W, 16 * u);
  }

  // black keys
  for (let k = L.lo; k <= L.hi; k++) {
    if (!isBlack(k + 21)) continue;
    const st = ks[k];
    const p = st ? st.press : 0;
    const x = L.kx[k];
    const w = L.kw[k];
    const dy = p * 1.4 * u;
    const y = top + dy * 0.5;
    const h = L.bkh - dy;
    // drop shadow on neighbours
    ctx.save();
    ctx.shadowColor = `rgba(10,4,0,${0.55 - p * 0.3})`;
    ctx.shadowBlur = (7 - p * 3) * u;
    ctx.shadowOffsetX = (2.2 - p) * u;
    ctx.shadowOffsetY = (4 - p * 2) * u;
    ctx.fillStyle = "#0b0908";
    rrBottom(ctx, x, y, w, h, Math.max(2, w * 0.13));
    ctx.fill();
    ctx.restore();
    // chamfered body
    const bg = ctx.createLinearGradient(x, 0, x + w, 0);
    bg.addColorStop(0, "#2b2622");
    bg.addColorStop(0.12, "#16120f");
    bg.addColorStop(0.88, "#0a0807");
    bg.addColorStop(1, "#050404");
    ctx.fillStyle = bg;
    rrBottom(ctx, x, y, w, h, Math.max(2, w * 0.13));
    ctx.fill();
    // top facet
    const inset = w * 0.14;
    const fx = x + inset;
    const fw = w - inset * 2;
    const fh = h * 0.86 - p * 1.5 * u;
    const fg = ctx.createLinearGradient(fx, 0, fx + fw, 0);
    fg.addColorStop(0, "#3a3430");
    fg.addColorStop(0.25, "#26211e");
    fg.addColorStop(0.7, "#171310");
    fg.addColorStop(1, "#0e0b0a");
    ctx.fillStyle = fg;
    rrBottom(ctx, fx, y, fw, fh, Math.max(1.5, fw * 0.14));
    ctx.fill();
    // glossy sheen
    ctx.save();
    rrBottom(ctx, fx, y, fw, fh, Math.max(1.5, fw * 0.14));
    ctx.clip();
    const sg = ctx.createLinearGradient(0, y, 0, y + fh);
    sg.addColorStop(0, "rgba(255,255,255,0.20)");
    sg.addColorStop(0.35, "rgba(255,255,255,0.05)");
    sg.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(fx, y, fw, fh);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fillRect(fx + 0.5, y, Math.max(1, fw * 0.12), fh);
    if (st && p > 0.01) {
      const wg = ctx.createLinearGradient(0, y, 0, y + fh);
      wg.addColorStop(0, rgba(st.color, 0.95 * p));
      wg.addColorStop(0.6, rgba(st.color, 0.6 * p));
      wg.addColorStop(1, rgba(st.color, 0.35 * p));
      ctx.fillStyle = wg;
      ctx.fillRect(fx, y, fw, fh);
    } else if (inc.has(k)) {
      const r = inc.get(k)!;
      const wg = ctx.createLinearGradient(0, y, 0, y + fh * 0.5);
      wg.addColorStop(0, rgba(incColor.get(k)!, 0.42 * r));
      wg.addColorStop(1, rgba(incColor.get(k)!, 0));
      ctx.fillStyle = wg;
      ctx.fillRect(fx, y, fw, fh);
    }
    ctx.restore();
    // front chamfer
    const cg = ctx.createLinearGradient(0, y + fh, 0, y + h);
    cg.addColorStop(0, "#3e3732");
    cg.addColorStop(1, "#0d0b09");
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(fx, y + fh);
    ctx.lineTo(fx + fw, y + fh);
    ctx.lineTo(x + w - w * 0.04, y + h - Math.max(2, w * 0.13));
    ctx.lineTo(x + w * 0.04, y + h - Math.max(2, w * 0.13));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.lineWidth = 1;
    rrBottom(ctx, x + 0.5, y, w - 1, h - 0.5, Math.max(2, w * 0.13));
    ctx.stroke();
  }

  // labels
  if (s.keyLabelMode !== "none" && wkw >= 10) {
    const fs = Math.round(clamp(wkw * 0.4, 8, 14 * u));
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (let k = L.lo; k <= L.hi; k++) {
      const midi = k + 21;
      const black = isBlack(midi);
      const pc = midi % 12;
      const oct = Math.floor(midi / 12) - 1;
      let txt = "";
      switch (s.keyLabelMode) {
        case "onlyC":
          if (pc === 0) txt = `C${oct}`;
          else if (k === 0) txt = "A0";
          break;
        case "allWhite":
          if (!black) txt = noteName(midi, s.useFlats, false) + (pc === 0 ? String(oct) : "");
          break;
        case "all88":
          txt = noteName(midi, s.useFlats, false) + (pc === 0 || k === 0 ? String(oct) : "");
          break;
        case "solfege":
          if (!black) txt = SOLFEGE[pc];
          break;
      }
      if (!txt) continue;
      if (black) {
        if (L.kw[k] < 9) continue;
        ctx.font = `600 ${Math.max(7, fs - 3)}px ${SANS}`;
        ctx.fillStyle = "rgba(235,224,200,0.8)";
        ctx.fillText(txt, L.kx[k] + L.kw[k] / 2, top + L.bkh - 9 * u);
      } else {
        const st = ks[k];
        const isC = pc === 0;
        ctx.font = `${isC ? 700 : 600} ${fs}px ${SANS}`;
        ctx.fillStyle = st && st.press > 0.5 ? (luminance(st.color) > 0.55 ? "rgba(30,16,4,0.9)" : "#fff") : isC ? "#8b5a1e" : "#8b7b5c";
        ctx.fillText(txt, L.kx[k] + L.kw[k] / 2, top + kh - 9 * u - (st ? st.press * 2 * u : 0));
      }
    }
  }
}

/* -------------------------------- minimap -------------------------------- */

function drawMinimap(ctx: CanvasRenderingContext2D, L: Layout, ks: (KeyState | null)[]) {
  const { u, W, miniY: y, miniH: h } = L;
  const bg = ctx.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, "#15100c");
  bg.addColorStop(1, "#0a0807");
  ctx.fillStyle = bg;
  ctx.fillRect(0, y, W, h);
  ctx.fillStyle = "rgba(255,220,160,0.10)";
  ctx.fillRect(0, y, W, 1);

  const pad = 18 * u;
  const mw = W - pad * 2;
  const wk = mw / 52;
  const kTop = y + 7 * u;
  const kH = h - 21 * u;
  const bH = kH * 0.62;
  const xs = (k: number) => pad + (isBlack(k + 21) ? (WHITE_IDX[k] + 1) * wk - wk * 0.3 : WHITE_IDX[k] * wk);
  // range window
  const x1 = pad + WHITE_IDX[L.lo] * wk;
  const x2 = pad + (WHITE_IDX[L.hi] + 1) * wk;
  // whites
  for (let k = 0; k < 88; k++) {
    if (isBlack(k + 21)) continue;
    const st = ks[k];
    const inRange = k >= L.lo && k <= L.hi;
    ctx.fillStyle = st && st.press > 0.05 ? mix("#d9ceb4", st.color, 0.4 + 0.6 * st.press) : inRange ? "#cfc4a8" : "#6f6551";
    rr(ctx, xs(k) + 0.4, kTop, wk - 0.8, kH, Math.min(2, wk * 0.2));
    ctx.fill();
  }
  for (let k = 0; k < 88; k++) {
    if (!isBlack(k + 21)) continue;
    const st = ks[k];
    const inRange = k >= L.lo && k <= L.hi;
    ctx.fillStyle = st && st.press > 0.05 ? mix("#2a2420", st.color, 0.3 + 0.7 * st.press) : inRange ? "#1b1613" : "#15110e";
    rr(ctx, xs(k), kTop, wk * 0.6, bH, Math.min(1.6, wk * 0.15));
    ctx.fill();
  }
  // dim outside range
  if (L.lo > 0 || L.hi < 87) {
    ctx.fillStyle = "rgba(8,6,4,0.45)";
    ctx.fillRect(pad, kTop, x1 - pad, kH);
    ctx.fillRect(x2, kTop, pad + mw - x2, kH);
  }
  // viewport bracket
  ctx.strokeStyle = "rgba(240,196,110,0.9)";
  ctx.lineWidth = Math.max(1, 1.4 * u);
  rr(ctx, x1, kTop - 2 * u, x2 - x1, kH + 4 * u, 3 * u);
  ctx.stroke();
  // octave labels
  ctx.font = `600 ${Math.round(8.5 * u)}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(200,176,130,0.55)";
  for (let k = 3; k < 88; k += 12) {
    const oct = Math.floor((k + 21) / 12) - 1;
    ctx.fillText(`C${oct}`, xs(k) + wk / 2, y + h - 5 * u);
  }
}

/* ---------------------------------- HUD ---------------------------------- */

function glass(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(34,26,19,0.82)");
  g.addColorStop(1, "rgba(16,12,9,0.82)");
  ctx.fillStyle = g;
  rr(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,226,170,0.16)";
  ctx.lineWidth = 1;
  rr(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,240,210,0.06)";
  rr(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, r - 1));
  ctx.stroke();
}

function drawHud(ctx: CanvasRenderingContext2D, L: Layout, song: Song, bpm: number, pedal: boolean, measure: number) {
  const { u } = L;
  const x = 16 * u;
  const y = 14 * u;
  const pad = 14 * u;
  const maxW = Math.min(L.W * 0.46, 560 * u);
  const title = song.name.split(" — ")[0];
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 ${Math.round(20 * u)}px ${SERIF}`;
  const tShown = fitText(ctx, title, maxW - pad * 2);
  const tW = ctx.measureText(tShown).width;
  const sub = [song.artist, song.piece].filter(Boolean).join("  ·  ");
  ctx.font = `600 ${Math.round(9.5 * u)}px ${SANS}`;
  setSpacing(ctx, 1.4 * u);
  const subShown = sub ? fitText(ctx, sub.toUpperCase(), maxW - pad * 2) : "";
  const sW = ctx.measureText(subShown).width;
  setSpacing(ctx, 0);

  // chips
  const chips: { text: string; accent?: boolean }[] = [{ text: `♩ = ${Math.round(bpm)}`, accent: true }];
  if (measure > 0) chips.push({ text: `m. ${measure}` });
  if (pedal) chips.push({ text: "Ped." });
  ctx.font = `600 ${Math.round(11 * u)}px ${SANS}`;
  const chipH = 20 * u;
  const chipGap = 6 * u;
  const chipWs = chips.map((c) => ctx.measureText(c.text).width + 16 * u);
  const chipsW = chipWs.reduce((a, b) => a + b, 0) + chipGap * (chips.length - 1);

  const contentW = Math.max(tW, sW, chipsW);
  const boxW = contentW + pad * 2 + 6 * u;
  const boxH = pad * 2 + 22 * u + (subShown ? 17 * u : 0) + chipH + 8 * u;
  glass(ctx, x, y, boxW, boxH, 12 * u);

  // brass accent bar
  const ag = ctx.createLinearGradient(0, y, 0, y + boxH);
  ag.addColorStop(0, "#f0cf86");
  ag.addColorStop(1, "#a67a2e");
  ctx.fillStyle = ag;
  rr(ctx, x + 5 * u, y + 14 * u, 2.5 * u, boxH - 28 * u, 1.5 * u);
  ctx.fill();

  let cy = y + pad + 17 * u;
  const cx = x + pad + 4 * u;
  ctx.font = `700 ${Math.round(20 * u)}px ${SERIF}`;
  ctx.fillStyle = "#f7ecd3";
  ctx.fillText(tShown, cx, cy);
  if (subShown) {
    cy += 18 * u;
    ctx.font = `600 ${Math.round(9.5 * u)}px ${SANS}`;
    setSpacing(ctx, 1.4 * u);
    ctx.fillStyle = "rgba(196,172,128,0.85)";
    ctx.fillText(subShown, cx, cy);
    setSpacing(ctx, 0);
  }
  cy += 10 * u;
  let chipX = cx;
  chips.forEach((c, i) => {
    const w = chipWs[i];
    ctx.fillStyle = c.accent ? "rgba(240,196,110,0.16)" : "rgba(255,236,200,0.07)";
    rr(ctx, chipX, cy, w, chipH, chipH / 2);
    ctx.fill();
    ctx.strokeStyle = c.accent ? "rgba(240,196,110,0.5)" : "rgba(255,236,200,0.14)";
    ctx.lineWidth = 1;
    rr(ctx, chipX + 0.5, cy + 0.5, w - 1, chipH - 1, chipH / 2);
    ctx.stroke();
    ctx.font = `600 ${Math.round(11 * u)}px ${SANS}`;
    ctx.fillStyle = c.accent ? "#f6d894" : "#d9ccb2";
    ctx.textAlign = "center";
    ctx.fillText(c.text, chipX + w / 2, cy + chipH / 2 + 4 * u);
    ctx.textAlign = "left";
    chipX += w + chipGap;
  });
}

function drawChordBanner(ctx: CanvasRenderingContext2D, L: Layout, chord: Chord, t: number) {
  const { u } = L;
  const fadeIn = clamp((t - chord.start) / 0.14, 0, 1);
  const fadeOut = clamp((chord.end - t) / 0.18, 0, 1);
  const a = Math.min(fadeIn, fadeOut);
  if (a <= 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `italic 700 ${Math.round(34 * u)}px ${SERIF}`;
  const symW = ctx.measureText(chord.symbol).width;
  ctx.font = `600 ${Math.round(11 * u)}px ${SANS}`;
  const rnW = chord.roman ? ctx.measureText(chord.roman).width : 0;
  const w = Math.max(symW, rnW) + 44 * u;
  const h = chord.roman ? 74 * u : 56 * u;
  const x = L.W / 2 - w / 2;
  const y = 14 * u + (1 - a) * -6 * u;
  glass(ctx, x, y, w, h, 14 * u);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fbefd4";
  ctx.font = `italic 700 ${Math.round(34 * u)}px ${SERIF}`;
  ctx.fillText(chord.symbol, L.W / 2, y + 39 * u);
  if (chord.roman) {
    ctx.font = `600 ${Math.round(11 * u)}px ${SANS}`;
    setSpacing(ctx, 1.2 * u);
    ctx.fillStyle = "#e0b45c";
    ctx.fillText(chord.roman, L.W / 2, y + 60 * u);
    setSpacing(ctx, 0);
  }
  ctx.restore();
}
