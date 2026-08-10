const fs = require("fs");
const path = require("path");
const { DeepgramClient } = require("@deepgram/sdk");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

async function testDeepgram() {
  try {
    console.log("🎙️ Testing Deepgram...");

    const deepgram = new DeepgramClient({
      apiKey: process.env.DEEPGRAM_API_KEY,
    });

    const audioPath = path.join(__dirname, "rime-test.webm");

    const response = await deepgram.listen.v1.media.transcribeFile(
      fs.createReadStream(audioPath),
      {
        model: "nova-3",
        language: "en-US",
        smart_format: true,
      }
    );

    const transcript =
      response.results.channels[0].alternatives[0].transcript;

    console.log("✅ DEEPGRAM WORKED");
    console.log("📝 Transcript:");
    console.log(transcript);
  } catch (error) {
    console.error("❌ DEEPGRAM FAILED");
    console.error(error);
  }
}

testDeepgram();