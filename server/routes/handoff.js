const fs = require("fs");
const path = require("path");
const express = require("express");

const { generateSpeech } = require("../services/rime");

const {
  getUnresolvedMemories,
  resolveMemory,
} = require("../services/qdrant");

const router = express.Router();


// ==========================================
// ANALYZE HANDOFF
// ==========================================

router.post("/analyze", async (req, res) => {
  try {
    const { patient_id, transcript } = req.body;

    if (!patient_id || !transcript) {
      return res.status(400).json({
        error: "patient_id and transcript are required",
      });
    }

    // 1. Get unresolved memories
    const memories = await getUnresolvedMemories(patient_id);

    // 2. Detect anything omitted from handoff
    const missingItems = memories.filter((memory) => {
      const transcriptLower = transcript.toLowerCase();

      if (memory.payload.category === "fall_risk") {
        return !(
          transcriptLower.includes("fall risk") ||
          transcriptLower.includes("fall-risk") ||
          transcriptLower.includes("fall precaution")
        );
      }

      return !transcriptLower.includes(
        memory.payload.text.toLowerCase()
      );
    });

    // 3. Build confirmation question
    const confirmationText =
      missingItems.length > 0
        ? `Before I finalize, the previous handoff lists ${missingItems[0].payload.text}. Is that still active?`
        : null;

    // 4. Generate confirmation audio
    let audioUrl = null;

    if (confirmationText) {
      console.log("1️⃣ Missing item detected");
      console.log("2️⃣ Sending confirmation to Rime");

      const audio = await generateSpeech(confirmationText);

      console.log("3️⃣ Rime audio received");

      const generatedFolder = path.join(
        __dirname,
        "..",
        "generated"
      );

      fs.mkdirSync(generatedFolder, {
        recursive: true,
      });

      const fileName =
        `confirmation-${Date.now()}.webm`;

      const filePath = path.join(
        generatedFolder,
        fileName
      );

      fs.writeFileSync(filePath, audio);

      console.log(
        "4️⃣ Audio file saved:",
        fileName
      );

      audioUrl = `/audio/${fileName}`;
    }

    // If nothing is missing, handoff is already final
    const finalHandoff =
      missingItems.length === 0
        ? transcript.trim()
        : null;

    return res.json({
      patient_id,
      transcript,

      memory_check: {
        unresolved_found: memories.length,
        missing_from_handoff: missingItems.length,
      },

      missing_items: missingItems.map((memory) => ({
        id: memory.id,
        category: memory.payload.category,
        risk_level: memory.payload.risk_level,
        text: memory.payload.text,
      })),

      requires_confirmation:
        missingItems.length > 0,

      confirmation_text:
        confirmationText,

      audio_url:
        audioUrl,

      final_handoff:
        finalHandoff,
    });

  } catch (error) {
    console.error(
      "❌ Handoff failed:",
      error
    );

    return res.status(500).json({
      error: "Unable to analyze handoff",
      details: error.message,
    });
  }
});


// ==========================================
// CONFIRM MEMORY
// ==========================================

router.post("/confirm", async (req, res) => {
  try {
    const {
      patient_id,
      memory_id,
      answer,
      transcript,
    } = req.body;

    if (
      !patient_id ||
      memory_id === undefined ||
      !answer ||
      !transcript
    ) {
      return res.status(400).json({
        error:
          "patient_id, memory_id, answer and transcript are required",
      });
    }

    const normalizedAnswer =
      answer.toLowerCase().trim();

    if (
      normalizedAnswer !== "yes" &&
      normalizedAnswer !== "no"
    ) {
      return res.status(400).json({
        error: "Answer must be yes or no",
      });
    }

    // Find the memory being confirmed
    const memories =
      await getUnresolvedMemories(patient_id);

    const memory = memories.find(
      (item) =>
        String(item.id) === String(memory_id)
    );

    if (!memory) {
      return res.status(404).json({
        error:
          "The unresolved memory could not be found",
      });
    }


    // =====================================
    // NO → issue is no longer active
    // =====================================

    if (normalizedAnswer === "no") {
      await resolveMemory(memory_id);

      return res.json({
        patient_id,
        memory_id,

        answer: "no",

        resolved: true,

        final_message:
          "Got it. That item is no longer active. The handoff has been finalized.",

        final_handoff:
          transcript.trim(),
      });
    }


    // =====================================
    // YES → carry item into final handoff
    // =====================================

    const missingText =
      memory.payload.text.trim();

    let finalHandoff =
      transcript.trim();

    if (
      !finalHandoff
        .toLowerCase()
        .includes(
          missingText.toLowerCase()
        )
    ) {
      if (
        !finalHandoff.endsWith(".") &&
        !finalHandoff.endsWith("!") &&
        !finalHandoff.endsWith("?")
      ) {
        finalHandoff += ".";
      }

      finalHandoff += ` ${missingText}.`;
    }

    return res.json({
      patient_id,
      memory_id,

      answer: "yes",

      resolved: false,

      include_in_handoff: true,

      final_message:
        "Confirmed. I've carried the active item forward and finalized the handoff.",

      final_handoff:
        finalHandoff,
    });

  } catch (error) {
    console.error(
      "❌ Confirmation failed:",
      error
    );

    return res.status(500).json({
      error:
        "Unable to process confirmation",

      details:
        error.message,
    });
  }
});


module.exports = router;