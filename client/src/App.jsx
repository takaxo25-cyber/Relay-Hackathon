import { useRef, useState, useEffect } from "react";
import "./App.css";
import {
  Mic,
  Square,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  User,
  FileText,
  Activity,
  ShieldCheck,
  ChevronDown,
  Radio,
  History,
  X,
  ArrowUpRight,
  Copy,
  Check,
  Timer,
} from "lucide-react";

const API_BASE = "http://localhost:5001";
const WS_URL = "ws://localhost:5001/ws/transcribe";

function App() {
  // =====================================
  // STATE (unchanged)
  // =====================================
  const [status, setStatus] = useState("Idle");
  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [micSettings, setMicSettings] = useState(null);
  const [patientId, setPatientId] = useState("");
  const [handoffResult, setHandoffResult] = useState(null);
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [handoffError, setHandoffError] = useState("");

  // Additive UI-only state
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sessionStartAt, setSessionStartAt] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [isSleeping, setIsSleeping] = useState(false);

  // =====================================
  // REFS (unchanged)
  // =====================================
  const socketRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const currentAudioRef = useRef(null);
  const patientIdRef = useRef("");
  const finalTextRef = useRef("");
  const utteranceBufferRef = useRef("");
  const interimTextRef = useRef("");
  const handoffResultRef = useRef(null);
  const awaitingConfirmationRef = useRef(false);
  const isRelaySpeakingRef = useRef(false);
  const analysisBusyRef = useRef(false);
  const confirmationBusyRef = useRef(false);
  const micRunningRef = useRef(false);
  const handoffCompleteRef = useRef(false);
  const silenceTimerRef = useRef(null);
  const ignoreSpeechUntilRef = useRef(0);

  // Amplitude meter (additive — powers the mic-reactive waveform only)
  const analyserRef = useRef(null);
  const audioContextRef = useRef(null);
  const rafRef = useRef(null);
  const stageRef = useRef(null);

  const SILENCE_MS = 2500;

  // =====================================
  // AMPLITUDE METER (additive)
  // Writes RMS level to a CSS variable on the mic stage.
  // Never triggers React re-renders (DOM-only).
  // =====================================
  function startAmplitudeMeter(stream) {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      const audioContext = new AudioCtx();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      analyserRef.current = analyser;

      const data = new Uint8Array(analyser.frequencyBinCount);
      let smoothed = 0;
      let trail = 0;

      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(data);

        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);

        // Attack fast, release slow → feels responsive but not jittery
        const target = Math.min(1, rms * 3.4);
        smoothed = target > smoothed
          ? smoothed + (target - smoothed) * 0.5
          : smoothed + (target - smoothed) * 0.12;

        // Ghost-trail level (slow-follow — cinematic voice-print lag)
        trail = trail + (smoothed - trail) * 0.05;

        if (stageRef.current) {
          stageRef.current.style.setProperty("--relay-level", smoothed.toFixed(3));
          stageRef.current.style.setProperty("--relay-trail", trail.toFixed(3));
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.warn("Amplitude meter unavailable:", err);
    }
  }

  function stopAmplitudeMeter() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (analyserRef.current) {
      try { analyserRef.current.disconnect(); } catch (e) {}
      analyserRef.current = null;
    }
    if (audioContextRef.current) {
      try { audioContextRef.current.close(); } catch (e) {}
      audioContextRef.current = null;
    }
    if (stageRef.current) {
      stageRef.current.style.setProperty("--relay-level", "0");
      stageRef.current.style.setProperty("--relay-trail", "0");
    }
  }

  // ---- ORIGINAL LOGIC (unchanged) ----
  function updatePatientId(value) {
    setPatientId(value);
    patientIdRef.current = value;
  }

  function clearSilenceTimer() {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    silenceTimerRef.current = setTimeout(() => {
      finishCurrentSpeech();
    }, SILENCE_MS);
  }

  function speakWithBrowser(text) {
    return new Promise((resolve) => {
      if (!text || !("speechSynthesis" in window)) { resolve(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  }

  function playAudio(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(false); return; }
      let fullUrl = url;
      if (!url.startsWith("http")) fullUrl = `${API_BASE}${url}`;
      try {
        if (currentAudioRef.current) {
          currentAudioRef.current.pause();
          currentAudioRef.current = null;
        }
        const audio = new Audio(fullUrl);
        currentAudioRef.current = audio;
        audio.onended = () => { currentAudioRef.current = null; resolve(true); };
        audio.onerror = () => { currentAudioRef.current = null; resolve(false); };
        audio.play().catch(() => { currentAudioRef.current = null; resolve(false); });
      } catch (error) {
        console.error("Audio playback error:", error);
        resolve(false);
      }
    });
  }

  async function speakRelay(audioUrl, fallbackText) {
    clearSilenceTimer();
    isRelaySpeakingRef.current = true;
    utteranceBufferRef.current = "";
    interimTextRef.current = "";
    setLiveText("");
    setStatus("RELAY speaking 🔊");
    try {
      let audioPlayed = false;
      if (audioUrl) audioPlayed = await playAudio(audioUrl);
      if (!audioPlayed && fallbackText) await speakWithBrowser(fallbackText);
    } finally {
      isRelaySpeakingRef.current = false;
      ignoreSpeechUntilRef.current = Date.now() + 700;
    }
  }

  function prepareForNewSpeech() {
    clearSilenceTimer();
    finalTextRef.current = "";
    utteranceBufferRef.current = "";
    interimTextRef.current = "";
    handoffResultRef.current = null;
    awaitingConfirmationRef.current = false;
    handoffCompleteRef.current = false;
    setFinalText("");
    setLiveText("");
    setHandoffResult(null);
    setConfirmationResult(null);
    setHandoffError("");
  }

  async function handleVoiceConfirmation(spokenText) {
    if (confirmationBusyRef.current || isRelaySpeakingRef.current) return;
    const cleaned = spokenText.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
    console.log("🎙️ Confirmation heard:", cleaned);
    const noDetected =
      /\b(no|nope|resolved|inactive|discontinue|remove|finished)\b/.test(cleaned) ||
      cleaned.includes("not active") || cleaned.includes("not anymore") || cleaned.includes("no longer");
    const yesDetected =
      /\b(yes|yeah|yep|correct|active|continue)\b/.test(cleaned) ||
      cleaned.includes("still active") || cleaned.includes("carry it forward") || cleaned.includes("keep it");
    if (noDetected) { await handleConfirmation("no"); return; }
    if (yesDetected) { await handleConfirmation("yes"); return; }
    await speakRelay(null, "I did not catch that. Please say yes if it is still active, or no if it is resolved.");
    setStatus("Waiting for YES / NO 🎙️");
  }

  async function handleContinue(transcriptOverride) {
    if (analysisBusyRef.current || isRelaySpeakingRef.current) return;
    const currentPatient = patientIdRef.current.trim();
    const transcript = (transcriptOverride || finalTextRef.current).trim();
    if (!currentPatient) { setStatus("Enter a Patient ID first"); return; }
    if (!transcript) { setStatus("Listening 🎙️"); return; }
    try {
      analysisBusyRef.current = true;
      handoffCompleteRef.current = false;
      setLoading(true);
      setHandoffError("");
      setStatus("Analyzing handoff...");
      setConfirmationResult(null);
      const response = await fetch(`${API_BASE}/api/handoff/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: currentPatient, transcript }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || "Handoff failed");
      console.log("🔥 RELAY RESULT:", data);
      handoffResultRef.current = data;
      setHandoffResult(data);
      if (data.requires_confirmation && Array.isArray(data.missing_items) && data.missing_items.length > 0) {
        awaitingConfirmationRef.current = true;
        handoffCompleteRef.current = false;
        await speakRelay(data.audio_url, data.confirmation_text);
        setStatus("Waiting for YES / NO 🎙️");
        return;
      }
      awaitingConfirmationRef.current = false;
      handoffCompleteRef.current = true;
      await speakRelay(null, "Handoff complete.");
      setStatus("Handoff complete ✅ — listening");
    } catch (error) {
      console.error("Handoff error:", error);
      setHandoffError(error.message);
      setStatus("Handoff error");
    } finally {
      analysisBusyRef.current = false;
      setLoading(false);
    }
  }

  async function handleConfirmation(answer) {
    if (confirmationBusyRef.current) return;
    const currentHandoff = handoffResultRef.current;
    if (!currentHandoff || !Array.isArray(currentHandoff.missing_items) || currentHandoff.missing_items.length === 0) return;
    const memory = currentHandoff.missing_items[0];
    try {
      confirmationBusyRef.current = true;
      setConfirmLoading(true);
      setStatus("Updating handoff...");
      const response = await fetch(`${API_BASE}/api/handoff/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: currentHandoff.patient_id,
          memory_id: memory.id,
          answer,
          transcript: currentHandoff.transcript || finalTextRef.current,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.details || data.error || "Confirmation failed");
      console.log("🔥 CONFIRMATION:", data);
      setConfirmationResult(data);
      awaitingConfirmationRef.current = false;
      handoffCompleteRef.current = true;
      const finalMessage = data.final_message ||
        (answer === "yes"
          ? "Confirmed. The active item has been carried forward."
          : "Confirmed. The resolved item has been removed.");
      await speakRelay(data.audio_url, finalMessage);
      setStatus("Handoff complete ✅ — listening");
    } catch (error) {
      console.error(error);
      setHandoffError(error.message);
      awaitingConfirmationRef.current = true;
      setStatus("Confirmation failed");
    } finally {
      confirmationBusyRef.current = false;
      setConfirmLoading(false);
    }
  }

  async function finishCurrentSpeech() {
    clearSilenceTimer();
    if (isRelaySpeakingRef.current || analysisBusyRef.current || confirmationBusyRef.current) return;
    const finalizedPart = utteranceBufferRef.current.trim();
    const interimPart = interimTextRef.current.trim();
    let spoken = finalizedPart;
    if (interimPart && !spoken.endsWith(interimPart)) spoken = `${spoken} ${interimPart}`.trim();
    if (!spoken) {
      setStatus(awaitingConfirmationRef.current ? "Waiting for YES / NO 🎙️" : "Listening 🎙️");
      return;
    }
    console.log("⏱️ RELAY detected silence:", spoken);
    setStatus("✅ Silence detected — starting analysis...");
    if (awaitingConfirmationRef.current) {
      utteranceBufferRef.current = "";
      interimTextRef.current = "";
      setLiveText("");
      await handleVoiceConfirmation(spoken);
      return;
    }
    if (interimPart && !finalTextRef.current.trim().endsWith(interimPart)) {
      finalTextRef.current = `${finalTextRef.current} ${interimPart}`.trim();
      setFinalText(finalTextRef.current);
    }
    const transcript = finalTextRef.current.trim() || spoken;
    utteranceBufferRef.current = "";
    interimTextRef.current = "";
    setLiveText("");
    await handleContinue(transcript);
  }

  async function startMic() {
    if (micRunningRef.current) return;
    try {
      setStatus("Requesting microphone...");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      streamRef.current = stream;

      // ADDITIVE: start voice-amplitude meter (mic-reactive waveform).
      startAmplitudeMeter(stream);

      const track = stream.getAudioTracks()[0];
      setMicSettings(track.getSettings());
      const socket = new WebSocket(WS_URL);
      socketRef.current = socket;

      socket.onmessage = async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          micRunningRef.current = true;
          setStatus("Listening 🎙️");
          let mimeType = "";
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mimeType = "audio/webm;codecs=opus";
          else if (MediaRecorder.isTypeSupported("audio/webm")) mimeType = "audio/webm";
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          recorderRef.current = recorder;
          recorder.ondataavailable = async (audioEvent) => {
            if (isRelaySpeakingRef.current) return;
            if (audioEvent.data.size > 0 && socket.readyState === WebSocket.OPEN) {
              const buffer = await audioEvent.data.arrayBuffer();
              socket.send(buffer);
            }
          };
          recorder.start(250);
        }
        if (message.type === "speech_started") {
          if (isRelaySpeakingRef.current || analysisBusyRef.current || confirmationBusyRef.current) return;
          if (Date.now() < ignoreSpeechUntilRef.current) return;
          if (handoffCompleteRef.current && !awaitingConfirmationRef.current) return;
          setStatus(awaitingConfirmationRef.current ? "Listening for YES / NO 🎙️" : "Speech detected 🎙️");
        }
        if (message.type === "transcript") {
          if (isRelaySpeakingRef.current || analysisBusyRef.current || confirmationBusyRef.current) return;
          if (Date.now() < ignoreSpeechUntilRef.current) return;
          const text = (message.transcript || "").trim();
          if (!text) return;
          if (handoffCompleteRef.current && !awaitingConfirmationRef.current) prepareForNewSpeech();
          if (message.is_final) {
            utteranceBufferRef.current = `${utteranceBufferRef.current} ${text}`.trim();
            interimTextRef.current = "";
            if (!awaitingConfirmationRef.current) {
              const updated = `${finalTextRef.current} ${text}`.trim();
              finalTextRef.current = updated;
              setFinalText(updated);
            }
            setLiveText("");
          } else {
            interimTextRef.current = text;
            setLiveText(text);
          }
          armSilenceTimer();
        }
        if (message.type === "utterance_end") {
          if (!silenceTimerRef.current) armSilenceTimer();
        }
        if (message.type === "error") {
          console.error("Transcription error:", message);
          setStatus(`Error: ${message.message}`);
        }
      };

      socket.onerror = (error) => {
        console.error("WebSocket error:", error);
        setStatus("WebSocket error");
      };
      socket.onclose = () => {
        if (micRunningRef.current) setStatus("Microphone connection closed");
      };
    } catch (error) {
      console.error(error);
      micRunningRef.current = false;
      setStatus(`Mic error: ${error.message}`);
    }
  }

  function stopMic() {
    clearSilenceTimer();
    // ADDITIVE: stop the amplitude meter first (isolated from below).
    stopAmplitudeMeter();
    micRunningRef.current = false;
    isRelaySpeakingRef.current = false;
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    recorderRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (socketRef.current) socketRef.current.close();
    socketRef.current = null;
    if (currentAudioRef.current) { currentAudioRef.current.pause(); currentAudioRef.current = null; }
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setStatus("Stopped");
  }

  function clearTranscript() {
    prepareForNewSpeech();
    setStatus(micRunningRef.current ? "Listening 🎙️" : "Idle");
  }

  function startNewHandoff() {
    prepareForNewSpeech();
    updatePatientId("");
    setStatus(micRunningRef.current ? "Enter Patient ID" : "Idle");
  }

  const finalizedHandoff =
    confirmationResult?.final_handoff || handoffResult?.final_handoff || null;

  // =====================================
  // ADDITIVE UI EFFECTS — purely observational
  // =====================================

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem("relay-history");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setHistory(parsed);
      }
    } catch (e) {}
  }, []);

  // Watch for a newly finalized handoff and store it in history
  useEffect(() => {
    if (!finalizedHandoff) return;
    const pid = patientIdRef.current.trim();
    if (!pid) return;
    setHistory((prev) => {
      if (prev[0] && prev[0].final_handoff === finalizedHandoff && prev[0].patient_id === pid) return prev;
      const entry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        patient_id: pid,
        final_handoff: finalizedHandoff,
        transcript: (finalTextRef.current || "").trim(),
        timestamp: new Date().toISOString(),
      };
      const next = [entry, ...prev].slice(0, 25);
      try { localStorage.setItem("relay-history", JSON.stringify(next)); } catch (e) {}
      return next;
    });
  }, [finalizedHandoff]);

  // Space bar — hands-free start/stop
  useEffect(() => {
    function onKey(e) {
      if (e.code !== "Space") return;
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      e.preventDefault();
      if (micRunningRef.current) stopMic();
      else startMic();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearHistory() {
    setHistory([]);
    try { localStorage.removeItem("relay-history"); } catch (e) {}
  }

  function loadHistoryPatient(entry) {
    updatePatientId(entry.patient_id);
    setShowHistory(false);
  }

  function formatHistoryTime(iso) {
    try {
      const d = new Date(iso);
      const now = new Date();
      const sameDay = d.toDateString() === now.toDateString();
      if (sameDay) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " · " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
  }

  async function copyHandoff() {
    if (!finalizedHandoff) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(finalizedHandoff);
      } else {
        const ta = document.createElement("textarea");
        ta.value = finalizedHandoff;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  }

  // Session timer — starts when mic becomes active, stops when idle/stopped.
  useEffect(() => {
    const s = (status || "").toLowerCase();
    const isActive =
      s.includes("listening") || s.includes("speech detected") ||
      s.includes("relay speaking") || s.includes("analyz") ||
      s.includes("waiting for yes") || s.includes("silence detected") ||
      s.includes("updating") || s.includes("complete");
    const isTerminal = s === "idle" || s === "stopped" || s.includes("mic error") || s.includes("connection closed");
    if (isActive && !sessionStartAt) setSessionStartAt(Date.now());
    if (isTerminal && sessionStartAt) { setSessionStartAt(null); setElapsedSec(0); }
  }, [status, sessionStartAt]);

  useEffect(() => {
    if (!sessionStartAt) return;
    setElapsedSec(Math.floor((Date.now() - sessionStartAt) / 1000));
    const iv = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - sessionStartAt) / 1000));
    }, 1000);
    return () => clearInterval(iv);
  }, [sessionStartAt]);

  const elapsedLabel = (() => {
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const ss = String(elapsedSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  })();

  // Idle Auto-Sleep — dims the mic orb after 60s of true silence.
  useEffect(() => {
    setIsSleeping(false);
    const s = (status || "").toLowerCase();
    const isPureListening =
      s === "listening 🎙️" || s === "listening for yes / no 🎙️" || s === "waiting for yes / no 🎙️";
    if (!isPureListening) return;
    const t = setTimeout(() => setIsSleeping(true), 60000);
    return () => clearTimeout(t);
  }, [status]);

  // While sleeping, any user interaction wakes it up.
  useEffect(() => {
    if (!isSleeping) return;
    const wake = () => setIsSleeping(false);
    window.addEventListener("mousemove", wake, { once: true, passive: true });
    window.addEventListener("keydown", wake, { once: true });
    window.addEventListener("click", wake, { once: true });
    window.addEventListener("touchstart", wake, { once: true, passive: true });
    return () => {
      window.removeEventListener("mousemove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("click", wake);
      window.removeEventListener("touchstart", wake);
    };
  }, [isSleeping]);

  // =====================================
  // UI-ONLY DERIVED VISUAL STATE
  // =====================================
  const micState = (() => {
    if (loading || confirmLoading) return "analyzing";
    const s = (status || "").toLowerCase();
    if (s.includes("relay speaking")) return "speaking";
    if (s.startsWith("error") || s.includes("mic error") || s.includes("websocket error") ||
        s.includes("handoff error") || s.includes("confirmation failed") || s.includes("connection closed")) return "error";
    if (s.includes("waiting for yes") || s.includes("listening for yes")) return "confirming";
    if (s.includes("speech detected")) return "speech";
    if (s.includes("silence detected") || s.includes("analyz") || s.includes("updating")) return "analyzing";
    if (s.includes("complete")) return "complete";
    if (s.includes("listening")) return "listening";
    if (s.includes("requesting")) return "connecting";
    return "idle";
  })();

  const stateLabelMap = {
    idle: "Ready", connecting: "Connecting", listening: "Listening",
    speech: "Capturing", analyzing: "Analyzing", speaking: "Responding",
    confirming: "Awaiting Yes / No", complete: "Complete", error: "Attention",
  };

  const heroSubline = {
    idle: "Enter a Patient ID and press Start RELAY. Speak naturally — the analysis begins automatically when you pause.",
    connecting: "Requesting microphone access…",
    listening: "Microphone is live. Speak the handoff at a natural pace.",
    speech: "Speech captured. Keep going — RELAY will process once you pause.",
    analyzing: "RELAY is reviewing memory, missing items, and clinical flags.",
    speaking: "RELAY is responding. Please wait for the tone to finish.",
    confirming: "Say YES if it is still active, or NO if it is resolved.",
    complete: "Handoff complete. Start speaking again to begin another.",
    error: "Something needs attention — check the status message below.",
  };

  return (
    <div className="relay-app" data-state={micState} data-sleeping={isSleeping ? "true" : "false"}>
      <div className="relay-scanline" aria-hidden="true" />

      {isSleeping && (
        <button
          type="button"
          className="relay-standby"
          onClick={() => setIsSleeping(false)}
          data-testid="standby-wake-btn"
          aria-label="Tap to wake display"
        >
          <span className="relay-standby-dot" aria-hidden="true" />
          <span>Standby · tap to wake</span>
        </button>
      )}

      <div className="relay-shell">
        {/* HEADER */}
        <header className="relay-header">
          <div className="relay-brand">
            <div className="relay-brand-mark" aria-hidden="true">
              <Radio size={18} strokeWidth={2} />
            </div>
            <div className="relay-brand-text">
              <h1 className="relay-brand-name">
                RELAY<span className="relay-brand-dot">.</span>
              </h1>
              <p className="relay-brand-sub">Intelligent Clinical Handoff Assistant</p>
            </div>
          </div>

          <div className="relay-status-badge" data-state={micState} data-testid="relay-status-badge">
            <span className="relay-status-dot" aria-hidden="true" />
            <span className="relay-status-badge-label">{stateLabelMap[micState] || "Ready"}</span>
            <span className="relay-status-badge-divider" aria-hidden="true" />
            <span className="relay-status-badge-text">{status}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowHistory(true)}
            className="relay-history-toggle"
            data-testid="history-toggle-btn"
            aria-label="Show session history"
          >
            <History size={14} strokeWidth={2} />
            <span>History</span>
            {history.length > 0 && (
              <span className="relay-history-count">{history.length}</span>
            )}
          </button>
        </header>

        {/* HERO — MIC CENTERPIECE */}
        <section className="relay-hero" data-testid="relay-hero">
          <div className="relay-mic-stage" data-state={micState} aria-live="polite" ref={stageRef}>
            <span className="relay-live-ring relay-live-ring-trail" aria-hidden="true" />
            <span className="relay-live-ring" aria-hidden="true" />
            <span className="relay-live-ring relay-live-ring-outer" aria-hidden="true" />

            <span className="relay-ring relay-ring-1" aria-hidden="true" />
            <span className="relay-ring relay-ring-2" aria-hidden="true" />
            <span className="relay-ring relay-ring-3" aria-hidden="true" />

            <div className="relay-bars" aria-hidden="true">
              {Array.from({ length: 28 }).map((_, i) => (
                <span
                  key={i}
                  className="relay-bar"
                  style={{
                    transform: `rotate(${(360 / 28) * i}deg) translateY(-138px)`,
                    animationDelay: `${(i % 14) * 0.07}s`,
                  }}
                />
              ))}
            </div>

            <div className="relay-eq" aria-hidden="true">
              {Array.from({ length: 7 }).map((_, i) => (
                <span key={i} className="relay-eq-bar" style={{ animationDelay: `${i * 0.11}s` }} />
              ))}
            </div>

            <div className="relay-orb">
              <div className="relay-orb-inner">
                <Mic className="relay-orb-icon" size={44} strokeWidth={1.6} aria-hidden="true" />
              </div>
            </div>
          </div>

          <div className="relay-hero-caption">
            <div className="relay-hero-state-line">
              <span className="relay-hero-state-tag">{stateLabelMap[micState] || "Ready"}</span>
              {sessionStartAt !== null && (
                <span className="relay-hero-timer" data-testid="session-timer" aria-label="Session elapsed time">
                  <Timer size={11} strokeWidth={2} />
                  <span className="relay-hero-timer-value">{elapsedLabel}</span>
                </span>
              )}
              <span className="relay-hero-status" data-testid="relay-hero-status">{status}</span>
            </div>
            <p className="relay-hero-hint">{heroSubline[micState] || heroSubline.idle}</p>
          </div>

          <div className="relay-hero-actions">
            <button type="button" onClick={startMic} className="relay-btn relay-btn-primary" data-testid="start-relay-btn">
              <Mic size={16} strokeWidth={2} />
              <span>Start RELAY</span>
              <kbd className="relay-btn-kbd" aria-hidden="true">Space</kbd>
            </button>
            <button type="button" onClick={stopMic} className="relay-btn relay-btn-ghost" data-testid="stop-relay-btn">
              <Square size={14} strokeWidth={2} />
              <span>Stop</span>
            </button>
            <button type="button" onClick={clearTranscript} className="relay-btn relay-btn-ghost" data-testid="clear-transcript-btn">
              <RotateCcw size={14} strokeWidth={2} />
              <span>Clear</span>
            </button>
          </div>

          {(loading || confirmLoading) && (
            <div className="relay-hero-loader" data-testid="relay-loader">
              <span className="relay-hero-loader-dot" />
              <span className="relay-hero-loader-dot" />
              <span className="relay-hero-loader-dot" />
              <span className="relay-hero-loader-label">
                {loading ? "RELAY is analyzing the handoff" : "Updating confirmation"}
              </span>
            </div>
          )}
        </section>

        {/* ERROR */}
        {handoffError && (
          <div className="relay-alert" role="alert" data-testid="relay-error">
            <div className="relay-alert-icon"><AlertTriangle size={16} strokeWidth={2} /></div>
            <div>
              <p className="relay-alert-title">Handoff error</p>
              <p className="relay-alert-body">{handoffError}</p>
            </div>
          </div>
        )}

        {/* PATIENT + TRANSCRIPT */}
        <div className="relay-grid">
          <section className="relay-card relay-card-patient" data-testid="patient-card">
            <div className="relay-card-head">
              <div className="relay-card-head-title">
                <User size={14} strokeWidth={2} />
                <h3>Patient</h3>
              </div>
              <span className="relay-card-pill">Required</span>
            </div>
            <label htmlFor="relay-patient-input" className="relay-card-label">Patient identifier</label>
            <input
              id="relay-patient-input"
              type="text"
              value={patientId}
              onChange={(event) => updatePatientId(event.target.value)}
              placeholder="e.g. MRN‑10428"
              className="relay-input"
              data-testid="patient-id-input"
            />
            <p className="relay-card-foot">Attach every session to a patient record before starting.</p>
          </section>

          <section className="relay-card relay-card-transcript" data-testid="transcript-card">
            <div className="relay-card-head">
              <div className="relay-card-head-title">
                <FileText size={14} strokeWidth={2} />
                <h3>Live Handoff Transcript</h3>
              </div>
              <span
                className="relay-card-pill relay-card-pill-live"
                data-active={micState === "listening" || micState === "speech"}
              >
                <span className="relay-card-pill-dot" />
                Live
              </span>
            </div>

            <textarea
              value={finalText}
              onChange={(event) => {
                const value = event.target.value;
                setFinalText(value);
                finalTextRef.current = value;
              }}
              placeholder="Speak the handoff — the transcript will populate here as you talk."
              rows={7}
              className="relay-textarea"
              data-testid="transcript-textarea"
            />

            {liveText && (
              <div className="relay-live" data-testid="live-speech">
                <span className="relay-live-tag">Live</span>
                <p className="relay-live-text">{liveText}</p>
              </div>
            )}
          </section>
        </div>

        {/* ANALYSIS */}
        {handoffResult && (
          <section className="relay-card relay-card-analysis" data-testid="analysis-card">
            <div className="relay-card-head">
              <div className="relay-card-head-title">
                <Activity size={14} strokeWidth={2} />
                <h3>RELAY Analysis</h3>
              </div>
              <span className="relay-card-meta">
                Patient · <strong>{handoffResult.patient_id}</strong>
              </span>
            </div>

            {handoffResult.memory_check && (
              <div className="relay-metrics">
                <div className="relay-metric">
                  <p className="relay-metric-label">Unresolved memories</p>
                  <p className="relay-metric-value">{handoffResult.memory_check.unresolved_found}</p>
                </div>
                <div className="relay-metric-sep" aria-hidden="true" />
                <div className="relay-metric">
                  <p className="relay-metric-label">Missing from handoff</p>
                  <p className="relay-metric-value">{handoffResult.memory_check.missing_from_handoff}</p>
                </div>
              </div>
            )}

            {handoffResult.requires_confirmation && !confirmationResult && (
              <div className="relay-confirm" data-testid="confirmation-prompt">
                <div className="relay-confirm-head">
                  <AlertTriangle size={14} strokeWidth={2} />
                  <p className="relay-confirm-title">Voice confirmation needed</p>
                </div>
                <p className="relay-confirm-body">{handoffResult.confirmation_text}</p>
                <p className="relay-confirm-hint">Just say <strong>YES</strong> or <strong>NO</strong>.</p>
              </div>
            )}

            {confirmationResult && (
              <div className="relay-confirm relay-confirm-done" data-testid="confirmation-result">
                <div className="relay-confirm-head">
                  <ShieldCheck size={14} strokeWidth={2} />
                  <p className="relay-confirm-title">RELAY response</p>
                </div>
                <p className="relay-confirm-body">{confirmationResult.final_message}</p>
              </div>
            )}
          </section>
        )}

        {/* FINALIZED HANDOFF */}
        {finalizedHandoff && (
          <section className="relay-card relay-card-final" data-testid="finalized-card">
            <div className="relay-card-head">
              <div className="relay-card-head-title">
                <CheckCircle2 size={14} strokeWidth={2} />
                <h3>Finalized Handoff</h3>
              </div>
              <div className="relay-card-head-actions">
                <button
                  type="button"
                  onClick={copyHandoff}
                  className={`relay-copy-btn${copied ? " is-copied" : ""}`}
                  data-testid="copy-handoff-btn"
                  aria-label="Copy finalized handoff to clipboard"
                >
                  {copied ? (
                    <><Check size={12} strokeWidth={2.5} /><span>Copied</span></>
                  ) : (
                    <><Copy size={12} strokeWidth={2} /><span>Copy</span></>
                  )}
                </button>
                <span className="relay-card-pill relay-card-pill-success">Signed off</span>
              </div>
            </div>

            <p className="relay-final-body">{finalizedHandoff}</p>

            <div className="relay-final-foot">
              <p className="relay-final-note">
                RELAY is still listening. Start speaking again to begin another handoff.
              </p>
              <button
                type="button"
                onClick={startNewHandoff}
                className="relay-btn relay-btn-outline"
                data-testid="change-patient-btn"
              >
                Change patient
              </button>
            </div>
          </section>
        )}

        {/* DEBUG */}
        <details className="relay-debug" data-testid="debug-section">
          <summary className="relay-debug-summary">
            <ChevronDown size={14} strokeWidth={2} />
            <span>Microphone diagnostics</span>
          </summary>
          <pre className="relay-debug-pre">
            {micSettings ? JSON.stringify(micSettings, null, 2) : "Start the microphone to view device settings."}
          </pre>
        </details>

        <footer className="relay-footer">
          <span>RELAY · clinical handoff assistant</span>
          <span className="relay-footer-sep">·</span>
          <span>Voice pipeline connected to {API_BASE}</span>
          <span className="relay-footer-sep">·</span>
          <span>Press <kbd className="relay-footer-kbd">Space</kbd> to start / stop</span>
        </footer>
      </div>

      {/* SESSION HISTORY DRAWER */}
      {showHistory && (
        <div
          className="relay-drawer-backdrop"
          onClick={() => setShowHistory(false)}
          data-testid="history-backdrop"
        />
      )}
      <aside
        className={`relay-drawer${showHistory ? " is-open" : ""}`}
        aria-hidden={!showHistory}
        data-testid="history-drawer"
      >
        <div className="relay-drawer-head">
          <div className="relay-drawer-head-title">
            <History size={14} strokeWidth={2} />
            <h3>Session History</h3>
            <span className="relay-drawer-count">{history.length}</span>
          </div>
          <button
            type="button"
            onClick={() => setShowHistory(false)}
            className="relay-drawer-close"
            aria-label="Close history"
            data-testid="history-close-btn"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="relay-drawer-body">
          {history.length === 0 ? (
            <div className="relay-drawer-empty">
              <div className="relay-drawer-empty-icon">
                <History size={22} strokeWidth={1.5} />
              </div>
              <p className="relay-drawer-empty-title">No handoffs yet</p>
              <p className="relay-drawer-empty-sub">
                Finalized handoffs from this device will appear here for quick review.
              </p>
            </div>
          ) : (
            <ul className="relay-drawer-list">
              {history.map((entry) => (
                <li key={entry.id} className="relay-drawer-item" data-testid="history-item">
                  <div className="relay-drawer-item-head">
                    <div className="relay-drawer-item-patient">
                      <User size={12} strokeWidth={2} />
                      <span>{entry.patient_id}</span>
                    </div>
                    <span className="relay-drawer-item-time">
                      {formatHistoryTime(entry.timestamp)}
                    </span>
                  </div>
                  <p className="relay-drawer-item-body">{entry.final_handoff}</p>
                  <button
                    type="button"
                    onClick={() => loadHistoryPatient(entry)}
                    className="relay-drawer-item-action"
                    data-testid="history-load-btn"
                  >
                    <span>Load patient</span>
                    <ArrowUpRight size={12} strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {history.length > 0 && (
          <div className="relay-drawer-foot">
            <button
              type="button"
              onClick={clearHistory}
              className="relay-drawer-clear"
              data-testid="history-clear-btn"
            >
              Clear all
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

export default App;