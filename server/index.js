const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const patientRoutes = require("./routes/patients");
const handoffRoutes = require("./routes/handoff");

const app = express();

app.use(cors());
app.use(express.json());

app.use(
  "/audio",
  express.static(path.join(__dirname, "generated"))
);

app.get("/", (req, res) => {
  res.send("RELAY backend running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "RELAY",
  });
});

app.use("/api/patients", patientRoutes);
app.use("/api/handoff", handoffRoutes);

// Create one HTTP server for Express + microphone WebSocket
const server = http.createServer(app);

// Browser connects here
const wss = new WebSocketServer({
  server,
  path: "/ws/transcribe",
});

wss.on("connection", (browserSocket) => {
  console.log("🎙️ Browser microphone connected");

  const params = new URLSearchParams();

  params.set("model", "nova-3");
  params.set("language", "en-US");
  params.set("smart_format", "true");
  params.set("punctuate", "true");

  // Give us live words before the sentence is finished
  params.set("interim_results", "true");

  // Helps detect when speech begins/ends
  params.set("vad_events", "true");
  params.set("endpointing", "300");
  params.set("utterance_end_ms", "1000");

  // Speaker separation
  params.set("diarize_model", "latest");

  // Important RELAY vocabulary
  params.append("keyterm", "fall risk");
  params.append("keyterm", "mobility assistance");
  params.append("keyterm", "handoff");
  params.append("keyterm", "precaution");

  const deepgramSocket = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      headers: {
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      },
    }
  );

  deepgramSocket.on("open", () => {
    console.log("✅ Deepgram live connection opened");

    browserSocket.send(
      JSON.stringify({
        type: "ready",
      })
    );
  });

  // Deepgram → our browser
  deepgramSocket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === "SpeechStarted") {
        browserSocket.send(
          JSON.stringify({
            type: "speech_started",
          })
        );

        return;
      }

      if (message.type === "UtteranceEnd") {
        browserSocket.send(
          JSON.stringify({
            type: "utterance_end",
          })
        );

        return;
      }

      if (message.type !== "Results") {
        return;
      }

      const alternative =
        message.channel?.alternatives?.[0];

      const transcript =
        alternative?.transcript || "";

      if (!transcript.trim()) {
        return;
      }

      browserSocket.send(
        JSON.stringify({
          type: "transcript",

          transcript,

          confidence:
            alternative.confidence ?? null,

          words:
            alternative.words || [],

          is_final:
            message.is_final || false,

          speech_final:
            message.speech_final || false,
        })
      );
    } catch (error) {
      console.error(
        "❌ Deepgram message error:",
        error
      );
    }
  });

  // Browser microphone → Deepgram
  browserSocket.on("message", (audio, isBinary) => {
    if (
      isBinary &&
      deepgramSocket.readyState === WebSocket.OPEN
    ) {
      deepgramSocket.send(audio);
    }
  });

  deepgramSocket.on("error", (error) => {
    console.error("❌ Deepgram live error:", error);

    browserSocket.send(
      JSON.stringify({
        type: "error",
        message: "Speech recognition failed",
      })
    );
  });

  browserSocket.on("close", () => {
    console.log("🎙️ Browser microphone disconnected");

    if (deepgramSocket.readyState === WebSocket.OPEN) {
      deepgramSocket.send(
        JSON.stringify({
          type: "CloseStream",
        })
      );
    }
  });
});

const PORT = process.env.PORT || 5001;

server.listen(PORT, () => {
  console.log(
    `🔥 RELAY running on http://localhost:${PORT}`
  );

  console.log(
    `🎙️ Mic socket: ws://localhost:${PORT}/ws/transcribe`
  );
});