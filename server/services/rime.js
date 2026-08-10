async function generateSpeech(text) {
    const response = await fetch("https://users.rime.ai/v1/rime-tts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RIME_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "audio/webm;codecs=opus",
      },
      body: JSON.stringify({
        text,
        modelId: "mistv3",
        speaker: "cove",
        lang: "en",
        samplingRate: 24000,
      }),
    });
  
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Rime failed: ${response.status} ${errorText}`);
    }
  
    return Buffer.from(await response.arrayBuffer());
  }
  
  module.exports = {
    generateSpeech,
  };