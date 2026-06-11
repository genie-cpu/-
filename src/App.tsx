import React, { useState, useEffect, useRef } from "react";
import { 
  Upload, 
  Volume2, 
  VolumeX, 
  Play, 
  Square, 
  Download, 
  Music, 
  Check, 
  Loader2, 
  HelpCircle, 
  RefreshCw, 
  AlertCircle, 
  FileAudio,
  Eye,
  Sliders,
  Sparkles
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { ScoreData, VoicePart, PartControl } from "./types";
import { demoScores } from "./data/demoScores";
import { noteToFrequency, playPianoNote, renderScoreToWav } from "./lib/audioEngine";
import { exportToMusicXML } from "./lib/musicXmlExporter";

export default function App() {
  // Primary state: Active score data
  const [currentScore, setCurrentScore] = useState<ScoreData>(demoScores[0]);
  const [customScores, setCustomScores] = useState<ScoreData[]>([]);
  
  // File upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgressText, setUploadProgressText] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState<number>(demoScores[0].tempo);
  const [elapsedBeats, setElapsedBeats] = useState<number>(0);
  const [totalBeats, setTotalBeats] = useState<number>(0);

  // Mixer custom controls
  const [partControls, setPartControls] = useState<Record<VoicePart, PartControl>>({
    soprano: { volume: 0.8, isMuted: false, isSolo: false },
    alto: { volume: 0.8, isMuted: false, isSolo: false },
    tenor: { volume: 0.8, isMuted: false, isSolo: false },
    bass: { volume: 0.8, isMuted: false, isSolo: false },
  });

  // Background rendering download states
  const [renderingPart, setRenderingPart] = useState<string | null>(null);

  // Audio Context Ref for real-time play
  const audioCtxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const lastActiveNotesRef = useRef<Record<VoicePart, string>>({
    soprano: "-",
    alto: "-",
    tenor: "-",
    bass: "-",
  });

  // Part Gain nodes dynamically updated on fly during playback
  const gainNodesRef = useRef<Record<VoicePart, GainNode | null>>({
    soprano: null,
    alto: null,
    tenor: null,
    bass: null,
  });

  // Active playing notes for UI state highlight
  const [activeNotes, setActiveNotes] = useState<Record<VoicePart, string>>({
    soprano: "-",
    alto: "-",
    tenor: "-",
    bass: "-",
  });

  // Clean values on change of score
  useEffect(() => {
    stopScore();
    setTempo(currentScore.tempo);
    
    // Calculate total beats for current track
    const maxPartBeats = (Object.keys(currentScore.parts) as VoicePart[]).reduce((max, part) => {
      const beats = currentScore.parts[part].reduce((sum, n) => sum + n.duration, 0);
      return beats > max ? beats : max;
    }, 0);
    setTotalBeats(maxPartBeats);
    setElapsedBeats(0);
    setActiveNotes({ soprano: "-", alto: "-", tenor: "-", bass: "-" });
  }, [currentScore]);

  // Handle live volume updates during active playing
  useEffect(() => {
    (Object.keys(partControls) as VoicePart[]).forEach((part) => {
      const node = gainNodesRef.current[part];
      if (node && audioCtxRef.current) {
        const ctrl = partControls[part];
        
        // Determine active volume accounting for Solo status
        let targetVolume = ctrl.isMuted ? 0 : ctrl.volume;
        
        // Check if any other part is in 'Solo' mode
        const anyoneSolo = (Object.keys(partControls) as VoicePart[]).some(
          (p) => partControls[p].isSolo
        );
        if (anyoneSolo && !ctrl.isSolo) {
          targetVolume = 0; // Duck to zero if someone else has Solo on
        }

        node.gain.setTargetAtTime(targetVolume, audioCtxRef.current.currentTime, 0.1);
      }
    });
  }, [partControls]);

  // Dynamic progress loader phrase cycler
  useEffect(() => {
    if (!isUploading) return;
    const phrases = [
      "PDF 악보를 정밀 전송하고 있습니다...",
      "AI 모델이 악정 오선지를 리스닝하고 있습니다...",
      "소프라노 성부의 멜로디 음정과 박자를 정밀 계측하는 중...",
      "알토 및 테너 하모니 라인을 동기화 튜닝하는 중...",
      "베이스 성부의 중후한 근음 주파수를 정밀 추출하는 중...",
      "4성부 파지티브 가상 악보를 조립하고 있습니다..."
    ];
    let idx = 0;
    setUploadProgressText(phrases[0]);
    const timer = setInterval(() => {
      idx = (idx + 1) % phrases.length;
      setUploadProgressText(phrases[idx]);
    }, 3000);
    return () => clearInterval(timer);
  }, [isUploading]);

  // Real-time progress updater
  const startProgressTimer = (bpm: number) => {
    const beatsPerSec = bpm / 60;
    const updateRateMs = 50; // update speed
    
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = window.setInterval(() => {
      if (!audioCtxRef.current || audioCtxRef.current.state === "suspended") return;
      
      const elapsedSec = audioCtxRef.current.currentTime - startTimeRef.current;
      const currentBeatsCalculated = elapsedSec * beatsPerSec;

      if (currentBeatsCalculated >= totalBeats) {
        // Track finished
        stopScore();
      } else {
        setElapsedBeats(currentBeatsCalculated);
        calculateActiveNotes(currentBeatsCalculated);
      }
    }, updateRateMs);
  };

  // Find which specific note is active at this exact beat count
  const calculateActiveNotes = (currentBeat: number) => {
    const updated: Record<VoicePart, string> = { soprano: "-", alto: "-", tenor: "-", bass: "-" };
    
    (Object.keys(currentScore.parts) as VoicePart[]).forEach((part) => {
      const partNotes = currentScore.parts[part];
      let cumulative = 0;
      let found = false;

      for (let i = 0; i < partNotes.length; i++) {
        const noteObj = partNotes[i];
        if (currentBeat >= cumulative && currentBeat < cumulative + noteObj.duration) {
          updated[part] = noteObj.note === "R" || noteObj.note === "r" ? "쉼표 (Rest)" : noteObj.note;
          found = true;
          break;
        }
        cumulative += noteObj.duration;
      }
      if (!found) updated[part] = "-";
    });

    // High performance state throttling
    if (
      updated.soprano !== lastActiveNotesRef.current.soprano ||
      updated.alto !== lastActiveNotesRef.current.alto ||
      updated.tenor !== lastActiveNotesRef.current.tenor ||
      updated.bass !== lastActiveNotesRef.current.bass
    ) {
      setActiveNotes(updated);
      lastActiveNotesRef.current = updated;
    }
  };

  // Real-time Playback trigger
  const playScore = async () => {
    if (isPlaying) {
      stopScore();
      return;
    }

    try {
      // Setup Audio Context
      const AudioCtxConstructor = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtxConstructor();
      audioCtxRef.current = ctx;

      // Unblock suspended state from browser interaction policies
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      setIsPlaying(true);
      startTimeRef.current = ctx.currentTime;
      setElapsedBeats(0);

      const secondsPerBeat = 60 / tempo;

      // Master Gain for peak safety
      const finalDest = ctx.createGain();
      finalDest.gain.setValueAtTime(0.75, ctx.currentTime);
      finalDest.connect(ctx.destination);

      // Create part specific gains
      (Object.keys(currentScore.parts) as VoicePart[]).forEach((part) => {
        const partGain = ctx.createGain();
        partGain.connect(finalDest);
        gainNodesRef.current[part] = partGain;

        // Apply initial volume/mute settings
        const ctrl = partControls[part];
        let targetVol = ctrl.isMuted ? 0 : ctrl.volume;
        
        // Account for any active solo
        const anyoneSolo = (Object.keys(partControls) as VoicePart[]).some((p) => partControls[p].isSolo);
        if (anyoneSolo && !ctrl.isSolo) {
          targetVol = 0;
        }
        
        partGain.gain.setValueAtTime(targetVol, ctx.currentTime);

        // Schedule all note events inside this part channel
        const notes = currentScore.parts[part];
        let runningBeatOffset = 0;

        notes.forEach((noteItem) => {
          const noteStartSec = runningBeatOffset * secondsPerBeat;
          const noteDurationSec = noteItem.duration * secondsPerBeat;
          const freq = noteToFrequency(noteItem.note);

          if (freq > 0) {
            // Apply slight stereo spacing per part for outstanding lush depth
            let pannerNode: StereoPannerNode | null = null;
            let finalTargetNode: AudioNode = partGain;

            try {
              pannerNode = ctx.createStereoPanner();
              if (part === "soprano") pannerNode.pan.setValueAtTime(-0.35, ctx.currentTime + noteStartSec);
              else if (part === "alto") pannerNode.pan.setValueAtTime(-0.12, ctx.currentTime + noteStartSec);
              else if (part === "tenor") pannerNode.pan.setValueAtTime(0.12, ctx.currentTime + noteStartSec);
              else if (part === "bass") pannerNode.pan.setValueAtTime(0.35, ctx.currentTime + noteStartSec);
              pannerNode.connect(partGain);
              finalTargetNode = pannerNode;
            } catch (pannerErr) {
              // Ignore if browser doesn't support StereoPanner
            }

            playPianoNote(ctx, freq, ctx.currentTime + noteStartSec, noteDurationSec, finalTargetNode);
          }
          runningBeatOffset += noteItem.duration;
        });
      });

      startProgressTimer(tempo);

    } catch (err: any) {
      console.error("Playback failed to initialize:", err);
      alert("오디오 출력 장치에 연결하지 못했습니다. 브라우저 설정을 확인하세요.");
      stopScore();
    }
  };

  // Stop Score and clean Context
  const stopScore = () => {
    setIsPlaying(false);
    setElapsedBeats(0);
    setActiveNotes({ soprano: "-", alto: "-", tenor: "-", bass: "-" });
    lastActiveNotesRef.current = { soprano: "-", alto: "-", tenor: "-", bass: "-" };

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch (e) {}
      audioCtxRef.current = null;
    }

    gainNodesRef.current = { soprano: null, alto: null, tenor: null, bass: null };
  };

  // Single or Multi Part Piano WAV synthesis and trigger download
  const handleDownloadPart = async (partName: string | "all") => {
    if (renderingPart) return;
    
    try {
      setRenderingPart(partName);

      // Determine parts to render
      const activeRenderingParts: Record<VoicePart, boolean> = {
        soprano: false,
        alto: false,
        tenor: false,
        bass: false,
      };

      if (partName === "all") {
        // Full choral ensemble mix download
        activeRenderingParts.soprano = true;
        activeRenderingParts.alto = true;
        activeRenderingParts.tenor = true;
        activeRenderingParts.bass = true;
      } else {
        // Individual part piano download
        activeRenderingParts[partName as VoicePart] = true;
      }

      // Execute hyper speed background offline audio synthesis 
      const wavBlob = await renderScoreToWav(currentScore, activeRenderingParts, tempo);
      
      // Auto trigger browser download
      const downloadUrl = URL.createObjectURL(wavBlob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      
      // Polish filename
      const formattedTitle = currentScore.title.replace(/\s+/g, "_");
      const partSuffix = partName === "all" ? "전체합창믹스" : partName.toUpperCase();
      link.download = `${formattedTitle}_[피아노음원_${partSuffix}].wav`;
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);

    } catch (err: any) {
      console.error("Offline render failure:", err);
      alert("음원 생성 및 오프라인 렌더링에 실패했습니다. 코드를 점검해주세요.");
    } finally {
      setRenderingPart(null);
    }
  };

  // File Upload parsing processor
  const handleScoreFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf" && !file.name.endsWith(".pdf")) {
      setUploadError("PDF 포맷 악보 파일만 업로드할 수 있습니다.");
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgressText("악보 파일을 불러와 바이너리로 인코딩하는 중...");

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64Content = (reader.result as string).split(",")[1];
        
        // Invoke local API
        const response = await fetch("/api/analyze-score", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            base64: base64Content,
            fileName: file.name,
            mimeType: file.type,
          }),
        });

        if (!response.ok) {
          const errPayload = await response.json();
          throw new Error(errPayload.error || "서버 응답 오류 발생");
        }

        const scoreParsed: ScoreData = await response.json();

        // Safety structure formatting
        if (!scoreParsed.parts || !scoreParsed.parts.soprano || !scoreParsed.parts.bass) {
          throw new Error("수신된 악보 악편 포맷이 손상되었습니다.");
        }

        // Add custom score
        setCustomScores(prev => [scoreParsed, ...prev]);
        setCurrentScore(scoreParsed);

      } catch (err: any) {
        console.error("PDF score transcribing failed:", err);
        setUploadError(`악보 해석에 실패했습니다. (원인: ${err.message || "Gemini 분석 거부"}). \n일반 합창 4부 오선지 PDF가 맞는지 확인하고 다시 시도해보세요.`);
      } finally {
        setIsUploading(false);
      }
    };

    reader.onerror = () => {
      setUploadError("파일을 안전하게 로드하는 데 무산되었습니다.");
      setIsUploading(false);
    };

    reader.readAsDataURL(file);
  };

  // Mixer control handlers
  const toggleMute = (part: VoicePart) => {
    setPartControls((prev) => ({
      ...prev,
      [part]: { ...prev[part], isMuted: !prev[part].isMuted },
    }));
  };

  const toggleSolo = (part: VoicePart) => {
    setPartControls((prev) => {
      const currentSoloState = prev[part].isSolo;
      const updated = { ...prev };
      
      // Deactivate all solos first
      (Object.keys(updated) as VoicePart[]).forEach((p) => {
        updated[p] = { ...updated[p], isSolo: false };
      });

      // Toggle current
      updated[part].isSolo = !currentSoloState;
      return updated;
    });
  };

  const handleVolumeChange = (part: VoicePart, value: number) => {
    setPartControls((prev) => ({
      ...prev,
      [part]: { ...prev[part], volume: value },
    }));
  };

  // Helpers for visuals
  const formatBeatTime = (beats: number) => {
    const min = Math.floor(beats / 4);
    const remainingBeats = Math.floor(beats % 4) + 1;
    return `${min + 1}마디, ${remainingBeats}박`;
  };

  const handleDownloadMusicXML = () => {
    try {
      const xmlContent = exportToMusicXML(currentScore);
      const blob = new Blob([xmlContent], { type: "application/vnd.recordare.musicxml+xml" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const cleanTitle = currentScore.title.trim().replace(/\s+/g, "_");
      link.download = `${cleanTitle}.musicxml`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("MusicXML export failed", e);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans" id="app_root">
      {/* Elegantly Crafted Bar Header */}
      <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50 animate-fade-in" id="app_header">
        <div className="max-w-7xl w-full mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Sparkles className="w-5 h-5 text-white animate-pulse" />
            </div>
            <h1 className="text-lg md:text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
              합창 파트별 피아노 음원 생성기 <span className="text-indigo-400 font-mono text-sm">AI</span>
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-6 text-xs md:text-sm font-semibold text-slate-400 mr-4">
              <span className="text-white border-b-2 border-indigo-500 pb-1 cursor-pointer">스위트 홈</span>
              <span className="hover:text-white transition-colors cursor-pointer">파트 라이브러리</span>
              <span className="hover:text-white transition-colors cursor-pointer">렌더링 세팅</span>
            </div>
            
            <button className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-xs font-semibold tracking-wide transition-all shadow-lg shadow-indigo-500/20 whitespace-nowrap cursor-pointer">
              Premium Upgrade
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 lg:px-8 flex flex-col gap-8" id="app_main">
        
        {/* Pitch Guide / Help Note */}
        <section className="bg-gradient-to-r from-slate-900 via-slate-900/60 to-slate-950 border border-slate-800 rounded-3xl p-8 relative overflow-hidden shadow-2xl" id="intro_guide">
          <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />
          
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-8 z-10">
            <div className="space-y-4 max-w-3xl">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                <Music className="w-3.5 h-3.5" /> 4성 합창 전용 OMR & 플레이어
              </span>
              <h2 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight leading-tight">
                악보 PDF를 업로드하여 파트별로 피아노 연주 버전을 연주하고 고유 소장하세요
              </h2>
              <p className="text-sm text-slate-405 text-slate-400 leading-relaxed max-w-2xl">
                4성 합창 파트(소프라노, 알토, 테너, 베이스)로 분합된 악보 PDF를 올리세요. 
                AI 분석기가 각 성부별 음정을 개별 추출하여 가상 피아노 신스 연주를 합성해 드립니다. 
                언제든 파트별 단독 음원 또는 전체 앙상블 믹스 음원으로 즉시 기가급 고성능 렌더링 다운로드할 수 있습니다.
              </p>
            </div>

            {/* Quick Demo Selector */}
            <div className="flex flex-col gap-2 min-w-[260px] bg-slate-900/90 backdrop-blur-md p-5 rounded-3xl border border-slate-800 shadow-xl">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-405 text-indigo-400" /> 데모 혹은 가창 샘플 선택
              </label>
              
              <div className="flex flex-col gap-1.5 mt-2.5">
                {[...customScores, ...demoScores].map((score, idx) => (
                  <button
                    key={idx}
                    onClick={() => setCurrentScore(score)}
                    className={`text-left text-xs px-3.5 py-3 rounded-xl transition-all flex items-center justify-between group cursor-pointer ${
                      currentScore.title === score.title 
                        ? "bg-indigo-600/20 text-white font-semibold border-l-[3px] border-indigo-500 shadow-inner" 
                        : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                    }`}
                  >
                    <span className="truncate max-w-[170px]">{score.title}</span>
                    <span className="text-[10px] opacity-60 text-indigo-400 shrink-0 group-hover:opacity-100 transition-opacity">
                      {idx < customScores.length ? "커스텀" : "내장데모"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Upload & Dashboard Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8" id="actions_grid">
          
          {/* Left Block: File Uploader Area */}
          <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col justify-between gap-6 shadow-xl" id="uploader_block">
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">악보 파일 올리기</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                4부 보컬 파트가 분기 표기된 클래식 성가, 찬송가 혹은 고전 합창곡 다성 악보 1-3페이지 분량의 PDF 파일을 업로드하세요.
              </p>

              {/* Drag/Drop and Input Zone */}
              <div className="relative border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/30 flex flex-col items-center justify-center p-6 text-center cursor-pointer group transition-all duration-300 hover:border-slate-700 active:border-indigo-500 min-h-[192px]">
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={handleScoreFileUpload}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-20"
                  disabled={isUploading}
                />
                
                {isUploading ? (
                  <div className="space-y-3 z-10 p-2">
                    <Loader2 className="w-10 h-10 text-indigo-455 text-indigo-400 animate-spin mx-auto" />
                    <p className="text-sm font-semibold text-white">악보 스캔 & 분석 중...</p>
                    <p className="text-[10.5px] text-slate-400 animate-pulse truncate max-w-[200px]">{uploadProgressText}</p>
                  </div>
                ) : (
                  <div className="space-y-3 z-10 transition-transform group-hover:scale-[1.02] flex flex-col items-center">
                    <div className="w-16 h-16 bg-slate-800 rounded-2xl flex items-center justify-center mb-1 text-slate-400 group-hover:text-indigo-400 transition-colors">
                      <Upload className="w-7 h-7" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200">PDF 악보 분석기 작동</p>
                      <p className="text-xs text-slate-500 mt-1">파일 드래그 앤 드롭 지원 (.pdf)</p>
                    </div>
                    <button className="mt-2 px-5 py-2 bg-slate-850 hover:bg-slate-800 rounded-full text-xs font-medium border border-slate-700 text-slate-300 transition-colors">
                      Select PDF File
                    </button>
                  </div>
                )}
              </div>

              {/* Upload error display banner */}
              {uploadError && (
                <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl text-xs flex gap-2.5 items-start">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <p className="leading-relaxed whitespace-pre-wrap">{uploadError}</p>
                </div>
              )}
            </div>

            {/* Tech Guidelines footer */}
            <div className="bg-slate-950/60 border border-slate-800/60 p-4 rounded-2xl text-xs space-y-2 text-slate-400">
              <span className="font-bold text-slate-300 flex items-center gap-1.5 uppercase tracking-wider text-[10px]">
                <HelpCircle className="w-3.5 h-3.5 text-indigo-400" /> 분석 권장 사양 & 연동 안내
              </span>
              <ul className="list-disc list-inside space-y-1.5 pl-1 text-[11px] opacity-85 leading-normal">
                <li>독보가 쉬운 깨끗한 고해상도 그래픽 PDF</li>
                <li>성부 4개가 마디마다 명확히 나눠진 4성부 다성 악보</li>
                <li><strong>Audiveris &amp; MuseScore 호환:</strong> OMR 인식 후 XML 포맷으로 변환되어, MuseScore에서 즉시 열고 편집할 수 있습니다.</li>
              </ul>
            </div>
          </div>

          {/* Right Block: Active Synthesizer Dashboard */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col gap-6 shadow-xl" id="playback_monitor_block">
            
            {/* Header Score Meta Detail Info */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/60 pb-5">
              <div className="space-y-1">
                <span className="text-[10px] tracking-widest font-bold font-mono text-indigo-400 uppercase">ACTIVE SCORE ACCENT</span>
                <h3 className="text-2xl font-extrabold text-white tracking-tight flex items-center gap-1.5 leading-snug">
                  {currentScore.title}
                </h3>
                <p className="text-xs text-slate-400">작곡/배치: {currentScore.composer} &bull; 조: {currentScore.keySignature} &bull; 박자: {currentScore.timeSignature}</p>
              </div>

              {/* Master Accomp Mix & MusicXML Download Group */}
              <div className="flex flex-col sm:flex-row gap-2.5 self-start sm:self-center">
                <button
                  onClick={() => handleDownloadPart("all")}
                  disabled={!!renderingPart}
                  className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold px-4 py-2.5 rounded-full shadow-lg shadow-indigo-500/20 text-xs flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                >
                  {renderingPart === "all" ? (
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>전체 파트 병합 음원 다운로드</span>
                </button>

                <button
                  onClick={handleDownloadMusicXML}
                  className="bg-slate-850 hover:bg-slate-800 active:bg-slate-900 text-slate-200 border border-slate-700 hover:border-indigo-500/50 font-semibold px-4 py-2.5 rounded-full text-xs flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                  title="Audiveris OMR parsing exported as MusicXML standard, ready to edit with MuseScore"
                >
                  <Music className="w-4 h-4 text-indigo-400" />
                  <span>MusicXML 내보내기 (MuseScore용)</span>
                </button>
              </div>
            </div>

            {/* Play controller bar */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 items-center bg-slate-950 p-5 rounded-2xl border border-slate-800/60">
              
              {/* Play Btn */}
              <div className="md:col-span-4 flex items-center gap-2">
                <button
                  onClick={playScore}
                  className={`w-full py-3 px-5 rounded-full font-bold text-xs flex items-center justify-center gap-2.5 transition-all cursor-pointer ${
                    isPlaying 
                      ? "bg-amber-500 hover:bg-amber-400 text-white shadow-lg shadow-amber-500/10"
                      : "bg-white hover:bg-slate-100 ring-4 ring-white/1 ring-white/10 shadow-lg shadow-white/5 text-slate-950"
                  }`}
                >
                  {isPlaying ? (
                    <>
                      <Square className="w-3.5 h-3.5 fill-current" />
                      <span>일시정지 / 정지</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>피아노 연주 시작</span>
                    </>
                  )}
                </button>
              </div>

              {/* Tempo sliders control */}
              <div className="md:col-span-8 flex items-center gap-4">
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">연주 재생 속도 (Tempo/BPM)</span>
                    <span className="font-mono text-indigo-400 font-bold">{tempo} BPM</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="185"
                    step="1"
                    value={tempo}
                    onChange={(e) => setTempo(parseInt(e.target.value))}
                    className="w-full accent-indigo-500 bg-slate-800 rounded-lg cursor-pointer h-1.5"
                  />
                </div>
              </div>
            </div>

            {/* Play Tracker timeline graph */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>합창단 가이드 재생 경과</span>
                <span className="font-mono text-slate-300 font-semibold bg-slate-800/80 px-2 py-0.5 rounded border border-slate-700/40">
                  {formatBeatTime(elapsedBeats)} / {Math.ceil(totalBeats / 4)}마디 완성
                </span>
              </div>
              
              {/* Progress track slider */}
              <div className="relative w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-600 to-purple-500 transition-all duration-75 relative rounded-full"
                  style={{ width: `${totalBeats > 0 ? (elapsedBeats / totalBeats) * 100 : 0}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full border border-indigo-500 shadow" />
                </div>
              </div>
            </div>

            {/* Real-time Piano roll note visual block */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500/80 uppercase tracking-widest flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-indigo-400" /> 실시간 파트별 건반 싱크
              </h4>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {(["soprano", "alto", "tenor", "bass"] as VoicePart[]).map((p) => {
                  const isActive = activeNotes[p] !== "-" && activeNotes[p] !== "쉼표 (Rest)" && isPlaying;
                  const partBg = 
                    p === "soprano" ? "bg-pink-500/10" :
                    p === "alto" ? "bg-purple-500/10" :
                    p === "tenor" ? "bg-blue-500/10" : "bg-emerald-500/10";
                  
                  const partText = 
                    p === "soprano" ? "text-pink-400" :
                    p === "alto" ? "text-purple-400" :
                    p === "tenor" ? "text-blue-400" : "text-emerald-400";

                  const indicatorLetter = p[0].toUpperCase();

                  return (
                    <div 
                      key={p} 
                      className={`p-4 rounded-2xl border flex flex-col justify-between items-center text-center transition-all ${
                        isActive
                          ? `bg-slate-900 border-indigo-500/40 shadow-lg shadow-indigo-500/5` 
                          : "bg-slate-950/40 border-slate-800/80 hover:border-slate-700/80"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <div className={`w-5 h-5 rounded-full flex items-center justify-center font-bold text-[10px] ${partBg} ${partText}`}>
                          {indicatorLetter}
                        </div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">{p}</span>
                      </div>
                      
                      <motion.div 
                        className={`text-xl font-mono font-bold my-1.5 ${
                          isActive
                            ? `${partText} drop-shadow-[0_0_8px_rgba(139,92,246,0.3)]` 
                            : "text-slate-500"
                        }`}
                        animate={isActive ? { scale: [1, 1.12, 1] } : {}}
                        transition={{ duration: 0.15 }}
                      >
                        {isPlaying ? activeNotes[p] : "-"}
                      </motion.div>
                      
                      <span className={`text-[9px] px-2 py-0.5 rounded-full font-medium ${
                        isActive
                          ? `${partBg} ${partText}` 
                          : "bg-slate-900/60 text-slate-600"
                      }`}>
                        {isActive ? "ACTIVE" : "REST"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>

        {/* Dynamic Part Mixer Slider Rows (★MAIN REQUIREMENT: 파트별 피아노 음원 생성 & 다운로드★) */}
        <section className="bg-slate-900/40 rounded-3xl border border-slate-800/80 p-6 flex flex-col gap-6" id="part_mixer_section">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800/60 pb-5">
            <div>
              <h3 className="text-[15px] font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-400" /> 실시간 파트 믹서 및 고유 음원 개별 생성
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                각 보컬 성부의 피아노 볼륨 조절, 솔로 및 음소거 설정이 가능하며 파트별 단독 영롱 피아노 음원을 제작해 다운로드합니다.
              </p>
            </div>

            <div className="text-xs text-slate-400 text-left sm:text-right leading-relaxed bg-slate-950/80 border border-slate-800 p-3 rounded-2xl shrink-0">
              💡 <strong>솔로(Solo) 켜기:</strong> 해당 성부만 피아노 소리를 집중 리포트해 줍니다.
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(["soprano", "alto", "tenor", "bass"] as VoicePart[]).map((partKey) => {
              const ctrl = partControls[partKey];
              const pitchRange = 
                partKey === "soprano" ? "C4 - A5" :
                partKey === "alto" ? "G3 - C5" :
                partKey === "tenor" ? "C3 - G4" : "F2 - C4";
              
              const partLabelKo = 
                partKey === "soprano" ? "소프라노 (Soprano)" :
                partKey === "alto" ? "알토 (Alto)" :
                partKey === "tenor" ? "테너 (Tenor)" : "베이스 (Bass)";

              const colorAccent = 
                partKey === "soprano" ? "from-pink-500 to-rose-400" :
                partKey === "alto" ? "from-purple-500 to-indigo-400" :
                partKey === "tenor" ? "from-blue-500 to-sky-400" : "from-emerald-500 to-teal-400";

              return (
                <div 
                  key={partKey} 
                  className={`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between gap-5 transition-all ${
                    ctrl.isSolo 
                      ? "border-indigo-500 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500" 
                      : ctrl.isMuted 
                        ? "border-slate-950 opacity-50" 
                        : "border-slate-800 hover:border-slate-700"
                  }`}
                >
                  {/* Part Title and Pitch guide */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${colorAccent}`} />
                      <span className="text-[10px] font-mono font-semibold tracking-wider text-slate-500 uppercase">{partKey} RANGE</span>
                    </div>
                    <h4 className="text-base font-bold text-white tracking-tight">{partLabelKo}</h4>
                    <p className="text-[11px] text-slate-500">전형 주파수 대역 &bull; <span className="font-mono text-slate-400">{pitchRange}</span></p>
                  </div>

                  {/* Volume slider control */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-400 bg-slate-950 p-2.5 rounded-xl border border-slate-800/40">
                      <span className="flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-slate-400" /> 볼륨
                      </span>
                      <span className="font-mono text-white">{Math.round(ctrl.volume * 100)}%</span>
                    </div>
                    
                    <input
                      type="range"
                      min="0"
                      max="1.0"
                      step="0.01"
                      value={ctrl.volume}
                      disabled={ctrl.isMuted}
                      onChange={(e) => handleVolumeChange(partKey, parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 bg-slate-950 h-1.5 rounded-lg cursor-pointer"
                    />
                  </div>

                  {/* Solo & Mute toggle action row */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <button
                      onClick={() => toggleMute(partKey)}
                      className={`py-2 px-3 rounded-full border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        ctrl.isMuted 
                          ? "bg-rose-500/20 text-rose-400 border-rose-500/30" 
                          : "bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800"
                      }`}
                    >
                      <VolumeX className="w-3.5 h-3.5" />
                      <span>{ctrl.isMuted ? "소리켬" : "음소거"}</span>
                    </button>

                    <button
                      onClick={() => toggleSolo(partKey)}
                      className={`py-2 px-3 rounded-full border transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                        ctrl.isSolo 
                          ? "bg-indigo-600 text-white font-semibold border-indigo-500 shadow-md shadow-indigo-500/10" 
                          : "bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800"
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>{ctrl.isSolo ? "완전솔로" : "성부솔로"}</span>
                    </button>
                  </div>

                  {/* Individual WAV generator download (★TARGET COMPLETED★) */}
                  <button
                    onClick={() => handleDownloadPart(partKey)}
                    disabled={!!renderingPart}
                    className="w-full py-2.5 px-4 bg-slate-950 hover:bg-indigo-500/10 hover:text-indigo-400 hover:border-indigo-500/30 active:bg-slate-950 disabled:bg-slate-900 disabled:text-slate-600 border border-slate-800/80 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap"
                  >
                    {renderingPart === partKey ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-400" />
                    ) : (
                      <FileAudio className="w-3.5 h-3.5 text-indigo-400" />
                    )}
                    <span>{partKey.toUpperCase()} 피아노 음원 다운로드</span>
                  </button>

                </div>
              );
            })}
          </div>
        </section>

        {/* Structured Choral Score Music Viewer Tabs */}
        <section className="bg-slate-900/40 rounded-3xl border border-slate-800/80 p-6 flex flex-col gap-4" id="score_details_part">
          <div className="flex items-center gap-2 border-b border-slate-800/60 pb-3">
            <Eye className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">동기 분석된 4부 음표 정보</h3>
          </div>

          <p className="text-xs text-slate-400">
            AI 채보기가 악보 한 소절씩 발췌해 분석한 다성 음표 현황입니다. 건반 Pitch 이름형과 지속시간(Beats)을 대조 및 수동 보정해 연습할 수 있습니다.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-2">
            {(["soprano", "alto", "tenor", "bass"] as VoicePart[]).map((p) => {
              const notes = currentScore.parts[p];
              return (
                <div key={p} className="bg-slate-950/80 border border-slate-800/65 rounded-2xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs border-b border-slate-900/60 pb-2">
                    <span className="font-bold text-slate-400 uppercase font-mono tracking-wider">{p} TRACK</span>
                    <span className="text-slate-500 text-[10px]">{notes.length}개 음표</span>
                  </div>

                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                    {notes.map((n, idx) => (
                      <div key={idx} className="flex justify-between text-[11px] py-1.5 px-2.5 rounded-lg hover:bg-slate-900 transition-colors">
                        <span className="font-mono text-slate-300 font-semibold">{n.note === "R" || n.note === "r" ? "쉼표" : n.note}</span>
                        <span className="text-slate-500 text-[10px]">{n.duration} 박자</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </main>

      {/* Humble literal styled bottom info footer */}
      <footer className="border-t border-slate-900 bg-slate-950 mt-12 py-6 px-6 text-center text-xs text-slate-500" id="app_footer_bottom">
        <p>&copy; {new Date().getFullYear()} 합창 파트별 피아노 음원 생성기 &bull; Powered by Google Gemini 3.5 &amp; Web Audio API Offline Render Technology.</p>
      </footer>
    </div>
  );
}
