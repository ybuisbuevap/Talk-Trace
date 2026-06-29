import { Session } from "../models/session.model.js";
import { requireOwner } from "../middleware/owner.middleware.js";
import { similaritySearch } from "../services/embedder.service.js";
import { chat, generateSummary } from "../services/langchain.service.js";
import logger from "../utils/logger.js";

/**
 * POST /api/chat
 * Main conversation endpoint.
 * Flow: load session → similarity search → call Mistral → save history → respond
 */
export const chatWithAgent = async (req, res) => {
    try {
        const { sessionId, message } = req.body;

        if (!sessionId || !message?.trim()) {
            return res.status(400).json({ message: "sessionId and message required" });
        }

        // Load session and verify ownership
        const session = await Session.findOne({ sessionId });
        if (!requireOwner(session, req, res)) return;

        if (session.status !== "ready") {
            return res.status(400).json({
                message: `Session is not ready yet. Current status: ${session.status}`,
                status: session.status,
            });
        }

        // Step 1 — Similarity search for relevant chunks
        const contextChunks = await similaritySearch(
            message,
            session.chunks,
            5 // top 5 most relevant chunks
        );

        logger.info({
            sessionId,
            query: message.slice(0, 50),
            topScore: contextChunks[0]?.score?.toFixed(3),
        }, "Similarity search done");

        // Step 2 — Get last 10 turns from MongoDB for conversation memory
        const recentHistory = session.getRecentHistory(10);

        // Step 3 — Call Mistral via LangChain
        const { response, isStructured, parsed } = await chat({
            message: message.trim(),
            contextChunks,
            conversationHistory: recentHistory,
            language: session.transcript.language,
        });

        // Step 4 — Build atomic update object
        const updateFields = {};

        if (isStructured && parsed) {
            if (parsed.summary && !session.isCacheValid("summary")) {
                updateFields["cache.summary"] = parsed.summary;
                updateFields["cache.summaryHash"] = session.transcriptHash;
            }
            if (parsed.actionItems?.length && !session.isCacheValid("actionItems")) {
                updateFields["cache.actionItems"] = parsed.actionItems;
                updateFields["cache.actionItemsHash"] = session.transcriptHash;
            }
            if (parsed.keyDecisions?.length && !session.isCacheValid("keyDecisions")) {
                updateFields["cache.keyDecisions"] = parsed.keyDecisions;
                updateFields["cache.keyDecisionsHash"] = session.transcriptHash;
            }
        }

        // Step 5 — Build new history (cap at 100)
        const newHistory = [
            ...session.conversationHistory,
            { role: "human", content: message.trim(), timestamp: new Date() },
            { role: "ai", content: response, timestamp: new Date() },
        ].slice(-100);

        updateFields["conversationHistory"] = newHistory;

        // Atomic update — no version conflict
        await Session.findOneAndUpdate(
            { sessionId },
            { $set: updateFields }
        );

        res.json({
            response,
            sourceChunks: contextChunks.map(c => ({
                text: c.text,
                speaker: c.speaker,
                start: c.start,
                score: parseFloat(c.score.toFixed(3)),
            })),
            cached: {
                hasSummary: session.isCacheValid("summary"),
                hasActionItems: session.isCacheValid("actionItems"),
                hasKeyDecisions: session.isCacheValid("keyDecisions"),
            },
        });

    } catch (err) {
        logger.error({ err }, "Chat failed");
        res.status(500).json({ message: "Something went wrong. Please try again." });
    }
};

/**
 * GET /api/chat/:sessionId
 * Returns session info + cached AI outputs + conversation history.
 */
export const getSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await Session.findOne({ sessionId })
            .select("-chunks.embedding");

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        // Note: getSession doesn't check ownership — it only returns metadata
        // Sensitive operations (chat, summarize, export) all check ownership

        res.json({
            sessionId: session.sessionId,
            title: session.title,
            status: session.status,
            input: session.input,
            transcript: {
                wordCount: session.transcript.wordCount,
                language: session.transcript.language,
                generatedAt: session.transcript.generatedAt,
                // Send full text for TranscriptViewer component
                fullText: session.transcript.fullText,
            },
            cache: {
                summary: session.isCacheValid("summary") ? session.cache.summary : null,
                actionItems: session.isCacheValid("actionItems") ? session.cache.actionItems : [],
                keyDecisions: session.isCacheValid("keyDecisions") ? session.cache.keyDecisions : [],
            },
            conversationHistory: session.conversationHistory,
            createdAt: session.createdAt,
        });

    } catch (err) {
        logger.error({ err }, "Get session failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};

/**
 * POST /api/chat/:sessionId/summarize
 * Dedicated endpoint to generate + cache meeting summary.
 * Called automatically when user first opens chat page.
 */
export const summarizeSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await Session.findOne({ sessionId }).lean();

        // Manual ownership check — .lean() removes instance methods
        if (!session || session.ownerToken !== req.ownerToken) {
            return res.status(404).json({ message: "Session not found" });
        }

        // Manual cache check — .lean() removes Mongoose instance methods
        const summaryValid = session.cache?.summaryHash === session.transcriptHash;
        if (summaryValid && session.cache?.summary) {
            return res.json({
                summary: session.cache.summary,
                actionItems: session.cache.actionItems || [],
                keyDecisions: session.cache.keyDecisions || [],
                fromCache: true,
            });
        }

        // Generate fresh summary
        const parsed = await generateSummary(
            session.transcript.fullText,
            session.transcript.language
        );

        if (!parsed) {
            return res.status(500).json({ message: "Summary generation failed" });
        }

        // Use findOneAndUpdate to avoid Mongoose VersionError
        // (upload pipeline may have saved the document concurrently)
        await Session.findOneAndUpdate(
            { sessionId },
            {
                $set: {
                    "cache.summary": parsed.summary,
                    "cache.summaryHash": session.transcriptHash,
                    "cache.actionItems": parsed.actionItems || [],
                    "cache.actionItemsHash": session.transcriptHash,
                    "cache.keyDecisions": parsed.keyDecisions || [],
                    "cache.keyDecisionsHash": session.transcriptHash,
                }
            },
            { new: true }
        );

        res.json({
            summary: parsed.summary,
            actionItems: parsed.actionItems || [],
            keyDecisions: parsed.keyDecisions || [],
            topics: parsed.topics || [],
            sentiment: parsed.sentiment || "neutral",
            fromCache: false,
        });

    } catch (err) {
        // Print FULL error with complete stack trace
        console.error("=== SUMMARIZE ERROR ===");
        console.error("Message:", err.message);
        console.error("Name:", err.name);
        console.error("Stack:", err.stack);
        console.error("======================");
        logger.error({ err: err.message, stack: err.stack }, "Summarize failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};

/**
 * PATCH /api/chat/:sessionId/action-items/:itemId
 * Toggle action item done/pending.
 */
export const toggleActionItem = async (req, res) => {
    try {
        const { sessionId, itemId } = req.params;
        const session = await Session.findOne({ sessionId });
        if (!requireOwner(session, req, res)) return;

        const item = session.cache.actionItems.id(itemId);
        if (!item) {
            return res.status(404).json({ message: "Action item not found" });
        }

        const newStatus = item.status === "pending" ? "done" : "pending";

        // Atomic update using positional operator — no version conflict
        await Session.findOneAndUpdate(
            { sessionId, "cache.actionItems._id": itemId },
            { $set: { "cache.actionItems.$.status": newStatus } }
        );

        res.json({ itemId, status: newStatus });

    } catch (err) {
        logger.error({ err }, "Toggle action item failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};