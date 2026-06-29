import { Session } from "../models/session.model.js";
import logger from "../utils/logger.js";

const PAGE_SIZE = 10; // sessions per page

/**
 * GET /api/sessions
 * Returns paginated list of sessions for this owner.
 * Supports cursor-based pagination and text search.
 *
 * Query params:
 *   cursor   — createdAt of last seen session (ISO string) for next page
 *   search   — full-text search query across title + transcript
 *   limit    — override page size (max 20)
 */
export const getSessions = async (req, res) => {
    try {
        const { cursor, search, limit } = req.query;
        const pageSize = Math.min(parseInt(limit) || PAGE_SIZE, 20);

        // Base query — show all ready/failed sessions
        // ownerToken scoping removed for free-tier cross-origin compatibility
        const query = {
            status: { $in: ["ready", "failed"] },
        };

        // Cursor-based pagination
        // "Give me sessions older than this cursor"
        // More efficient than offset — works correctly even when new
        // sessions are added between pages
        if (cursor) {
            query.createdAt = { $lt: new Date(cursor) };
        }

        // Full-text search — uses MongoDB text index on title + transcript
        // When searching, add $text query and score-based sorting
        let sessions;
        if (search?.trim()) {
            sessions = await Session.find(
                {
                    ...query,
                    $text: { $search: search.trim() },
                },
                {
                    score: { $meta: "textScore" }, // relevance score
                    // Only return fields needed for dashboard card
                    sessionId: 1,
                    title: 1,
                    status: 1,
                    "input.source": 1,
                    "input.duration": 1,
                    "transcript.wordCount": 1,
                    "transcript.language": 1,
                    "cache.summary": 1,
                    "cache.actionItems": 1,
                    createdAt: 1,
                }
            )
            .sort({ score: { $meta: "textScore" }, createdAt: -1 })
            .limit(pageSize + 1); // fetch one extra to check if next page exists
        } else {
            sessions = await Session.find(query)
            .select("sessionId title status input.source input.duration transcript.wordCount transcript.language cache.summary cache.actionItems createdAt")
            .sort({ createdAt: -1 })
            .limit(pageSize + 1);
        }

        // Check if there's a next page
        const hasNextPage = sessions.length > pageSize;
        if (hasNextPage) sessions.pop(); // remove the extra one

        // Next cursor = createdAt of last item
        const nextCursor = hasNextPage
            ? sessions[sessions.length - 1].createdAt.toISOString()
            : null;

        res.json({
            sessions: sessions.map(s => ({
                sessionId: s.sessionId,
                title: s.title,
                status: s.status,
                source: s.input?.source,
                duration: s.input?.duration,
                wordCount: s.transcript?.wordCount,
                language: s.transcript?.language,
                summary: s.cache?.summary || null,
                actionItemCount: s.cache?.actionItems?.length || 0,
                createdAt: s.createdAt,
            })),
            pagination: {
                hasNextPage,
                nextCursor,
                pageSize,
            },
        });

    } catch (err) {
        logger.error({ err: err.message }, "Get sessions failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};

/**
 * DELETE /api/sessions/:sessionId
 * Delete a session — only if owned by requester.
 */
export const deleteSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        const session = await Session.findOne({ sessionId });

        if (!session || session.ownerToken !== req.ownerToken) {
            return res.status(404).json({ message: "Session not found" });
        }

        await Session.deleteOne({ sessionId });
        res.json({ message: "Session deleted", sessionId });

    } catch (err) {
        logger.error({ err: err.message }, "Delete session failed");
        res.status(500).json({ message: "Something went wrong." });
    }
};