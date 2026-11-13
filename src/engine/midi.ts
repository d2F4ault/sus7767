/* ------------------------------------------------------------------ *
 *  Clavier · MIDI engine
 *  Standard MIDI File parser, tempo map, measure grid, sustain periods,
 *  chord recognition and a dynamic-programming fingering solver.
 * ------------------------------------------------------------------ */

export type Hand = "L" | "R";
export type TrackHand = Hand | "auto";

export interface NoteEvent {
  id: number;
  midi: number; // 21..108
  key: number; // 0..87
  start: number; // seconds
  end: number; // seconds
  visEnd: number; // visual release (shortened on rapid repeats)
  sustainEnd: number; // end of damper-held resonance (>= end)
  vel: number; // 1..127
  track: number;
  hand: Hand;
  finger: number; // 1..5
  tick: number;
}

export interface TempoPoint {
  tick: number;
  time: number;
  bpm: number;
  usPerBeat: number;
}

export interface Measure {
  number: number;
  time: number;
  tick: number;
  beats: number[]; // beat times inside the measure (excluding downbeat)
  numerator: number;
  denominator: number;
}

export interface Chord {
  start: number;
  end: number;
  symbol: string;
  roman: string | null;
  spelled: string;
  keyLo: number;
  keyHi: number;
  hand: Hand | "both";
}

export interface SustainPeriod {
  start: number;
  end: number;
}

export interface TrackInfo {
  index: number;
  name: string;
  hand: TrackHand;
  resolvedHand: Hand | "split";
  noteCount: number;
  avgPitch: number;
  lo: number;
  hi: number;
}

export interface KeySig {
  sharps: number;
  minor: boolean;
}

export interface TimeSig {
  tick: number;
  numerator: number;
  denominator: number;
}

export interface SongMeta {
  id: string;
  fileName: string;
  name: string;
  artist?: string;
  piece?: string;
  copyright?: string;
  difficulty?: number;
}

export interface Song extends SongMeta {
  notes: NoteEvent[]; // sorted by start, key
  prefixMaxEnd: Float64Array; // running max of sustainEnd for fast window queries
  tempos: TempoPoint[];
  measures: Measure[];
  sustain: SustainPeriod[];
  chords: Chord[];
  tracks: TrackInfo[];
  keySig: KeySig;
  timeSigs: TimeSig[];
  ppq: number;
  duration: number; // last note release, seconds
  minKey: number;
  maxKey: number;
  densityBins: number[]; // normalised note density for the scrubber
}

/* ------------------------------ parser ------------------------------ */

interface RawNote {
  tick: number;
  on: boolean;
  ch: number;
  note: number;
  vel: number;
  track: number;
}

class Reader {
  p = 0;
  constructor(public d: Uint8Array) {}
  u8() {
    if (this.p >= this.d.length) throw new Error("Unexpected end of MIDI data");
    return this.d[this.p++];
  }
  u16() {
    return (this.u8() << 8) | this.u8();
  }
  u32() {
    return ((this.u8() << 24) | (this.u8() << 16) | (this.u8() << 8) | this.u8()) >>> 0;
  }
  vlq() {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
  str(n: number) {
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    return s;
  }
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const NOTE_NAMES_SHARP = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
export const NOTE_NAMES_FLAT = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
export const NOTE_NAMES_KEY = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const SOLFEGE = ["Do", "Di", "Re", "Ri", "Mi", "Fa", "Fi", "Sol", "Si", "La", "Li", "Ti"];
export const SOLFEGE_FLAT = ["Do", "Ra", "Re", "Me", "Mi", "Fa", "Se", "Sol", "Le", "La", "Te", "Ti"];

export function isBlack(midi: number) {
  const p = ((midi % 12) + 12) % 12;
  return p === 1 || p === 3 || p === 6 || p === 8 || p === 10;
}

export function noteName(midi: number, flats = false, withOctave = true) {
  const n = (flats ? NOTE_NAMES_FLAT : NOTE_NAMES_SHARP)[((midi % 12) + 12) % 12];
  return withOctave ? `${n}${Math.floor(midi / 12) - 1}` : n;
}

export function parseMidi(bytes: Uint8Array, meta: Partial<SongMeta> & { fileName: string }): Song {
  const r = new Reader(bytes);
  // Some files are wrapped (RIFF RMID) — locate the MThd chunk.
  let off = 0;
  for (let i = 0; i < Math.min(bytes.length - 4, 64); i++) {
    if (bytes[i] === 0x4d && bytes[i + 1] === 0x54 && bytes[i + 2] === 0x68 && bytes[i + 3] === 0x64) {
      off = i;
      break;
    }
  }
  r.p = off;
  if (r.str(4) !== "MThd") throw new Error("Not a Standard MIDI File (missing MThd header).");
  const hdrLen = r.u32();
  const format = r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  r.p = off + 8 + hdrLen;

  const smpte = (division & 0x8000) !== 0;
  const ppq = smpte ? 480 : division || 480;
  const ticksPerSecSmpte = smpte ? (256 - (division >> 8)) * (division & 0xff) : 0;

  const raw: RawNote[] = [];
  const tempoEvents: { tick: number; us: number }[] = [];
  const timeSigs: TimeSig[] = [];
  const keySigs: KeySig[] = [];
  const pedal: { tick: number; down: boolean; ch: number }[] = [];
  const trackNames: string[] = [];
  let maxTick = 0;

  for (let t = 0; t < nTracks && r.p < bytes.length - 8; t++) {
    const id = r.str(4);
    const len = r.u32();
    const end = Math.min(bytes.length, r.p + len);
    if (id !== "MTrk") {
      r.p = end;
      t--;
      continue;
    }
    let tick = 0;
    let running = 0;
    let name = "";
    try {
      while (r.p < end) {
        tick += r.vlq();
        let status = r.u8();
        if (status < 0x80) {
          r.p--;
          status = running;
          if (!status) throw new Error("Bad running status");
        }
        if (status === 0xff) {
          const type = r.u8();
          const l = r.vlq();
          const next = r.p + l;
          if (type === 0x51 && l === 3) tempoEvents.push({ tick, us: (r.u8() << 16) | (r.u8() << 8) | r.u8() });
          else if (type === 0x58 && l >= 2) {
            const num = r.u8();
            const den = 1 << r.u8();
            timeSigs.push({ tick, numerator: num, denominator: den });
          } else if (type === 0x59 && l === 2) {
            let sf = r.u8();
            if (sf > 127) sf -= 256;
            keySigs.push({ sharps: sf, minor: r.u8() === 1 });
          } else if (type === 0x03 && !name) name = r.str(l).trim();
          r.p = next;
          if (type === 0x2f) break;
        } else if (status === 0xf0 || status === 0xf7) {
          const l = r.vlq();
          r.p += l;
        } else {
          running = status;
          const hi = status & 0xf0;
          const ch = status & 0x0f;
          if (hi === 0x80 || hi === 0x90) {
            const note = r.u8();
            const vel = r.u8();
            raw.push({ tick, on: hi === 0x90 && vel > 0, ch, note, vel, track: t });
          } else if (hi === 0xb0) {
            const cc = r.u8();
            const v = r.u8();
            if (cc === 64) pedal.push({ tick, down: v >= 64, ch });
          } else if (hi === 0xc0 || hi === 0xd0) r.u8();
          else r.p += 2;
        }
      }
    } catch {
      /* tolerate truncated tracks */
    }
    maxTick = Math.max(maxTick, tick);
    trackNames[t] = name;
    r.p = end;
  }
  if (raw.length === 0) throw new Error("This MIDI file contains no playable notes.");

  /* ---- tempo map (µs accumulation) ---- */
  tempoEvents.sort((a, b) => a.tick - b.tick);
  const tempos: TempoPoint[] = [];
  const pushTempo = (tick: number, us: number, time: number) => {
    const last = tempos[tempos.length - 1];
    if (last && last.tick === tick) {
      last.usPerBeat = us;
      last.bpm = 6e7 / us;
      return;
    }
    tempos.push({ tick, time, bpm: 6e7 / us, usPerBeat: us });
  };
  pushTempo(0, tempoEvents.find((e) => e.tick === 0)?.us ?? 500000, 0);
  for (const e of tempoEvents) {
    if (e.tick === 0) continue;
    const prev = tempos[tempos.length - 1];
    const dt = smpte ? 0 : ((e.tick - prev.tick) * prev.usPerBeat) / ppq / 1e6;
    pushTempo(e.tick, e.us, prev.time + dt);
  }
  const tickToSec = (tick: number): number => {
    if (smpte) return tick / ticksPerSecSmpte;
    let lo = 0;
    let hi = tempos.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tempos[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    const tp = tempos[lo];
    return tp.time + ((tick - tp.tick) * tp.usPerBeat) / ppq / 1e6;
  };

  /* ---- sustain pedal ---- */
  pedal.sort((a, b) => a.tick - b.tick);
  const chDown = new Set<number>();
  const sustain: SustainPeriod[] = [];
  let openAt: number | null = null;
  for (const e of pedal) {
    if (e.down) chDown.add(e.ch);
    else chDown.delete(e.ch);
    const s = tickToSec(e.tick);
    if (chDown.size > 0 && openAt === null) openAt = s;
    else if (chDown.size === 0 && openAt !== null) {
      if (s > openAt) sustain.push({ start: openAt, end: s });
      openAt = null;
    }
  }
  const endTimeAll = tickToSec(maxTick);
  if (openAt !== null) sustain.push({ start: openAt, end: endTimeAll });

  /* ---- pair notes ---- */
  raw.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on)); // offs first at same tick
  const open = new Map<number, { tick: number; vel: number; track: number }[]>();
  interface PairedNote {
    tick: number;
    endTick: number;
    midi: number;
    vel: number;
    track: number;
    ch: number;
  }
  const paired: PairedNote[] = [];
  for (const e of raw) {
    if (e.ch === 9) continue;
    const k = e.ch * 256 + e.note;
    if (e.on) {
      if (e.note < 21 || e.note > 108) continue;
      let q = open.get(k);
      if (!q) open.set(k, (q = []));
      q.push({ tick: e.tick, vel: e.vel, track: e.track });
    } else {
      const q = open.get(k);
      if (q && q.length) {
        const o = q.shift()!;
        paired.push({ tick: o.tick, endTick: Math.max(o.tick + 1, e.tick), midi: e.note, vel: o.vel, track: o.track, ch: e.ch });
      }
    }
  }
  for (const [k, q] of open) {
    for (const o of q) paired.push({ tick: o.tick, endTick: Math.max(o.tick + ppq / 4, maxTick), midi: k & 255, vel: o.vel, track: o.track, ch: k >> 8 });
  }
  if (paired.length === 0) throw new Error("This MIDI file contains no notes within the 88-key range (A0–C8).");

  // Format-0 style files: separate voices by channel
  const distinctTracks = new Set(paired.map((x) => x.track)).size;
  const trackKeys = new Map<string, number>();
  const trackSources: { name: string; src: number; ch: number }[] = [];
  const noteTrackOf = (p: PairedNote) => {
    const key = distinctTracks > 1 || format !== 0 ? `t${p.track}` : `c${p.ch}`;
    let idx = trackKeys.get(key);
    if (idx === undefined) {
      idx = trackSources.length;
      trackKeys.set(key, idx);
      trackSources.push({ name: trackNames[p.track] ?? "", src: p.track, ch: p.ch });
    }
    return idx;
  };

  const notes: NoteEvent[] = paired.map((p, i) => ({
    id: i,
    midi: p.midi,
    key: p.midi - 21,
    start: tickToSec(p.tick),
    end: tickToSec(p.endTick),
    visEnd: 0,
    sustainEnd: 0,
    vel: Math.max(1, p.vel),
    track: noteTrackOf(p),
    hand: "R" as Hand,
    finger: 1,
    tick: p.tick,
  }));
  notes.sort((a, b) => a.start - b.start || a.key - b.key);
  notes.forEach((n, i) => (n.id = i));

  /* ---- measures ---- */
  timeSigs.sort((a, b) => a.tick - b.tick);
  if (!timeSigs.length || timeSigs[0].tick > 0) timeSigs.unshift({ tick: 0, numerator: 4, denominator: 4 });
  let lastNoteTick = 0;
  for (const p of paired) lastNoteTick = Math.max(lastNoteTick, p.endTick);
  const measures: Measure[] = [];
  {
    let tick = 0;
    let n = 1;
    let si = 0;
    while (tick <= lastNoteTick + 1 && n < 5000) {
      while (si + 1 < timeSigs.length && timeSigs[si + 1].tick <= tick) si++;
      const ts = timeSigs[si];
      const beatTicks = (ppq * 4) / ts.denominator;
      const group = ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator > 3 ? 3 : 1;
      const measTicks = beatTicks * ts.numerator;
      const beats: number[] = [];
      for (let b = group; b < ts.numerator; b += group) beats.push(tickToSec(tick + b * beatTicks));
      measures.push({ number: n, time: tickToSec(tick), tick, beats, numerator: ts.numerator, denominator: ts.denominator });
      tick += measTicks;
      n++;
    }
  }

  /* ---- tracks, hands ---- */
  const nTr = trackSources.length;
  const trackInfos: TrackInfo[] = trackSources.map((s, i) => {
    const tn = notes.filter((n) => n.track === i);
    const avg = tn.reduce((a, n) => a + n.midi, 0) / Math.max(1, tn.length);
    let lo = 127;
    let hi = 0;
    for (const n of tn) {
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
    return {
      index: i,
      name: s.name || (nTr === 1 ? "Piano" : `Voice ${i + 1}`),
      hand: "auto",
      resolvedHand: "R",
      noteCount: tn.length,
      avgPitch: avg,
      lo: tn.length ? lo : 60,
      hi: tn.length ? hi : 60,
    };
  });

  const keySig: KeySig = keySigs[0] ?? { sharps: 0, minor: false };
  let minKey = 87;
  let maxKey = 0;
  let duration = 0;
  for (const n of notes) {
    minKey = Math.min(minKey, n.key);
    maxKey = Math.max(maxKey, n.key);
    duration = Math.max(duration, n.end);
  }

  const song: Song = {
    id: meta.id ?? "custom",
    fileName: meta.fileName,
    name: meta.name ?? meta.fileName.replace(/\.(mid|midi)$/i, ""),
    artist: meta.artist,
    piece: meta.piece,
    copyright: meta.copyright,
    difficulty: meta.difficulty,
    notes,
    prefixMaxEnd: new Float64Array(0),
    tempos,
    measures,
    sustain,
    chords: [],
    tracks: trackInfos,
    keySig,
    timeSigs,
    ppq,
    duration,
    minKey,
    maxKey,
    densityBins: [],
  };
  analyseSong(song);
  return song;
}

/* --------------------------- analysis passes --------------------------- */

/** (Re)assign hands, fingerings, chords and acoustic envelopes. Safe to call repeatedly. */
export function analyseSong(song: Song) {
  const { notes, tracks } = song;

  // resolve hands
  const multi = tracks.length >= 2;
  const ranked = tracks.slice().sort((a, b) => b.avgPitch - a.avgPitch);
  for (const t of tracks) {
    const nm = t.name.toLowerCase();
    if (t.hand !== "auto") t.resolvedHand = t.hand;
    else if (/left|bass|\blh\b|\bl\.h/.test(nm)) t.resolvedHand = "L";
    else if (/right|treble|\brh\b|\br\.h/.test(nm)) t.resolvedHand = "R";
    else if (multi) t.resolvedHand = ranked.indexOf(t) < Math.ceil(tracks.length / 2) ? "R" : "L";
    else t.resolvedHand = "split";
  }
  for (const n of notes) {
    const th = tracks[n.track].resolvedHand;
    n.hand = th === "split" ? (n.midi < 60 ? "L" : "R") : th;
  }

  // acoustic envelopes: visual release gaps and sustain resonance
  const byKey: NoteEvent[][] = Array.from({ length: 88 }, () => []);
  for (const n of notes) byKey[n.key].push(n);
  for (const list of byKey) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      n.visEnd = n.end;
      const nx = list[i + 1];
      if (nx && nx.start < n.end + 0.035) n.visEnd = Math.max(n.start + 0.025, Math.min(n.end, nx.start - 0.035));
    }
  }
  const sus = song.sustain;
  for (const n of notes) {
    n.sustainEnd = n.end;
    if (!sus.length) continue;
    let lo = 0;
    let hi = sus.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sus[m].end > n.end) hi = m;
      else lo = m + 1;
    }
    const p = sus[lo];
    if (p && p.start <= n.end) n.sustainEnd = Math.min(p.end, n.end + 6);
  }
  const pm = new Float64Array(notes.length);
  let mx = -Infinity;
  for (let i = 0; i < notes.length; i++) {
    mx = Math.max(mx, notes[i].sustainEnd, notes[i].visEnd);
    pm[i] = mx;
  }
  song.prefixMaxEnd = pm;

  assignFingers(notes.filter((n) => n.hand === "R"), "R");
  assignFingers(notes.filter((n) => n.hand === "L"), "L");
  song.chords = detectChords(song);

  // density for scrubber
  const bins = new Array(160).fill(0);
  const dur = Math.max(1e-3, song.duration);
  for (const n of notes) bins[Math.min(159, Math.floor((n.start / dur) * 160))]++;
  const bmax = Math.max(1, ...bins);
  song.densityBins = bins.map((b) => b / bmax);
}

/* ------------------------------ fingering ------------------------------ */

const BLACK_PC = new Set([1, 3, 6, 8, 10]);
const blackKey = (midi: number) => BLACK_PC.has(midi % 12);

function candidatesFor(n: number, hand: Hand, span: number): number[][] {
  let base: number[][];
  if (n === 1) base = [[1], [2], [3], [4], [5]];
  else if (n === 2) {
    base = [[1, 2], [1, 3], [1, 4], [1, 5], [2, 3], [2, 4], [2, 5], [3, 4], [3, 5], [4, 5]].filter(
      (f) => span <= 2 * (f[1] - f[0]) + 7,
    );
    if (!base.length) base = [[1, 5]];
  } else if (n === 3) base = [[1, 3, 5], [1, 2, 4], [1, 2, 5], [2, 3, 5], [1, 3, 4], [1, 2, 3]];
  else if (n === 4) base = [[1, 2, 3, 5], [1, 2, 4, 5], [1, 3, 4, 5]];
  else base = [Array.from({ length: n }, (_, i) => Math.min(5, i + 1))];
  // base lists are ordered low pitch → high pitch for the right hand
  return hand === "R" ? base : base.map((c) => c.map((f) => 6 - f));
}

function assignFingers(list: NoteEvent[], hand: Hand) {
  if (!list.length) return;
  list.sort((a, b) => a.start - b.start || a.key - b.key);
  const groups: NoteEvent[][] = [];
  let g: NoteEvent[] | null = null;
  for (const n of list) {
    if (g && n.start - g[0].start <= 0.04) g.push(n);
    else groups.push((g = [n]));
  }
  const dir = hand === "R" ? 1 : -1;

  interface Cand {
    f: number[];
    anchorKey: number;
    anchorF: number;
    cost: number;
  }
  const layers: Cand[][] = groups.map((grp) => {
    const sorted = grp.slice().sort((a, b) => a.key - b.key);
    const span = sorted[sorted.length - 1].key - sorted[0].key;
    const cands = candidatesFor(sorted.length, hand, span);
    const anchorIdx = hand === "R" ? sorted.length - 1 : 0;
    return cands.map((f) => {
      let cost = 0;
      for (let i = 0; i < f.length; i++) {
        const bk = blackKey(sorted[i].midi);
        if (bk && (f[i] === 1 || f[i] === 5)) cost += sorted.length === 1 ? 2.2 : 1.4;
        if (f[i] === 4) cost += 0.5;
        if (f[i] === 5) cost += 0.3;
      }
      for (let i = 1; i < f.length; i++) {
        const dk = sorted[i].key - sorted[i - 1].key;
        const df = Math.abs(f[i] - f[i - 1]);
        if (dk > 2 * df + 5) cost += (dk - 2 * df) * 0.5;
      }
      return { f, anchorKey: sorted[anchorIdx].key, anchorF: f[anchorIdx], cost };
    });
  });

  const trans = (a: Cand, b: Cand, gap: number) => {
    const d = b.anchorKey - a.anchorKey;
    const df = (b.anchorF - a.anchorF) * dir;
    const looseness = Math.min(1, 0.3 / Math.max(0.05, gap));
    let c = 0;
    if (d === 0) return b.anchorF === a.anchorF ? 0 : 0.8;
    if (df === 0) c += 6 * looseness + 0.5; // same finger on a new key
    else if (Math.sign(d) !== Math.sign(df)) {
      // crossing: thumb-under / finger-over
      const thumb = a.anchorF === 1 || b.anchorF === 1;
      c += thumb ? 2.4 : 6.5;
      c += Math.max(0, Math.abs(d) - 4) * 0.4;
    } else {
      const expected = 2 * Math.abs(df);
      const diff = Math.abs(Math.abs(d) - expected);
      c += diff * 0.45 * (0.5 + looseness);
      if (Math.abs(d) > expected + 5) c += (Math.abs(d) - expected - 5) * 0.8;
    }
    return c;
  };

  // Viterbi
  let prevCost = layers[0].map((c) => c.cost);
  const back: Int16Array[] = [new Int16Array(layers[0].length)];
  for (let i = 1; i < layers.length; i++) {
    const gap = groups[i][0].start - groups[i - 1][0].start;
    const cur = layers[i];
    const pl = layers[i - 1];
    const nc: number[] = new Array(cur.length);
    const bp = new Int16Array(cur.length);
    for (let j = 0; j < cur.length; j++) {
      let best = Infinity;
      let bi = 0;
      for (let k = 0; k < pl.length; k++) {
        const v = prevCost[k] + trans(pl[k], cur[j], gap);
        if (v < best) {
          best = v;
          bi = k;
        }
      }
      nc[j] = best + cur[j].cost;
      bp[j] = bi;
    }
    prevCost = nc;
    back.push(bp);
  }
  let bi = 0;
  for (let j = 1; j < prevCost.length; j++) if (prevCost[j] < prevCost[bi]) bi = j;
  for (let i = layers.length - 1; i >= 0; i--) {
    const cand = layers[i][bi];
    const sorted = groups[i].slice().sort((a, b) => a.key - b.key);
    sorted.forEach((n, idx) => (n.finger = cand.f[idx] ?? 3));
    bi = back[i][bi];
  }
}

/* ------------------------------- chords ------------------------------- */

const CHORD_TEMPLATES: Record<string, string> = {
  "0-4-7": "major",
  "0-3-7": "minor",
  "0-3-6": "dim",
  "0-4-8": "aug",
  "0-2-7": "sus2",
  "0-5-7": "sus4",
  "0-4-7-9": "maj6",
  "0-3-7-9": "min6",
  "0-4-7-11": "maj7",
  "0-4-7-10": "dom7",
  "0-3-7-10": "min7",
  "0-3-7-11": "minMaj7",
  "0-3-6-10": "halfDim7",
  "0-3-6-9": "dim7",
  "0-4-8-10": "aug7",
  "0-2-4-7": "add9",
  "0-2-3-7": "minAdd9",
  "0-2-4-7-10": "dom9",
  "0-2-4-7-11": "maj9",
  "0-4-10": "dom7",
  "0-4-11": "maj7",
  "0-3-10": "min7",
};
const CHORD_SUFFIX: Record<string, string> = {
  major: "",
  minor: "m",
  dim: "°",
  aug: "+",
  sus2: "sus2",
  sus4: "sus4",
  maj6: "6",
  min6: "m6",
  maj7: "maj7",
  dom7: "7",
  min7: "m7",
  minMaj7: "m(maj7)",
  halfDim7: "ø7",
  dim7: "°7",
  aug7: "7♯5",
  add9: "add9",
  minAdd9: "m(add9)",
  dom9: "9",
  maj9: "maj9",
};
const CHORD_WORDS: Record<string, string> = {
  major: "major",
  minor: "minor",
  dim: "diminished",
  aug: "augmented",
  sus2: "suspended 2nd",
  sus4: "suspended 4th",
  maj6: "major 6th",
  min6: "minor 6th",
  maj7: "major 7th",
  dom7: "dominant 7th",
  min7: "minor 7th",
  minMaj7: "minor-major 7th",
  halfDim7: "half-diminished 7th",
  dim7: "diminished 7th",
  aug7: "augmented 7th",
  add9: "major add9",
  minAdd9: "minor add9",
  dom9: "dominant 9th",
  maj9: "major 9th",
};
const MINORISH = new Set(["minor", "dim", "min6", "min7", "minMaj7", "halfDim7", "dim7", "minAdd9"]);
const ROMAN_MAJ = ["I", "♭II", "II", "♭III", "III", "IV", "♯IV", "V", "♭VI", "VI", "♭VII", "VII"];
const ROMAN_MIN = ["I", "♭II", "II", "III", "♯III", "IV", "♯IV", "V", "VI", "♯VI", "VII", "VII"];
const ROMAN_SUF: Record<string, string> = {
  dim: "°",
  aug: "+",
  sus2: "sus2",
  sus4: "sus4",
  maj6: "6",
  min6: "6",
  maj7: "maj7",
  dom7: "7",
  min7: "7",
  minMaj7: "(maj7)",
  halfDim7: "ø7",
  dim7: "°7",
  aug7: "+7",
  add9: "add9",
  minAdd9: "add9",
  dom9: "9",
  maj9: "maj9",
};

function spellPc(pc: number, sharps: number) {
  return (sharps > 0 ? NOTE_NAMES_SHARP : sharps < 0 ? NOTE_NAMES_FLAT : NOTE_NAMES_KEY)[pc];
}

function detectChords(song: Song): Chord[] {
  const out: Chord[] = [];
  const { notes, keySig } = song;
  const tonic = (((7 * keySig.sharps) % 12) + 12) % 12;
  const tonicPc = keySig.minor ? (tonic + 9) % 12 : tonic;
  let i = 0;
  while (i < notes.length) {
    let j = i + 1;
    while (j < notes.length && notes[j].start - notes[i].start <= 0.045) j++;
    const grp = notes.slice(i, j);
    i = j;
    if (grp.length < 3) continue;
    const sorted = grp.slice().sort((a, b) => a.midi - b.midi);
    const pcs = Array.from(new Set(sorted.map((n) => n.midi % 12)));
    if (pcs.length < 3) continue;
    const bass = sorted[0].midi % 12;
    const found: { root: number; q: string }[] = [];
    for (const root of pcs) {
      const key = pcs
        .map((p) => (p - root + 12) % 12)
        .sort((a, b) => a - b)
        .join("-");
      const q = CHORD_TEMPLATES[key];
      if (q) found.push({ root, q });
    }
    if (!found.length) continue;
    const pick = found.find((f) => f.root === bass) ?? found[0];
    const end = Math.max(...grp.map((n) => n.visEnd));
    if (end - grp[0].start < 0.12) continue;
    const rootName = spellPc(pick.root, keySig.sharps);
    const bassName = spellPc(bass, keySig.sharps);
    const slash = bass !== pick.root ? `/${bassName}` : "";
    const symbol = rootName + (CHORD_SUFFIX[pick.q] ?? "") + slash;
    const rel = (pick.root - tonicPc + 12) % 12;
    let rn = (keySig.minor ? ROMAN_MIN : ROMAN_MAJ)[rel];
    if (MINORISH.has(pick.q)) rn = rn.toLowerCase();
    rn += ROMAN_SUF[pick.q] ?? "";
    const hands = new Set(grp.map((n) => n.hand));
    out.push({
      start: grp[0].start,
      end,
      symbol,
      roman: rn,
      spelled: `${rootName} ${CHORD_WORDS[pick.q] ?? pick.q}${slash ? ` (over ${bassName})` : ""}`,
      keyLo: sorted[0].key,
      keyHi: sorted[sorted.length - 1].key,
      hand: hands.size > 1 ? "both" : (grp[0].hand as Hand),
    });
  }
  return out;
}

/* ----------------------------- query helpers ----------------------------- */

export function tempoAt(song: Song, t: number): TempoPoint {
  const ts = song.tempos;
  let lo = 0;
  let hi = ts.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ts[m].time <= t) lo = m;
    else hi = m - 1;
  }
  return ts[lo];
}

export function measureAt(song: Song, t: number): number {
  const ms = song.measures;
  if (t < ms[0].time - 1e-6) return 0;
  let lo = 0;
  let hi = ms.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (ms[m].time <= t + 1e-6) lo = m;
    else hi = m - 1;
  }
  return ms[lo].number;
}

/** First note index whose running-max release is >= t (start of the visible window). */
export function firstVisibleIndex(song: Song, t: number): number {
  const pm = song.prefixMaxEnd;
  let lo = 0;
  let hi = pm.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (pm[m] >= t) hi = m;
    else lo = m + 1;
  }
  return lo;
}

export function chordAt(song: Song, t: number): Chord | null {
  let best: Chord | null = null;
  for (const c of song.chords) {
    if (c.start > t) break;
    if (c.end > t) best = c;
  }
  return best;
}

export function pedalAt(song: Song, t: number): boolean {
  for (const p of song.sustain) {
    if (p.start > t) return false;
    if (p.end > t) return true;
  }
  return false;
}

export function formatTime(sec: number, ms = true): string {
  const neg = sec < -1e-4;
  const a = Math.abs(sec);
  const m = Math.floor(a / 60);
  const s = Math.floor(a % 60);
  const mm = Math.min(999, Math.round((a - Math.floor(a)) * 1000));
  const base = `${m}:${String(s).padStart(2, "0")}`;
  return (neg ? "−" : "") + (ms ? `${base}.${String(mm).padStart(3, "0")}` : base);
}
