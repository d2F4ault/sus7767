import { MIDI_DATA } from "./songData";
import { base64ToBytes, parseMidi, type Song, type SongMeta } from "./midi";

export const REPERTOIRE: SongMeta[] = [
  {
    id: "bach_846",
    fileName: "bach_846.mid",
    name: "Prelude in C Major, BWV 846",
    artist: "Johann Sebastian Bach",
    piece: "The Well-Tempered Clavier, Book I",
    copyright: "Bernd Krueger (piano-midi.de)",
    difficulty: 2,
  },
  {
    id: "elise",
    fileName: "elise.mid",
    name: "Bagatelle No. 25 in A Minor (Für Elise), WoO 59",
    artist: "Ludwig van Beethoven",
    piece: "Solo Piano Bagatelle",
    copyright: "Bernd Krueger (piano-midi.de)",
    difficulty: 2,
  },
  {
    id: "mond_1",
    fileName: "mond_1.mid",
    name: "Piano Sonata No. 14 in C♯ Minor (Moonlight), Op. 27 No. 2 — I. Adagio sostenuto",
    artist: "Ludwig van Beethoven",
    piece: "Sonata quasi una fantasia",
    copyright: "Bernd Krueger (piano-midi.de)",
    difficulty: 3,
  },
  {
    id: "mz_545_1",
    fileName: "mz_545_1.mid",
    name: "Piano Sonata No. 16 in C Major (Sonata facile), K. 545 — I. Allegro",
    artist: "Wolfgang Amadeus Mozart",
    piece: "Sonata facile",
    copyright: "Bernd Krueger (piano-midi.de)",
    difficulty: 3,
  },
  {
    id: "twinkle",
    fileName: "twinkle.mid",
    name: "Ah! vous dirai-je, maman (Twinkle, Twinkle, Little Star)",
    artist: "Traditional / Beginner Study",
    piece: "First-Hour Beginner Primer",
    copyright: "Midiano Public Domain",
    difficulty: 1,
  },
  {
    id: "torture_test",
    fileName: "torture_test.mid",
    name: "88-Key Multi-Tempo Sync & Sustain Verification Etude",
    artist: "Calibration & QA Suite",
    piece: "A0–C8 Extremes · 120→180→90→240 BPM · Sustain & Trills",
    copyright: "Deterministic Verification Fixture",
    difficulty: 4,
  },
];

export function shortTitle(name: string) {
  // "Prelude in C Major, BWV 846" -> keep, but trim long parenthetical / movement suffix for compact UI
  const dash = name.indexOf(" — ");
  const base = dash > 0 ? name.slice(0, dash) : name;
  return base;
}

export function loadBuiltIn(id: string): Song {
  const meta = REPERTOIRE.find((m) => m.id === id) ?? REPERTOIRE[0];
  return parseMidi(base64ToBytes(MIDI_DATA[meta.id]), meta);
}

export function loadCustom(bytes: Uint8Array, fileName: string): Song {
  return parseMidi(bytes, {
    id: "custom",
    fileName,
    name: fileName.replace(/\.(mid|midi)$/i, ""),
    artist: "Custom MIDI file",
  });
}
