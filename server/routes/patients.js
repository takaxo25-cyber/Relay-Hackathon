const express = require("express");
const { getUnresolvedMemories } = require("../services/qdrant");

const router = express.Router();

router.get("/\:patientId/unresolved", async (req, res) => {
try {
const patientId = req.params.patientId;

```
const memories = await getUnresolvedMemories(patientId);

const unresolved = memories.map((memory) => ({
  id: memory.id,
  category: memory.payload.category,
  risk_level: memory.payload.risk_level,
  status: memory.payload.status,
  text: memory.payload.text,
}));

return res.json({
  patient_id: patientId,
  unresolved,
});
```

} catch (error) {
console.error("❌ Patient retrieval failed:", error);

```
return res.status(500).json({
  error: "Unable to retrieve patient memory",
  details: error.message,
  status: error.status || null,
});
```

}
});

module.exports = router;