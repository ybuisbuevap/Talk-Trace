import { pipeline } from "@xenova/transformers";
import logger from "../utils/logger.js";

// Singleton embedder — loaded ONCE at server startup
// All subsequent calls reuse this instance (model stays warm in memory)
let embedder = null;

/**
 * initEmbedder — call this in app.js BEFORE app.listen()
 * Downloads model on first run (~30MB), cached locally after that.
 * Model: all-MiniLM-L6-v2 — 384 dimensions, fast, good quality
 */
export const initEmbedder = async () => {
    if (embedder) return embedder;

    logger.info({}, "Loading embedding model (all-MiniLM-L6-v2)...");
    const start = Date.now();

    embedder = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        { quantized: true } // smaller model file, faster loading, minimal quality loss
    );

    logger.info({ loadTimeMs: Date.now() - start }, "Embedding model loaded");
    return embedder;
};

/**
 * embed — generate a single embedding vector for a text string.
 * Returns: number[] of length 384
 */
export const embed = async (text) => {
    if (!embedder) throw new Error("Embedder not initialized — call initEmbedder() first");

    const output = await embedder(text, { pooling: "mean", normalize: true });
    return Array.from(output.data); // convert Float32Array to plain number[]
};

/**
 * embedBatch — embed multiple texts efficiently.
 * Returns: number[][] — one embedding per text
 */
export const embedBatch = async (texts) => {
    if (!embedder) throw new Error("Embedder not initialized — call initEmbedder() first");

    const results = [];
    // Process in batches of 32 to avoid memory pressure
    const BATCH_SIZE = 32;
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);
        const embeddings = await Promise.all(batch.map(t => embed(t)));
        results.push(...embeddings);
    }
    return results;
};

/**
 * cosineSimilarity — brute force cosine similarity between two vectors.
 * Fast enough for 50-150 chunks (single meeting transcript).
 * For scale: use MongoDB Atlas Vector Search index instead.
 */
export const cosineSimilarity = (a, b) => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

/**
 * similaritySearch — find topK most relevant chunks for a query.
 * chunks: [{ text, speaker, start, end, embedding }]
 * Returns: top K chunks sorted by similarity score
 */
export const similaritySearch = async (query, chunks, topK = 5) => {
    if (!chunks || chunks.length === 0) return [];

    const queryEmbedding = await embed(query);

    const scored = chunks.map(chunk => ({
        text: chunk.text,
        speaker: chunk.speaker,
        start: chunk.start,
        end: chunk.end,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort by score descending — highest similarity first
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, topK);
};
