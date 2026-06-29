import { Session } from "../models/session.model.js";
import { generatePDF, generateMarkdown } from "../services/export.service.js";
import logger from "../utils/logger.js";

/**
 * GET /api/export/:sessionId/pdf
 * Generates and streams a PDF of the session summary.
 */
export const exportPDF = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        if (session.status !== "ready") {
            return res.status(400).json({ message: "Session is not ready yet" });
        }

        logger.info({ sessionId }, "Generating PDF export");
        const pdfBuffer = await generatePDF(session);

        const filename = `talktrace-${session.title?.slice(0, 30).replace(/[^a-z0-9]/gi, "-").toLowerCase() || sessionId}.pdf`;

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.setHeader("Content-Length", pdfBuffer.length);
        res.send(pdfBuffer);

    } catch (err) {
        logger.error({ err: err.message }, "PDF export failed");
        res.status(500).json({ message: "Export failed. Please try again." });
    }
};

/**
 * GET /api/export/:sessionId/markdown
 * Returns a Markdown file of the session summary.
 */
export const exportMarkdown = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await Session.findOne({ sessionId });

        if (!session) {
            return res.status(404).json({ message: "Session not found" });
        }

        if (session.status !== "ready") {
            return res.status(400).json({ message: "Session is not ready yet" });
        }

        logger.info({ sessionId }, "Generating Markdown export");
        const markdown = generateMarkdown(session);

        const filename = `talktrace-${session.title?.slice(0, 30).replace(/[^a-z0-9]/gi, "-").toLowerCase() || sessionId}.md`;

        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(markdown);

    } catch (err) {
        logger.error({ err: err.message }, "Markdown export failed");
        res.status(500).json({ message: "Export failed. Please try again." });
    }
};