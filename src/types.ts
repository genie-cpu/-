export interface Note {
  note: string;     // 예: "C4", "E4", "G4", "R" (R은 쉼표)
  duration: number; // 박 단위: 1.0 (4분음표), 0.5 (8분음표), 2.0 (2분음표), 4.0 (온음표), 0.25 (16분음표)
}

export interface ScoreData {
  title: string;
  composer: string;
  tempo: number;         // BPM
  timeSignature: string; // 예: "4/4", "3/4", "6/8"
  keySignature: string;  // 예: "C Major", "G Major"
  parts: {
    soprano: Note[];
    alto: Note[];
    tenor: Note[];
    bass: Note[];
  };
}

export type VoicePart = 'soprano' | 'alto' | 'tenor' | 'bass';

export interface PartControl {
  volume: number; // 0.0 ~ 1.0
  isMuted: boolean;
  isSolo: boolean;
}
