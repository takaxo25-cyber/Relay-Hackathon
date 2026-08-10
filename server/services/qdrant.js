const path = require("path");

require("dotenv").config({
  path: path.join(__dirname, "..", ".env"),
});

const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
    url: process.env.QDRANT_URL,
    apiKey: process.env.QDRANT_API_KEY,
    checkCompatibility: false,
  });

const COLLECTION = "relay_memory";

async function getUnresolvedMemories(patientId) {
  const result = await qdrant.scroll(COLLECTION, {
    filter: {
      must: [
        {
          key: "facility_id",
          match: {
            value: "demo-hospital",
          },
        },
        {
          key: "patient_id",
          match: {
            value: patientId,
          },
        },
        {
          key: "resolved",
          match: {
            value: false,
          },
        },
      ],
    },

    limit: 10,
    with_payload: true,
    with_vector: false,
  });

  return result.points;
}
async function resolveMemory(memoryId) {
  await qdrant.setPayload(COLLECTION, {
    payload: {
      resolved: true,
      status: "resolved",
    },
    points: [memoryId],
  });
}
module.exports = {
  getUnresolvedMemories,
  resolveMemory,
};