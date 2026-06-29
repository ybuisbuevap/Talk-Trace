import fs from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { Session } from "../models/session.model.js";
import { scheduleProcessing } from "../services/agenda.service.js";
import { sseManager } from "../services/sse.service.js";
import logger from "../utils/logger.js";

/**
 * GET /api/upload/init
 * Call this BEFORE uploading to ensure ownerToken cookie is set.
 * Solves cross-origin cookie timing issue — cookie is set on this
 * request so it's available on the subsequent upload request.
 */
export const initOwner = async (req, res) => {
    // ownerMiddleware already ran and set the cookie
    // Just return the token so frontend can confirm it's set
    res.json({ ready: true });
};

/**
 * POST /api/upload
 * Saves file to disk, creates session, queues Agenda job.
 * Returns immediately — processing happens in background.
 */
export const uploadFile = async (req, res) => {
    let filePath = null;

    try {
        if (!req.file) {
            return res.status(400).json({ message: "No file uploaded" });
        }

        const sessionId = uuidv4();
        const ext = path.extname(req.file.originalname) || ".mp3";

        // Save to temp dir — Agenda job will clean up after processing
        filePath = path.join(os.tmpdir(), `${sessionId}${ext}`);
        fs.writeFileSync(filePath, req.file.buffer);

        logger.info({ sessionId, filename: req.file.originalname, size: req.file.size }, "File received");

        // Create session in MongoDB — stamp with ownerToken
        await Session.create({
            sessionId,
            ownerToken: req.ownerToken, // from ownerMiddleware
            status: "transcribing",
            input: {
                type: "file",
                source: req.file.originalname,
                mimeType: req.file.mimetype,
            },
        });

        // Queue the processing job via Agenda
        // Returns immediately — pipeline runs in background
        await scheduleProcessing(sessionId, filePath);

        // Respond immediately — frontend will listen for SSE updates
        res.status(202).json({
            sessionId,
            message: "File received. Processing started.",
            status: "transcribing",
        });

    } catch (err) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        logger.error({ err: err.message }, "Upload failed");
        res.status(500).json({ message: "Upload failed. Please try again." });
    }
};

/**
 * GET /api/upload/status/:sessionId
 * Polling fallback — frontend uses SSE primarily,
 * but polls this as backup if SSE connection drops.
 */
export const getStatus = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await Session.findOne({ sessionId })
            .select("sessionId status title transcript.wordCount input errorMessage");

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        res.json({
            sessionId: session.sessionId,
            status: session.status,
            title: session.title,
            wordCount: session.transcript?.wordCount ?? 0,
            duration: session.input?.duration ?? null,
            errorMessage: session.errorMessage,
        });

    } catch (err) {
        logger.error({ err: err.message }, "Status check failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};

/**
 * GET /api/upload/progress/:sessionId
 * SSE endpoint — client opens EventSource connection here.
 * Streams pipeline stage updates until complete or failed.
 */
export const streamProgress = async (req, res) => {
    const { sessionId } = req.params;

    // Check session exists
    const session = await Session.findOne({ sessionId })
        .select("status");

    if (!session) {
        return res.status(404).json({ message: "Session not found" });
    }

    // If already done — send final event immediately, no need to stream
    if (session.status === "ready") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ stage: "ready" })}\n\n`);
        res.end();
        return;
    }

    if (session.status === "failed") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        });
        res.write(`data: ${JSON.stringify({ stage: "failed", error: session.errorMessage })}\n\n`);
        res.end();
        return;
    }

    // Set SSE headers
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // disable Nginx buffering on Render
    });

    // Send initial heartbeat so browser knows connection is alive
    res.write(`: connected\n\n`);

    // Register this response with SSE manager
    sseManager.add(sessionId, res);

    // Clean up when client disconnects
    req.on("close", () => {
        sseManager.remove(sessionId, res);
        logger.debug({ sessionId }, "SSE client disconnected");
    });

    // Heartbeat every 15s to prevent connection timeout
    const heartbeat = setInterval(() => {
        try {
            res.write(`: heartbeat\n\n`);
        } catch {
            clearInterval(heartbeat);
        }
    }, 15000);

    req.on("close", () => clearInterval(heartbeat));
};