const path = require("path");
require("dotenv").config({
  path: path.join(__dirname, ".env"),
});

const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const COLLECTION = "relay_memory";

async function runMemoryTest() {
  try {
    // 1. Check whether our memory collection already exists
    const existing = await qdrant.getCollections();

    const collectionExists = existing.collections.some(
      (collection) => collection.name === COLLECTION
    );

    // 2. Create it if this is our first run
    if (!collectionExists) {
      await qdrant.createCollection(COLLECTION, {
        vectors: {},
      });

      console.log("✅ Created relay_memory collection");
    } else {
      console.log("✅ relay_memory already exists");
    }
    // Create indexes for fields RELAY filters by
await qdrant.createPayloadIndex(COLLECTION, {
    field_name: "facility_id",
    field_schema: "keyword",
  });
  
  await qdrant.createPayloadIndex(COLLECTION, {
    field_name: "patient_id",
    field_schema: "keyword",
  });
  
  await qdrant.createPayloadIndex(COLLECTION, {
    field_name: "resolved",
    field_schema: "bool",
  });
  
  console.log("✅ Payload indexes ready");

    // 3. Store Patient 204's unresolved handoff item
    await qdrant.upsert(COLLECTION, {
      wait: true,
      points: [
        {
          id: 204001,
          vector: {},
      
          payload: {
            facility_id: "demo-hospital",
            patient_id: "204",
            handoff_id: "previous-shift",

            category: "fall_risk",
            risk_level: "high",

            status: "active",
            resolved: false,

            text: "Fall-risk precaution remains active",

            created_at: "2026-08-09T19:00:00Z",
          },
        },
      ],
    });

    console.log("✅ Patient 204 memory stored");

    // 4. Retrieve ONLY unresolved memories
    // for the correct facility and patient
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
              value: "204",
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

    console.log("\n🧠 UNRESOLVED MEMORY FOUND:");
    console.log(JSON.stringify(result.points, null, 2));
  } catch (error) {
    console.error("❌ MEMORY TEST FAILED");
    console.error(error);
  }
}

runMemoryTest();