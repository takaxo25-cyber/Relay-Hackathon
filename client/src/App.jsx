import { useRef, useState } from "react";

const API_BASE = "http://localhost:5001";
const WS_URL = "ws://localhost:5001/ws/transcribe";

function App() {
  const [status, setStatus] = useState("Idle");

  const [liveText, setLiveText] = useState("");
  const [finalText, setFinalText] = useState("");

  const [micSettings, setMicSettings] =
    useState(null);

  const [patientId, setPatientId] =
    useState("");

  const [handoffResult, setHandoffResult] =
    useState(null);

  const [
    confirmationResult,
    setConfirmationResult,
  ] = useState(null);

  const [loading, setLoading] =
    useState(false);

  const [
    confirmLoading,
    setConfirmLoading,
  ] = useState(false);

  const [
    handoffError,
    setHandoffError,
  ] = useState("");

  // =====================================
  // REFS
  // =====================================

  const socketRef = useRef(null);
  const recorderRef = useRef(null);
  const streamRef = useRef(null);

  const currentAudioRef =
    useRef(null);

  const patientIdRef =
    useRef("");

  const finalTextRef =
    useRef("");

  const utteranceBufferRef =
    useRef("");

  const interimTextRef =
    useRef("");

  const handoffResultRef =
    useRef(null);

  const awaitingConfirmationRef =
    useRef(false);

  const isRelaySpeakingRef =
    useRef(false);

  const analysisBusyRef =
    useRef(false);

  const confirmationBusyRef =
    useRef(false);

  const micRunningRef =
    useRef(false);

  const handoffCompleteRef =
    useRef(false);

  const silenceTimerRef =
    useRef(null);

  const ignoreSpeechUntilRef =
    useRef(0);

  const SILENCE_MS = 2500;

  // =====================================
  // PATIENT ID
  // =====================================

  function updatePatientId(value) {
    setPatientId(value);

    patientIdRef.current =
      value;
  }

  // =====================================
  // SILENCE TIMER
  // =====================================

  function clearSilenceTimer() {
    if (
      silenceTimerRef.current
    ) {
      clearTimeout(
        silenceTimerRef.current
      );

      silenceTimerRef.current =
        null;
    }
  }

  function armSilenceTimer() {
    clearSilenceTimer();

    silenceTimerRef.current =
      setTimeout(() => {
        finishCurrentSpeech();
      }, SILENCE_MS);
  }

  // =====================================
  // BROWSER SPEECH
  // =====================================

  function speakWithBrowser(text) {
    return new Promise(
      (resolve) => {
        if (
          !text ||
          !(
            "speechSynthesis" in
            window
          )
        ) {
          resolve();
          return;
        }

        window.speechSynthesis.cancel();

        const utterance =
          new SpeechSynthesisUtterance(
            text
          );

        utterance.rate = 1;
        utterance.pitch = 1;

        utterance.onend = () => {
          resolve();
        };

        utterance.onerror = () => {
          resolve();
        };

        window.speechSynthesis.speak(
          utterance
        );
      }
    );
  }

  // =====================================
  // AUDIO
  // =====================================

  function playAudio(url) {
    return new Promise(
      (resolve) => {
        if (!url) {
          resolve(false);
          return;
        }

        let fullUrl = url;

        if (
          !url.startsWith("http")
        ) {
          fullUrl =
            `${API_BASE}${url}`;
        }

        try {
          if (
            currentAudioRef.current
          ) {
            currentAudioRef.current.pause();

            currentAudioRef.current =
              null;
          }

          const audio =
            new Audio(fullUrl);

          currentAudioRef.current =
            audio;

          audio.onended = () => {
            currentAudioRef.current =
              null;

            resolve(true);
          };

          audio.onerror = () => {
            currentAudioRef.current =
              null;

            resolve(false);
          };

          audio
            .play()
            .catch(() => {
              currentAudioRef.current =
                null;

              resolve(false);
            });
        } catch (error) {
          console.error(
            "Audio playback error:",
            error
          );

          resolve(false);
        }
      }
    );
  }

  // =====================================
  // RELAY SPEAKING
  // =====================================

  async function speakRelay(
    audioUrl,
    fallbackText
  ) {
    clearSilenceTimer();

    isRelaySpeakingRef.current =
      true;

    utteranceBufferRef.current =
      "";

    interimTextRef.current =
      "";

    setLiveText("");

    setStatus(
      "RELAY speaking 🔊"
    );

    try {
      let audioPlayed = false;

      if (audioUrl) {
        audioPlayed =
          await playAudio(
            audioUrl
          );
      }

      if (
        !audioPlayed &&
        fallbackText
      ) {
        await speakWithBrowser(
          fallbackText
        );
      }
    } finally {
      isRelaySpeakingRef.current =
        false;

      // Ignore any delayed echo from
      // RELAY's own voice.
      ignoreSpeechUntilRef.current =
        Date.now() + 700;
    }
  }

  // =====================================
  // RESET HANDOFF
  // =====================================

  function prepareForNewSpeech() {
    clearSilenceTimer();

    finalTextRef.current =
      "";

    utteranceBufferRef.current =
      "";

    interimTextRef.current =
      "";

    handoffResultRef.current =
      null;

    awaitingConfirmationRef.current =
      false;

    handoffCompleteRef.current =
      false;

    setFinalText("");
    setLiveText("");

    setHandoffResult(null);

    setConfirmationResult(null);

    setHandoffError("");
  }

  // =====================================
  // VOICE YES / NO
  // =====================================

  async function handleVoiceConfirmation(
    spokenText
  ) {
    if (
      confirmationBusyRef.current ||
      isRelaySpeakingRef.current
    ) {
      return;
    }

    const cleaned =
      spokenText
        .toLowerCase()
        .replace(
          /[.,!?]/g,
          " "
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    console.log(
      "🎙️ Confirmation heard:",
      cleaned
    );

    const noDetected =
      /\b(no|nope|resolved|inactive|discontinue|remove|finished)\b/.test(
        cleaned
      ) ||
      cleaned.includes(
        "not active"
      ) ||
      cleaned.includes(
        "not anymore"
      ) ||
      cleaned.includes(
        "no longer"
      );

    const yesDetected =
      /\b(yes|yeah|yep|correct|active|continue)\b/.test(
        cleaned
      ) ||
      cleaned.includes(
        "still active"
      ) ||
      cleaned.includes(
        "carry it forward"
      ) ||
      cleaned.includes(
        "keep it"
      );

    if (noDetected) {
      await handleConfirmation(
        "no"
      );

      return;
    }

    if (yesDetected) {
      await handleConfirmation(
        "yes"
      );

      return;
    }

    await speakRelay(
      null,
      "I did not catch that. Please say yes if it is still active, or no if it is resolved."
    );

    setStatus(
      "Waiting for YES / NO 🎙️"
    );
  }

  // =====================================
  // ANALYZE HANDOFF
  // =====================================

  async function handleContinue(
    transcriptOverride
  ) {
    if (
      analysisBusyRef.current ||
      isRelaySpeakingRef.current
    ) {
      return;
    }

    const currentPatient =
      patientIdRef.current.trim();

    const transcript = (
      transcriptOverride ||
      finalTextRef.current
    ).trim();

    if (!currentPatient) {
      setStatus(
        "Enter a Patient ID first"
      );

      return;
    }

    if (!transcript) {
      setStatus(
        "Listening 🎙️"
      );

      return;
    }

    try {
      analysisBusyRef.current =
        true;

      handoffCompleteRef.current =
        false;

      setLoading(true);

      setHandoffError("");

      setStatus(
        "Analyzing handoff..."
      );

      setConfirmationResult(
        null
      );

      const response =
        await fetch(
          `${API_BASE}/api/handoff/analyze`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              {
                patient_id:
                  currentPatient,

                transcript,
              }
            ),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.details ||
            data.error ||
            "Handoff failed"
        );
      }

      console.log(
        "🔥 RELAY RESULT:",
        data
      );

      handoffResultRef.current =
        data;

      setHandoffResult(data);

      // =================================
      // CONFIRMATION REQUIRED
      // =================================

      if (
        data.requires_confirmation &&
        Array.isArray(
          data.missing_items
        ) &&
        data.missing_items.length >
          0
      ) {
        awaitingConfirmationRef.current =
          true;

        handoffCompleteRef.current =
          false;

        await speakRelay(
          data.audio_url,
          data.confirmation_text
        );

        setStatus(
          "Waiting for YES / NO 🎙️"
        );

        return;
      }

      // =================================
      // NORMAL COMPLETE HANDOFF
      // =================================

      awaitingConfirmationRef.current =
        false;

      handoffCompleteRef.current =
        true;

      /*
        IMPORTANT:
        We DON'T read the whole final
        handoff back aloud here.

        That was the "parroting"
        behaviour.
      */

      await speakRelay(
        null,
        "Handoff complete."
      );

      setStatus(
        "Handoff complete ✅ — listening"
      );
    } catch (error) {
      console.error(
        "Handoff error:",
        error
      );

      setHandoffError(
        error.message
      );

      setStatus(
        "Handoff error"
      );
    } finally {
      analysisBusyRef.current =
        false;

      setLoading(false);
    }
  }

  // =====================================
  // CONFIRMATION API
  // =====================================

  async function handleConfirmation(
    answer
  ) {
    if (
      confirmationBusyRef.current
    ) {
      return;
    }

    const currentHandoff =
      handoffResultRef.current;

    if (
      !currentHandoff ||
      !Array.isArray(
        currentHandoff.missing_items
      ) ||
      currentHandoff.missing_items
        .length === 0
    ) {
      return;
    }

    const memory =
      currentHandoff
        .missing_items[0];

    try {
      confirmationBusyRef.current =
        true;

      setConfirmLoading(true);

      setStatus(
        "Updating handoff..."
      );

      const response =
        await fetch(
          `${API_BASE}/api/handoff/confirm`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              {
                patient_id:
                  currentHandoff.patient_id,

                memory_id:
                  memory.id,

                answer,

                transcript:
                  currentHandoff.transcript ||
                  finalTextRef.current,
              }
            ),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data.details ||
            data.error ||
            "Confirmation failed"
        );
      }

      console.log(
        "🔥 CONFIRMATION:",
        data
      );

      setConfirmationResult(
        data
      );

      awaitingConfirmationRef.current =
        false;

      handoffCompleteRef.current =
        true;

      const finalMessage =
        data.final_message ||
        (answer === "yes"
          ? "Confirmed. The active item has been carried forward."
          : "Confirmed. The resolved item has been removed.");

      await speakRelay(
        data.audio_url,
        finalMessage
      );

      setStatus(
        "Handoff complete ✅ — listening"
      );
    } catch (error) {
      console.error(error);

      setHandoffError(
        error.message
      );

      awaitingConfirmationRef.current =
        true;

      setStatus(
        "Confirmation failed"
      );
    } finally {
      confirmationBusyRef.current =
        false;

      setConfirmLoading(false);
    }
  }

  // =====================================
  // USER FINISHED SPEAKING
  // =====================================

  async function finishCurrentSpeech() {
    clearSilenceTimer();

    if (
      isRelaySpeakingRef.current ||
      analysisBusyRef.current ||
      confirmationBusyRef.current
    ) {
      return;
    }

    const finalizedPart =
      utteranceBufferRef.current.trim();

    const interimPart =
      interimTextRef.current.trim();

    let spoken =
      finalizedPart;

    if (
      interimPart &&
      !spoken.endsWith(
        interimPart
      )
    ) {
      spoken =
        `${spoken} ${interimPart}`.trim();
    }

    if (!spoken) {
      setStatus(
        awaitingConfirmationRef.current
          ? "Waiting for YES / NO 🎙️"
          : "Listening 🎙️"
      );

      return;
    }

    console.log(
      "⏱️ RELAY detected silence:",
      spoken
    );

    setStatus(
      "✅ Silence detected — starting analysis..."
    );

    // =================================
    // YES / NO RESPONSE
    // =================================

    if (
      awaitingConfirmationRef.current
    ) {
      utteranceBufferRef.current =
        "";

      interimTextRef.current =
        "";

      setLiveText("");

      await handleVoiceConfirmation(
        spoken
      );

      return;
    }

    // =================================
    // NORMAL HANDOFF
    // =================================

    /*
      If the recognizer only gave us
      interim speech and never marked it
      final, include it anyway.
    */

    if (
      interimPart &&
      !finalTextRef.current
        .trim()
        .endsWith(interimPart)
    ) {
      finalTextRef.current =
        `${finalTextRef.current} ${interimPart}`.trim();

      setFinalText(
        finalTextRef.current
      );
    }

    const transcript =
      finalTextRef.current.trim() ||
      spoken;

    utteranceBufferRef.current =
      "";

    interimTextRef.current =
      "";

    setLiveText("");

    await handleContinue(
      transcript
    );
  }

  // =====================================
  // MICROPHONE
  // =====================================

  async function startMic() {
    if (
      micRunningRef.current
    ) {
      return;
    }

    try {
      setStatus(
        "Requesting microphone..."
      );

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              echoCancellation:
                true,

              noiseSuppression:
                true,

              autoGainControl:
                true,

              channelCount: 1,
            },
          }
        );

      streamRef.current =
        stream;

      const track =
        stream.getAudioTracks()[0];

      setMicSettings(
        track.getSettings()
      );

      const socket =
        new WebSocket(WS_URL);

      socketRef.current =
        socket;

      socket.onmessage =
        async (event) => {
          const message =
            JSON.parse(
              event.data
            );

          // =============================
          // READY
          // =============================

          if (
            message.type ===
            "ready"
          ) {
            micRunningRef.current =
              true;

            setStatus(
              "Listening 🎙️"
            );

            let mimeType = "";

            if (
              MediaRecorder.isTypeSupported(
                "audio/webm;codecs=opus"
              )
            ) {
              mimeType =
                "audio/webm;codecs=opus";
            } else if (
              MediaRecorder.isTypeSupported(
                "audio/webm"
              )
            ) {
              mimeType =
                "audio/webm";
            }

            const recorder =
              mimeType
                ? new MediaRecorder(
                    stream,
                    {
                      mimeType,
                    }
                  )
                : new MediaRecorder(
                    stream
                  );

            recorderRef.current =
              recorder;

            recorder.ondataavailable =
              async (
                audioEvent
              ) => {
                /*
                  Do not send microphone
                  audio while RELAY itself
                  is speaking.
                */

                if (
                  isRelaySpeakingRef.current
                ) {
                  return;
                }

                if (
                  audioEvent.data
                    .size > 0 &&
                  socket.readyState ===
                    WebSocket.OPEN
                ) {
                  const buffer =
                    await audioEvent.data.arrayBuffer();

                  socket.send(
                    buffer
                  );
                }
              };

            recorder.start(250);
          }

          // =============================
// SPEECH STARTED
// =============================

if (
  message.type ===
  "speech_started"
) {
  if (
    isRelaySpeakingRef.current ||
    analysisBusyRef.current ||
    confirmationBusyRef.current
  ) {
    return;
  }

  if (
    Date.now() <
    ignoreSpeechUntilRef.current
  ) {
    return;
  }

  // If a handoff just finished,
  // don't let random noise change
  // the status back to Speech detected.
  //
  // A real new handoff will start
  // when an actual transcript arrives.
  if (
    handoffCompleteRef.current &&
    !awaitingConfirmationRef.current
  ) {
    return;
  }

  setStatus(
    awaitingConfirmationRef.current
      ? "Listening for YES / NO 🎙️"
      : "Speech detected 🎙️"
  );
}

          // =============================
          // TRANSCRIPT
          // =============================

          if (
            message.type ===
            "transcript"
          ) {
            if (
              isRelaySpeakingRef.current ||
              analysisBusyRef.current ||
              confirmationBusyRef.current
            ) {
              return;
            }

            if (
              Date.now() <
              ignoreSpeechUntilRef.current
            ) {
              return;
            }

            const text = (
              message.transcript ||
              ""
            ).trim();

            if (!text) {
              return;
            }

            /*
              If the previous handoff is
              finished and the user starts
              speaking again, begin a new
              handoff automatically.
            */

            if (
              handoffCompleteRef.current &&
              !awaitingConfirmationRef.current
            ) {
              prepareForNewSpeech();
            }

            if (
              message.is_final
            ) {
              utteranceBufferRef.current =
                `${utteranceBufferRef.current} ${text}`.trim();

              interimTextRef.current =
                "";

              /*
                YES / NO answers are NOT
                added to the clinical
                handoff transcript.
              */

              if (
                !awaitingConfirmationRef.current
              ) {
                const updated =
                  `${finalTextRef.current} ${text}`.trim();

                finalTextRef.current =
                  updated;

                setFinalText(
                  updated
                );
              }

              setLiveText("");
            } else {
              interimTextRef.current =
                text;

              setLiveText(text);
            }

            /*
              THIS is the important part.

              Every transcript message
              starts/restarts our own
              silence timer.

              We do NOT depend on the
              backend's utterance_end.
            */

            armSilenceTimer();
          }

          // =============================
          // UTTERANCE END
          // =============================

          if (
            message.type ===
            "utterance_end"
          ) {
            /*
              Backend utterance_end is
              treated only as a hint.

              Our 2.5 second frontend
              timer is the main trigger.
            */

            if (
              !silenceTimerRef.current
            ) {
              armSilenceTimer();
            }
          }

          // =============================
          // ERROR
          // =============================

          if (
            message.type ===
            "error"
          ) {
            console.error(
              "Transcription error:",
              message
            );

            setStatus(
              `Error: ${message.message}`
            );
          }
        };

      socket.onerror =
        (error) => {
          console.error(
            "WebSocket error:",
            error
          );

          setStatus(
            "WebSocket error"
          );
        };

      socket.onclose =
        () => {
          if (
            micRunningRef.current
          ) {
            setStatus(
              "Microphone connection closed"
            );
          }
        };
    } catch (error) {
      console.error(error);

      micRunningRef.current =
        false;

      setStatus(
        `Mic error: ${error.message}`
      );
    }
  }

  // =====================================
  // STOP MICROPHONE
  // =====================================

  function stopMic() {
    clearSilenceTimer();

    micRunningRef.current =
      false;

    isRelaySpeakingRef.current =
      false;

    if (
      recorderRef.current &&
      recorderRef.current.state !==
        "inactive"
    ) {
      recorderRef.current.stop();
    }

    recorderRef.current =
      null;

    if (
      streamRef.current
    ) {
      streamRef.current
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );
    }

    streamRef.current =
      null;

    if (
      socketRef.current
    ) {
      socketRef.current.close();
    }

    socketRef.current =
      null;

    if (
      currentAudioRef.current
    ) {
      currentAudioRef.current.pause();

      currentAudioRef.current =
        null;
    }

    if (
      "speechSynthesis" in
      window
    ) {
      window.speechSynthesis.cancel();
    }

    setStatus("Stopped");
  }

  // =====================================
  // CLEAR
  // =====================================

  function clearTranscript() {
    prepareForNewSpeech();

    setStatus(
      micRunningRef.current
        ? "Listening 🎙️"
        : "Idle"
    );
  }

  // =====================================
  // CHANGE PATIENT
  // =====================================

  function startNewHandoff() {
    prepareForNewSpeech();

    updatePatientId("");

    setStatus(
      micRunningRef.current
        ? "Enter Patient ID"
        : "Idle"
    );
  }

  // =====================================
  // FINAL HANDOFF
  // =====================================

  const finalizedHandoff =
    confirmationResult?.final_handoff ||
    handoffResult?.final_handoff ||
    null;

  // =====================================
  // UI
  // =====================================

  return (
    <div
      style={{
        maxWidth: "800px",
        margin: "60px auto",
        fontFamily: "Arial",
      }}
    >
      <h1>RELAY</h1>

      <p>
        Intelligent clinical handoff
        assistant
      </p>

      <div
        style={{
          padding: "15px",
          border:
            "1px solid #444",
          marginBottom:
            "25px",
        }}
      >
        <strong>
          🎙️ Hands-free mode
        </strong>

        <p
          style={{
            marginBottom: 0,
          }}
        >
          Enter the patient ID,
          press Start RELAY once,
          then speak normally.
          RELAY will analyze
          automatically when you
          stop talking.
        </p>
      </div>

      {/* PATIENT */}

      <div
        style={{
          marginBottom:
            "20px",
        }}
      >
        <label>
          <strong>
            Patient ID
          </strong>
        </label>

        <br />

        <input
          type="text"
          value={patientId}
          onChange={(event) =>
            updatePatientId(
              event.target.value
            )
          }
          placeholder="Enter patient ID"
          style={{
            marginTop:
              "8px",
            padding:
              "10px",
            width:
              "250px",
            fontSize:
              "16px",
          }}
        />
      </div>

      {/* STATUS */}

      <div
        style={{
          padding: "15px",
          marginBottom:
            "20px",
          border:
            "1px solid #555",
        }}
      >
        <strong>
          Status:
        </strong>{" "}
        {status}

        {loading && (
          <p>
            🧠 RELAY is
            analyzing...
          </p>
        )}

        {confirmLoading && (
          <p>
            Updating
            confirmation...
          </p>
        )}
      </div>

      {/* CONTROLS */}

      <button
        onClick={startMic}
        style={{
          padding:
            "12px 20px",
          fontSize:
            "16px",
        }}
      >
        🎙️ Start RELAY
      </button>

      <button
        onClick={stopMic}
        style={{
          marginLeft:
            "10px",
          padding:
            "12px 20px",
          fontSize:
            "16px",
        }}
      >
        Stop
      </button>

      <button
        onClick={
          clearTranscript
        }
        style={{
          marginLeft:
            "10px",
          padding:
            "12px 20px",
          fontSize:
            "16px",
        }}
      >
        Clear
      </button>

      <hr
        style={{
          marginTop:
            "30px",
        }}
      />

      {/* TRANSCRIPT */}

      <h3>
        Handoff transcript
      </h3>

      <textarea
        value={finalText}
        onChange={(event) => {
          const value =
            event.target.value;

          setFinalText(
            value
          );

          finalTextRef.current =
            value;
        }}
        placeholder="Speak the handoff..."
        rows={6}
        style={{
          width: "100%",
          padding: "12px",
          fontSize: "16px",
          boxSizing:
            "border-box",
        }}
      />

      {liveText && (
        <div
          style={{
            marginTop:
              "15px",
          }}
        >
          <strong>
            Live speech:
          </strong>

          <p>
            {liveText}
          </p>
        </div>
      )}

      {/* ERROR */}

      {handoffError && (
        <div
          style={{
            marginTop:
              "25px",
            padding:
              "15px",
            border:
              "1px solid red",
          }}
        >
          <strong>
            ❌ Error
          </strong>

          <p>
            {handoffError}
          </p>
        </div>
      )}

      {/* ANALYSIS */}

      {handoffResult && (
        <div
          style={{
            marginTop:
              "30px",
            padding:
              "20px",
            border:
              "1px solid #555",
          }}
        >
          <h2>
            RELAY Analysis
          </h2>

          <p>
            <strong>
              Patient:
            </strong>{" "}
            {
              handoffResult.patient_id
            }
          </p>

          {handoffResult.memory_check && (
            <>
              <p>
                <strong>
                  Unresolved
                  memories:
                </strong>{" "}
                {
                  handoffResult
                    .memory_check
                    .unresolved_found
                }
              </p>

              <p>
                <strong>
                  Missing from
                  handoff:
                </strong>{" "}
                {
                  handoffResult
                    .memory_check
                    .missing_from_handoff
                }
              </p>
            </>
          )}

          {handoffResult.requires_confirmation &&
            !confirmationResult && (
              <div
                style={{
                  marginTop:
                    "20px",
                  padding:
                    "15px",
                  border:
                    "1px solid #777",
                }}
              >
                <h3>
                  ⚠️ Voice
                  confirmation
                </h3>

                <p>
                  {
                    handoffResult.confirmation_text
                  }
                </p>

                <p>
                  <strong>
                    Just say YES
                    or NO.
                  </strong>
                </p>
              </div>
            )}

          {confirmationResult && (
            <div
              style={{
                marginTop:
                  "20px",
                padding:
                  "15px",
                border:
                  "1px solid #555",
              }}
            >
              <strong>
                RELAY:
              </strong>

              <p>
                {
                  confirmationResult.final_message
                }
              </p>
            </div>
          )}

          {finalizedHandoff && (
            <div
              style={{
                marginTop:
                  "30px",
                padding:
                  "20px",
                border:
                  "2px solid #777",
              }}
            >
              <h2>
                ✅ Finalized
                Handoff
              </h2>

              <p
                style={{
                  fontSize:
                    "18px",
                  lineHeight:
                    "1.6",
                }}
              >
                {
                  finalizedHandoff
                }
              </p>

              <p>
                RELAY is still
                listening. Start
                speaking again to
                begin another
                handoff.
              </p>

              <button
                onClick={
                  startNewHandoff
                }
                style={{
                  marginTop:
                    "10px",
                  padding:
                    "10px 18px",
                }}
              >
                Change patient
              </button>
            </div>
          )}
        </div>
      )}

      {/* DEBUG */}

      <hr
        style={{
          marginTop:
            "40px",
        }}
      />

      <details>
        <summary>
          Microphone debug
        </summary>

        <pre>
          {micSettings
            ? JSON.stringify(
                micSettings,
                null,
                2
              )
            : "Start microphone first"}
        </pre>
      </details>
    </div>
  );
}

export default App;