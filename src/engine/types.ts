export type ColorMode = "hand" | "finger" | "pitch" | "colorblind" | "monochrome";
export type NoteLabelMode = "fingering" | "noteName" | "solfege" | "scaleDegree" | "none";
export type KeyLabelMode = "onlyC" | "allWhite" | "all88" | "solfege" | "none";
export type HandFilter = "both" | "right" | "left";

export interface RenderSettings {
  noteFallSeconds: number;
  colorMode: ColorMode;
  noteLabelMode: NoteLabelMode;
  keyLabelMode: KeyLabelMode;
  useFlats: boolean;
  showMeasureLines: boolean;
  showBeatLines: boolean;
  showMeasureNumbers: boolean;
  showSustainPedal: boolean;
  showSustainTails: boolean;
  showChordBanner: boolean;
  showChordBrackets: boolean;
  showKeyLaneGuides: boolean;
  showIncomingKeyPreview: boolean;
  incomingLookAheadSeconds: number;
  showStrikeContactBar: boolean;
  showHudMetadata: boolean;
  acousticBlackKeyOffsets: boolean;
  autoZoomRange: boolean;
  showKeyMinimap: boolean;
  showAcousticBloom: boolean;
  ambientDust: boolean;
  activeHandFilter: HandFilter;
  mutedTracks: number[];
  pianoHeightRatio: number;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  noteFallSeconds: 2.4,
  colorMode: "hand",
  noteLabelMode: "fingering",
  keyLabelMode: "onlyC",
  useFlats: false,
  showMeasureLines: true,
  showBeatLines: true,
  showMeasureNumbers: true,
  showSustainPedal: true,
  showSustainTails: true,
  showChordBanner: true,
  showChordBrackets: true,
  showKeyLaneGuides: true,
  showIncomingKeyPreview: true,
  incomingLookAheadSeconds: 0.45,
  showStrikeContactBar: true,
  showHudMetadata: true,
  acousticBlackKeyOffsets: true,
  autoZoomRange: false,
  showKeyMinimap: true,
  showAcousticBloom: true,
  ambientDust: false,
  activeHandFilter: "both",
  mutedTracks: [],
  pianoHeightRatio: 0.205,
};

export type QualityProfile = "rgb-lossless" | "yuv444-lossless" | "compatible-lossless";

export interface SyncConfig {
  width: number;
  height: number;
  fps: number;
  leadInSeconds: number;
  tailOutSeconds: number;
  qualityProfile: QualityProfile;
}

export const DEFAULT_SYNC: SyncConfig = {
  width: 1920,
  height: 1080,
  fps: 60,
  leadInSeconds: 2,
  tailOutSeconds: 1,
  qualityProfile: "rgb-lossless",
};
