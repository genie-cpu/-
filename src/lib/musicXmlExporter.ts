import { ScoreData, Note, VoicePart } from "../types";

function parseTimeSignature(timeSig: string): { beats: number; beatType: number } {
  const parts = timeSig.split("/");
  if (parts.length === 2) {
    const beats = parseInt(parts[0], 10);
    const beatType = parseInt(parts[1], 10);
    if (!isNaN(beats) && !isNaN(beatType)) {
      return { beats, beatType };
    }
  }
  return { beats: 4, beatType: 4 }; // Default 4/4
}

function parseNotePitch(noteStr: string): { step: string; alter: number; octave: number; isRest: boolean } {
  const trimmed = noteStr.trim();
  if (!trimmed || trimmed.toUpperCase() === "R") {
    return { step: "C", alter: 0, octave: 4, isRest: true };
  }

  const regex = /^([A-G])(#|b|s|f)?(-?\d+)$/i;
  const match = trimmed.toUpperCase().match(regex);
  if (!match) {
    return { step: "C", alter: 0, octave: 4, isRest: true };
  }

  const step = match[1];
  const acc = match[2];
  const octave = parseInt(match[3], 10);
  
  let alter = 0;
  if (acc === "#" || acc === "S") alter = 1;
  else if (acc === "B" || acc === "F") alter = -1;

  return { step, alter, octave, isRest: false };
}

// Convert beat duration to MusicXML node type string
function getNoteType(duration: number): string {
  if (duration >= 4) return "whole";
  if (duration >= 2) return "half";
  if (duration >= 1) return "quarter";
  if (duration >= 0.5) return "eighth";
  if (duration >= 0.25) return "16th";
  return "32nd";
}

export function exportToMusicXML(score: ScoreData): string {
  const { beats, beatType } = parseTimeSignature(score.timeSignature);
  const divisions = 4; // 1 division = 16th note (0.25 beat) -> so 1 beat (quarter note) = 4 divisions

  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE score-partwise PUBLIC
    "-//Recordare//DTD MusicXML 4.0 Partwise//EN"
    "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work>
    <work-title>${score.title || "Choral Output"}</work-title>
  </work>
  <identification>
    <creator type="composer">${score.composer || "AI Transcriber"}</creator>
    <encoding>
      <software>MusicXML Exporter for ChoralSplit AI</software>
    </encoding>
  </identification>
  <part-list>
    <score-part id="P1">
      <part-name>Soprano</part-name>
      <part-abbreviation>S.</part-abbreviation>
    </score-part>
    <score-part id="P2">
      <part-name>Alto</part-name>
      <part-abbreviation>A.</part-abbreviation>
    </score-part>
    <score-part id="P3">
      <part-name>Tenor</part-name>
      <part-abbreviation>T.</part-abbreviation>
    </score-part>
    <score-part id="P4">
      <part-name>Bass</part-name>
      <part-abbreviation>B.</part-abbreviation>
    </score-part>
  </part-list>
`;

  const parts: { key: VoicePart; id: string }[] = [
    { key: "soprano", id: "P1" },
    { key: "alto", id: "P2" },
    { key: "tenor", id: "P3" },
    { key: "bass", id: "P4" },
  ];

  parts.forEach(({ key, id }) => {
    xml += `  <part id="${id}">\n`;
    
    const notes = score.parts[key] || [];
    let beatAccumulator = 0;
    let measureIndex = 1;
    let measureNotes: Note[] = [];

    // Group notes into measures based on TimeSignature beats
    const measures: Note[][] = [];
    let currentMeasure: Note[] = [];
    let currentSum = 0;

    notes.forEach((note) => {
      currentMeasure.push(note);
      currentSum += note.duration;
      if (currentSum >= beats) {
        measures.push(currentMeasure);
        currentMeasure = [];
        currentSum = 0;
      }
    });
    // Add any trailing notes
    if (currentMeasure.length > 0) {
      measures.push(currentMeasure);
    }

    // Default empty measure fallback
    if (measures.length === 0) {
      measures.push([{ note: "R", duration: 4.0 }]);
    }

    measures.forEach((mNotes, mIdx) => {
      const isFirst = mIdx === 0;
      xml += `    <measure number="${mIdx + 1}">\n`;
      
      if (isFirst) {
        // Setup signature attributes in first measure
        xml += `      <attributes>\n`;
        xml += `        <divisions>${divisions}</divisions>\n`;
        xml += `        <key>\n`;
        xml += `          <fifths>0</fifths>\n`; // default C Major
        xml += `          <mode>major</mode>\n`;
        xml += `        </key>\n`;
        xml += `        <time>\n`;
        xml += `          <beats>${beats}</beats>\n`;
        xml += `          <beat-type>${beatType}</beat-type>\n`;
        xml += `        </time>\n`;
        
        // Different clefs per choral voice range
        if (key === "soprano" || key === "alto") {
          xml += `        <clef>\n`;
          xml += `          <sign>G</sign>\n`;
          xml += `          <line>2</line>\n`;
          xml += `        </clef>\n`;
        } else {
          xml += `        <clef>\n`;
          xml += `          <sign>F</sign>\n`;
          xml += `          <line>4</line>\n`;
          xml += `        </clef>\n`;
        }
        xml += `      </attributes>\n`;
        
        // Sound & Tempo element
        xml += `      <direction placement="above">\n`;
        xml += `        <direction-type>\n`;
        xml += `          <metronome>\n`;
        xml += `            <beat-unit>quarter</beat-unit>\n`;
        xml += `            <per-minute>${score.tempo || 90}</per-minute>\n`;
        xml += `          </metronome>\n`;
        xml += `        </direction-type>\n`;
        xml += `        <sound tempo="${score.tempo || 90}"/>\n`;
        xml += `      </direction>\n`;
      }

      mNotes.forEach((n) => {
        const p = parseNotePitch(n.note);
        const xmlDuration = Math.round(n.duration * divisions);
        const noteType = getNoteType(n.duration);

        xml += `      <note>\n`;
        if (p.isRest) {
          xml += `        <rest/>\n`;
        } else {
          xml += `        <pitch>\n`;
          xml += `          <step>${p.step}</step>\n`;
          if (p.alter !== 0) {
            xml += `          <alter>${p.alter}</alter>\n`;
          }
          xml += `          <octave>${p.octave}</octave>\n`;
          xml += `        </pitch>\n`;
        }
        xml += `        <duration>${xmlDuration}</duration>\n`;
        xml += `        <voice>1</voice>\n`;
        xml += `        <type>${noteType}</type>\n`;
        if (!p.isRest && p.alter !== 0) {
          xml += `        <accidental>${p.alter === 1 ? "sharp" : "flat"}</accidental>\n`;
        }
        xml += `      </note>\n`;
      });

      xml += `    </measure>\n`;
    });

    xml += `  </part>\n`;
  });

  xml += `</score-partwise>\n`;
  return xml;
}
