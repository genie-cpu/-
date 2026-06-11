import { Note, ScoreData, VoicePart, PartControl } from "../types";

// Pitch to Hertz converter
export function noteToFrequency(note: string): number {
  if (!note || note.toUpperCase() === "R") return 0; // Rest (쉼표)
  
  const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const regex = /^([A-G]#?)(-?\d+)$/;
  const match = note.toUpperCase().match(regex);
  if (!match) return 0;
  
  const noteName = match[1];
  const octave = parseInt(match[2]);
  const semitone = notes.indexOf(noteName);
  
  // MIDI number calculation (C4 is 60)
  const midi = 12 * (octave + 1) + semitone;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Low level audio synthesis of piano pluck
export function playPianoNote(
  ctx: BaseAudioContext,
  frequency: number,
  startTime: number,
  duration: number,
  destNode: AudioNode
) {
  if (frequency <= 0) return;

  const gain = ctx.createGain();
  gain.connect(destNode);

  // Piano ASDR envelope
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.4, startTime + 0.005); // Rapid onset (Attack)
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration); // Slow decay to rest

  // Fundamental wave: triangle is warmer than square/saw
  const oscMain = ctx.createOscillator();
  oscMain.type = "triangle";
  oscMain.frequency.setValueAtTime(frequency, startTime);
  oscMain.connect(gain);

  // Body acoustic simulation (sub-sine)
  const oscSub = ctx.createOscillator();
  oscSub.type = "sine";
  oscSub.frequency.setValueAtTime(frequency, startTime);
  const subGain = ctx.createGain();
  subGain.gain.setValueAtTime(0.18, startTime);
  subGain.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.85);
  oscSub.connect(subGain);
  subGain.connect(destNode);

  // 1st overtone (2x freq) - decays quickly
  const oscOvertone1 = ctx.createOscillator();
  oscOvertone1.type = "sine";
  oscOvertone1.frequency.setValueAtTime(frequency * 2, startTime);
  const overGain1 = ctx.createGain();
  overGain1.gain.setValueAtTime(0.12, startTime);
  overGain1.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.4);
  oscOvertone1.connect(overGain1);
  overGain1.connect(destNode);

  // 2nd overtone (3x freq) - decays even more quickly
  const oscOvertone2 = ctx.createOscillator();
  oscOvertone2.type = "sine";
  oscOvertone2.frequency.setValueAtTime(frequency * 3, startTime);
  const overGain2 = ctx.createGain();
  overGain2.gain.setValueAtTime(0.06, startTime);
  overGain2.gain.exponentialRampToValueAtTime(0.001, startTime + duration * 0.2);
  oscOvertone2.connect(overGain2);
  overGain2.connect(destNode);

  // Start & 스케줄링 소거
  oscMain.start(startTime);
  oscSub.start(startTime);
  oscOvertone1.start(startTime);
  oscOvertone2.start(startTime);

  const stopTime = startTime + duration;
  oscMain.stop(stopTime);
  oscSub.stop(stopTime);
  oscOvertone1.stop(stopTime);
  oscOvertone2.stop(stopTime);
}

// Convert AudioBuffer into a binary WAV Blob (Client Side Offline synthesis outcome)
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = 16-bit PCM UNCOMPRESSED
  const bitDepth = 16;
  
  let result: Float32Array;
  if (numOfChan === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }
  
  const bufferLen = result.length * 2;
  const wavBuffer = new ArrayBuffer(44 + bufferLen);
  const view = new DataView(wavBuffer);
  
  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + bufferLen, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk length */
  view.setUint32(40, bufferLen, true);
  
  floatTo16BitPCM(view, 44, result);
  
  return new Blob([view], { type: "audio/wav" });
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;
  
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Offline Audio Renderer - Renders specific part or mix of parts into a WAV Blob
 * Executes at super speed background thread!
 */
export async function renderScoreToWav(
  score: ScoreData,
  selectedParts: Record<VoicePart, boolean>,
  tempoBpm: number
): Promise<Blob> {
  const secondsPerBeat = 60 / tempoBpm;
  
  // Calculate max track duration
  let maxBeats = 0;
  (Object.keys(score.parts) as VoicePart[]).forEach((part) => {
    if (selectedParts[part]) {
      const beats = score.parts[part].reduce((sum, n) => sum + n.duration, 0);
      if (beats > maxBeats) maxBeats = beats;
    }
  });

  if (maxBeats === 0) {
    // Empty output buffer if no part selected
    maxBeats = 4; 
  }

  const durationSec = maxBeats * secondsPerBeat + 1.0; // add padding buffer
  const sampleRate = 44100;
  const offlineCtx = new OfflineAudioContext(2, sampleRate * durationSec, sampleRate);

  // Setup master gain
  const masterGain = offlineCtx.createGain();
  masterGain.gain.setValueAtTime(0.8, 0);
  masterGain.connect(offlineCtx.destination);

  // Synthesize each active voice part
  (Object.keys(score.parts) as VoicePart[]).forEach((part) => {
    if (!selectedParts[part]) return;

    const partNotes = score.parts[part];
    let currentBeat = 0;

    partNotes.forEach((item) => {
      const startTime = currentBeat * secondsPerBeat;
      const noteDuration = item.duration * secondsPerBeat;
      const freq = noteToFrequency(item.note);

      if (freq > 0) {
        // Slightly pan different vocal layers to give spacious stereo image
        let panner: StereoPannerNode | null = null;
        let targetNode: AudioNode = masterGain;

        try {
          panner = offlineCtx.createStereoPanner();
          if (part === "soprano") panner.pan.setValueAtTime(-0.3, startTime);
          else if (part === "alto") panner.pan.setValueAtTime(-0.1, startTime);
          else if (part === "tenor") panner.pan.setValueAtTime(0.1, startTime);
          else if (part === "bass") panner.pan.setValueAtTime(0.3, startTime);
          panner.connect(masterGain);
          targetNode = panner;
        } catch (e) {
          // Fallback if SternoPanner is not supported
        }

        playPianoNote(offlineCtx, freq, startTime, noteDuration, targetNode);
      }
      currentBeat += item.duration;
    });
  });

  const renderedBuffer = await offlineCtx.startRendering();
  return audioBufferToWav(renderedBuffer);
}
