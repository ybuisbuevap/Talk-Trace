import { Agenda } from "agenda";
import mongoose from "mongoose";
import fs from "fs";
import { Session } from "../models/session.model.js";
import { transcribeFile } from "./deepgram.service.js";
import { chunkSegments, generateTitle } from "./chunker.service.js";
import { embedBatch } from "./embedder.service.js";
import { sseManager } from "./sse.service.js";
import logger from "../utils/logger.js";

let agenda = null;

/**
 * initAgenda — create and start the Agenda instance.
 * Called once in app.js after MongoDB connects.
 * Uses the same MongoDB connection — no extra infra needed.
 */
export const initAgenda = async () => {
    if (agenda) return agenda;

    // Use mongoUri — more reliable across Agenda versions
    agenda = new Agenda({
        db: {
            address: process.env.MONGODB_URI,
            collection: "jobs",
        },
        processEvery: "2 seconds",
        maxConcurrency: 2,
    });

    // Define the processing job
    agenda.define("process-upload", { priority: "high", concurrency: 1 }, processUploadJob);

    await agenda.start();
    logger.info({}, "Agenda job queue started");

    // Auto-remove completed jobs — prevents agendaJobs collection growing indefinitely
    agenda.on("complete", (job) => {
        job.remove().catch(() => {});
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
        await agenda.stop();
        logger.info({}, "Agenda stopped");
    });

    return agenda;
};

/**
 * scheduleProcessing — queue a new processing job.
 * Called from upload controller immediately after file is saved.
 */
export const scheduleProcessing = async (sessionId, filePath) => {
    if (!agenda) throw new Error("Agenda not initialized");

    await agenda.now("process-upload", { sessionId, filePath });
    logger.info({ sessionId }, "Processing job queued");
};

/**
 * processUploadJob — the actual pipeline job.
 * Runs in background via Agenda.
 * Emits SSE events at each stage.
 */
const processUploadJob = async (job) => {
    const { sessionId, filePath } = job.attrs.data;

    const emit = (stage, data = {}) => {
        sseManager.emit(sessionId, { stage, ...data });
        logger.info({ sessionId, stage }, "Pipeline stage");
    };

    try {
        // Stage 1 — Transcribe
        emit("transcribing");
        const { fullText, segments, language, duration } =
            await transcribeFile(filePath);

        const transcriptHash = Session.hashText(fullText);
        const title = generateTitle(fullText);

        await Session.findOneAndUpdate(
            { sessionId },
            {
                $set: {
                    "transcript.fullText": fullText,
                    "transcript.segments": segments,
                    "transcript.wordCount": fullText.split(/\s+/).length,
                    "transcript.language": language,
                    "transcript.generatedAt": new Date(),
                    "input.duration": duration,
                    title,
                    transcriptHash,
                    status: "embedding",
                }
            }
        );

        // Stage 2 — Chunk + Embed
        emit("embedding");
        const chunks = chunkSegments(segments);
        const texts = chunks.map(c => c.text);
        const embeddings = await embedBatch(texts);
        const chunksWithEmbeddings = chunks.map((chunk, i) => ({
            ...chunk,
            embedding: embeddings[i],
        }));

        await Session.findOneAndUpdate(
            { sessionId },
            {
                $set: {
                    chunks: chunksWithEmbeddings,
                    status: "ready",
                }
            }
        );

        // Stage 3 — Done
        emit("ready", { title, wordCount: fullText.split(/\s+/).length });
        logger.info({ sessionId, chunks: chunks.length }, "Pipeline complete");

    } catch (err) {
        logger.error({ err: err.message, sessionId }, "Pipeline job failed");
        await Session.findOneAndUpdate(
            { sessionId },
            { $set: { status: "failed", errorMessage: err.message } }
        );
        emit("failed", { error: err.message });
        throw err; // let Agenda mark job as failed for inspection
    } finally {
        // Always cleanup temp file
        if (filePath && fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info({ filePath }, "Temp file cleaned up");
        }
    }
};