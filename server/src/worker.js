import { Worker } from "bullmq";
import { CohereEmbeddings } from "@langchain/cohere";
import { QdrantVectorStore } from "@langchain/qdrant";
import * as dotenv from "dotenv";
import { ApiError } from "./utils/ApiError.js";
import logger from "./logger/wiston.logger.js";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

dotenv.config({ path: "./.env" });

const worker = new Worker(
  "file-upload-queue",
  async (job) => {
    const { pdftext } = job.data;

    if (!pdftext || pdftext.length === 0) {
      throw new ApiError(400, "Text is missing", []);
    }

    const fullText = pdftext.join(" ").trim();

    if (!fullText) {
      throw new ApiError(400, "PDF text is empty or couldn't be parsed", []);
    }

    // Chunk the document using RecursiveCharacterTextSplitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1100,
      chunkOverlap: 130,
    });
    const docs = await splitter.createDocuments([fullText]);
console.log(docs);

    // Initialize Cohere embeddings
    const embeddings = new CohereEmbeddings({
      apiKey: process.env.COHERE_API_KEY,
      model: "embed-english-v3.0",
    });

    // Store in Qdrant (with chunking)
    const vectorStore = await QdrantVectorStore.fromDocuments(
      docs,
      embeddings,
      {
        url: "http://qdrant:6333",
        collectionName: "ragapp",
      }
    );

    logger.info("✅ Document added to vector store");
  },
  {
    concurrency: 10, // safer default for production
    connection: {
  url:"redis://redis:6379"
    },
  }
);

// Log job completion
worker.on("completed", (job) => {
  logger.info(`🎉 Job ${job.id} completed successfully`);
});

// Log job failure
worker.on("failed", (job, err) => {
  logger.error(`🔥 Job ${job.id} failed: ${err.message}`, {
    stack: err.stack,
  });
});

// Graceful shutdown
const shutdown = async () => {
  logger.info("🛑 Shutting down worker...");
  await worker.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
