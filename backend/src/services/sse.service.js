/**
 * sse.service.js — Server-Sent Events manager.
 *
 * Why SSE over Socket.IO here:
 * The processing pipeline only sends data one way: server → client.
 * SSE is the correct, simpler tool for this — plain HTTP, no library,
 * native browser EventSource API.
 *
 * SSE vs WebSocket:
 * WebSocket = bidirectional (used in Callify for signaling)
 * SSE = server → client only (correct for pipeline progress)
 */

// Map of sessionId → Set of response objects
// Multiple browser tabs can listen to the same session
const clients = new Map();

/**
 * SSEManager — manages all active SSE connections.
 */
export const sseManager = {
    /**
     * add — register a new client connection for a session.
     * Called when frontend opens EventSource connection.
     */
    add(sessionId, res) {
        if (!clients.has(sessionId)) {
            clients.set(sessionId, new Set());
        }
        clients.get(sessionId).add(res);
        logger.debug({ sessionId, total: clients.get(sessionId).size }, "SSE client added");
    },

    /**
     * remove — clean up when client disconnects.
     */
    remove(sessionId, res) {
        const sessionClients = clients.get(sessionId);
        if (!sessionClients) return;
        sessionClients.delete(res);
        if (sessionClients.size === 0) clients.delete(sessionId);
        logger.debug({ sessionId }, "SSE client removed");
    },

    /**
     * emit — send a pipeline stage update to all listeners for a session.
     * data: { stage, ...extraFields }
     */
    emit(sessionId, data) {
        const sessionClients = clients.get(sessionId);
        if (!sessionClients || sessionClients.size === 0) return;

        const payload = `data: ${JSON.stringify(data)}\n\n`;
        for (const res of sessionClients) {
            try {
                res.write(payload);
            } catch {
                // Client disconnected — remove silently
                sessionClients.delete(res);
            }
        }
    },

    /**
     * close — send final event and close all connections for a session.
     * Called after pipeline completes or fails.
     */
    close(sessionId) {
        const sessionClients = clients.get(sessionId);
        if (!sessionClients) return;
        for (const res of sessionClients) {
            try {
                res.write("event: close\ndata: {}\n\n");
                res.end();
            } catch {}
        }
        clients.delete(sessionId);
    },
};

// Simple logger fallback (logger may not be imported in some contexts)
const logger = {
    debug: (obj, msg) => {},
    info: (obj, msg) => console.log(JSON.stringify({ level: "info", ...obj, msg })),
};