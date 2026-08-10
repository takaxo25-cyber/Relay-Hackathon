const fs = require("fs");
const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

async function testRime() {
  try {
    console.log("🎙️ Sending text to Rime...");

    const response = await fetch("https://users.rime.ai/v1/rime-tts", {
      method: "POST",

      headers: {
        Authorization: `Bearer ${process.env.RIME_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "audio/webm;codecs=opus",
      },

      body: JSON.stringify({
        text: "Before I finalize, the previous handoff lists an active fall-risk precaution. Is that still active?",
        modelId: "mistv3",
        speaker: "cove",
        lang: "en",
        samplingRate: 24000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      console.error("❌ RIME FAILED");
      console.error("Status:", response.status);
      console.error(errorText);

      return;
    }

    const audio = Buffer.from(await response.arrayBuffer());

    const outputPath = path.join(__dirname, "rime-test.webm");

    fs.writeFileSync(outputPath, audio);

    console.log("✅ RIME WORKED");
    console.log("🔊 Audio saved to:");
    console.log(outputPath);

  } catch (error) {
    console.error("❌ RIME TEST ERROR");
    console.error(error);
  }
}

testRime();