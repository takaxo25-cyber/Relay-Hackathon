const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
console.log("URL loaded:", !!process.env.QDRANT_URL);
console.log("API key loaded:", !!process.env.QDRANT_API_KEY);
console.log("URL:", process.env.QDRANT_URL);console.log("URL loaded:", !!process.env.QDRANT_URL);
console.log("API key loaded:", !!process.env.QDRANT_API_KEY);
console.log("URL:", process.env.QDRANT_URL);
const { QdrantClient } = require("@qdrant/js-client-rest");

const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

async function testConnection() {
  try {
    const result = await qdrant.getCollections();

    console.log("✅ QDRANT CONNECTED");
    console.log(result);
  } catch (error) {
    console.error("❌ QDRANT CONNECTION FAILED");
    console.error(error);
  }
}

testConnection();
