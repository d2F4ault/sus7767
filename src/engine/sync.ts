import { formatTime, type Song } from "./midi";
import type { SyncConfig } from "./types";

export interface SyncManifest {
  generator: string;
  midi: { fileName: string; title: string; ppq: number; noteCount: number; durationSeconds: number };
  synchronization: {
    law: string;
    midiToVideoOffsetSeconds: number;
    midiToVideoOffsetFrames: number;
    firstNoteMidiTimeSeconds: number;
    firstNoteVideoTimeSeconds: number;
    firstNoteVideoFrame: number;
    lastNoteOffMidiTimeSeconds: number;
    lastNoteOffVideoTimeSeconds: number;
    lastNoteOffVideoFrame: number;
  };
  video: { width: number; height: number; fps: number; totalFrames: number; durationSeconds: number; profile: string; audioStreams: 0 };
  midiSummary: { tempoChanges: { tick: number; bpm: number; midiTimeSeconds: number; videoFrame: number }[] };
  muxHint: string;
}

export function offsetSeconds(sync: SyncConfig) {
  return Math.round(sync.leadInSeconds * sync.fps) / sync.fps;
}

export function totalFrames(song: Song, sync: SyncConfig) {
  return Math.max(1, Math.ceil((sync.leadInSeconds + song.duration + sync.tailOutSeconds) * sync.fps));
}

export function frameOfMidiTime(t: number, sync: SyncConfig) {
  return Math.round((t + sync.leadInSeconds) * sync.fps);
}

export function midiTimeOfFrame(frame: number, sync: SyncConfig) {
  return frame / sync.fps - sync.leadInSeconds;
}

export function buildManifest(song: Song, sync: SyncConfig): SyncManifest {
  const first = song.notes[0].start;
  const lastOff = song.duration;
  const off = sync.leadInSeconds;
  const frames = totalFrames(song, sync);
  return {
    generator: "Clavier · Midiano Engine",
    midi: { fileName: song.fileName, title: song.name, ppq: song.ppq, noteCount: song.notes.length, durationSeconds: +song.duration.toFixed(6) },
    synchronization: {
      law: "t_video = t_midi + midiToVideoOffsetSeconds",
      midiToVideoOffsetSeconds: off,
      midiToVideoOffsetFrames: Math.round(off * sync.fps),
      firstNoteMidiTimeSeconds: first,
      firstNoteVideoTimeSeconds: first + off,
      firstNoteVideoFrame: frameOfMidiTime(first, sync),
      lastNoteOffMidiTimeSeconds: lastOff,
      lastNoteOffVideoTimeSeconds: lastOff + off,
      lastNoteOffVideoFrame: frameOfMidiTime(lastOff, sync),
    },
    video: {
      width: sync.width,
      height: sync.height,
      fps: sync.fps,
      totalFrames: frames,
      durationSeconds: frames / sync.fps,
      profile: sync.qualityProfile,
      audioStreams: 0,
    },
    midiSummary: {
      tempoChanges: song.tempos.map((t) => ({ tick: t.tick, bpm: +t.bpm.toFixed(4), midiTimeSeconds: t.time, videoFrame: frameOfMidiTime(t.time, sync) })),
    },
    muxHint: `ffmpeg -i video.mp4 -itsoffset ${off.toFixed(6)} -i audio.wav -c:v copy -c:a aac -b:a 320k muxed.mp4`,
  };
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function downloadManifest(song: Song, sync: SyncConfig, base?: string) {
  const m = buildManifest(song, sync);
  downloadBlob(new Blob([JSON.stringify(m, null, 2)], { type: "application/json" }), `${base ?? song.fileName.replace(/\.(mid|midi)$/i, "")}.mp4.sync.json`);
}

export { formatTime };
