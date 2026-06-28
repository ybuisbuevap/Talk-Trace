import PDFDocument from "pdfkit";
import logger from "../utils/logger.js";

/**
 * generatePDF — creates a PDF buffer from session data.
 * Returns a Buffer ready to stream to client.
 */
export const generatePDF = (session) => {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({
                margin: 60,
                size: "A4",
                bufferPages: true, // required for going back to add footers
                info: {
                    Title: session.title || "TalkTrace Export",
                    Author: "TalkTrace AI Knowledge Agent",
                    Creator: "TalkTrace",
                },
            });

            const chunks = [];
            doc.on("data", chunk => chunks.push(chunk));
            doc.on("end", () => resolve(Buffer.concat(chunks)));
            doc.on("error", reject);

            const W = doc.page.width - 120; // usable width

            // ── Header ──
            doc
                .fontSize(28)
                .font("Helvetica-Bold")
                .fillColor("#0A0A0F")
                .text("TalkTrace", 60, 60);

            doc
                .fontSize(9)
                .font("Helvetica")
                .fillColor("#6B6B80")
                .text("AI Knowledge Agent Export", 60, 96);

            // Divider
            doc
                .moveTo(60, 115)
                .lineTo(doc.page.width - 60, 115)
                .strokeColor("#E0E0E0")
                .lineWidth(0.5)
                .stroke();

            doc.moveDown(1.5);

            // ── Title ──
            doc
                .fontSize(18)
                .font("Helvetica-Bold")
                .fillColor("#0A0A0F")
                .text(session.title || "Untitled", 60, doc.y, { width: W });

            // Meta
            const meta = [
                session.transcript?.wordCount && `${session.transcript.wordCount.toLocaleString()} words`,
                session.input?.duration && `${Math.round(session.input.duration / 60)} min`,
                session.transcript?.language && `Language: ${session.transcript.language.toUpperCase()}`,
                new Date(session.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric", month: "long", year: "numeric"
                }),
            ].filter(Boolean).join("  ·  ");

            doc
                .fontSize(9)
                .font("Helvetica")
                .fillColor("#6B6B80")
                .text(meta, 60, doc.y + 6, { width: W });

            doc.moveDown(1.5);

            // ── Summary ──
            if (session.cache?.summary) {
                sectionHeader(doc, "Summary");
                doc
                    .fontSize(10.5)
                    .font("Helvetica")
                    .fillColor("#1A1A2E")
                    .text(session.cache.summary, 60, doc.y, {
                        width: W,
                        lineGap: 4,
                    });
                doc.moveDown(1.5);
            }

            // ── Key Decisions ──
            const decisions = session.cache?.keyDecisions || [];
            if (decisions.length > 0) {
                sectionHeader(doc, "Key Decisions");
                decisions.forEach((decision, i) => {
                    doc
                        .fontSize(10.5)
                        .font("Helvetica")
                        .fillColor("#1A1A2E")
                        .text(`${i + 1}.  ${decision}`, 60, doc.y, {
                            width: W,
                            lineGap: 3,
                        });
                    doc.moveDown(0.4);
                });
                doc.moveDown(1);
            }

            // ── Action Items ──
            const actionItems = session.cache?.actionItems || [];
            if (actionItems.length > 0) {
                sectionHeader(doc, "Action Items");
                actionItems.forEach((item) => {
                    const status = item.status === "done" ? "[done]" : "[  ]";
                    const assignee = item.assignedTo ? `  — ${item.assignedTo}` : "";
                    const taskLine = `${status}  ${item.task}${assignee}`;

                    doc
                        .fontSize(10.5)
                        .font("Helvetica")
                        .fillColor(item.status === "done" ? "#9A9A9A" : "#1A1A2E")
                        .text(taskLine, 60, doc.y, {
                            width: W,
                            lineGap: 3,
                        });

                    doc.moveDown(0.5);
                });
                doc.moveDown(1);
            }

            // ── Transcript ──
            if (session.transcript?.fullText) {
                sectionHeader(doc, "Full Transcript");
                doc
                    .fontSize(9.5)
                    .font("Helvetica")
                    .fillColor("#3A3A4A")
                    .text(session.transcript.fullText, 60, doc.y, {
                        width: W,
                        lineGap: 3,
                    });
                doc.moveDown(1.5);
            }

            // ── Footer on each page ──
            // We use doc.on('pageAdded') pattern — track total pages ourselves
            // then go back and fill footers after all content is written
            const totalPages = doc.bufferedPageRange().count;
            for (let i = 0; i < totalPages; i++) {
                doc.switchToPage(i);
                doc
                    .fontSize(8)
                    .font("Helvetica")
                    .fillColor("#B0B0B0")
                    .text(
                        `TalkTrace AI Knowledge Agent  ·  Page ${i + 1} of ${totalPages}`,
                        60,
                        doc.page.height - 40,
                        { width: W, align: "center" }
                    );
            }

            doc.end();

        } catch (err) {
            logger.error({ err: err.message }, "PDF generation failed");
            reject(err);
        }
    });
};

/**
 * generateMarkdown — creates markdown string from session data.
 */
export const generateMarkdown = (session) => {
    const lines = [];
    const date = new Date(session.createdAt).toLocaleDateString("en-IN", {
        day: "numeric", month: "long", year: "numeric"
    });

    lines.push(`# ${session.title || "Untitled"}`);
    lines.push(`*Exported from TalkTrace AI Knowledge Agent · ${date}*`);
    lines.push("");

    const meta = [
        session.transcript?.wordCount && `**Words:** ${session.transcript.wordCount.toLocaleString()}`,
        session.input?.duration && `**Duration:** ${Math.round(session.input.duration / 60)} min`,
        session.transcript?.language && `**Language:** ${session.transcript.language.toUpperCase()}`,
    ].filter(Boolean);

    if (meta.length) {
        lines.push(meta.join("  |  "));
        lines.push("");
    }

    if (session.cache?.summary) {
        lines.push("## Summary");
        lines.push(session.cache.summary);
        lines.push("");
    }

    const decisions = session.cache?.keyDecisions || [];
    if (decisions.length > 0) {
        lines.push("## Key Decisions");
        decisions.forEach((d, i) => lines.push(`${i + 1}. ${d}`));
        lines.push("");
    }

    const actionItems = session.cache?.actionItems || [];
    if (actionItems.length > 0) {
        lines.push("## Action Items");
        actionItems.forEach(item => {
            const check = item.status === "done" ? "[x]" : "[ ]";
            const assignee = item.assignedTo ? ` *(${item.assignedTo})*` : "";
            lines.push(`- ${check} ${item.task}${assignee}`);
        });
        lines.push("");
    }

    if (session.transcript?.fullText) {
        lines.push("## Full Transcript");
        lines.push("```");
        lines.push(session.transcript.fullText);
        lines.push("```");
        lines.push("");
    }

    lines.push("---");
    lines.push("*Generated by [TalkTrace](https://github.com/talktrace-ai)*");

    return lines.join("\n");
};

// Helper — draws a section header with underline
const sectionHeader = (doc, title) => {
    doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#0A0A0F")
        .text(title.toUpperCase(), 60, doc.y, {
            characterSpacing: 1.5,
        });

    doc
        .moveTo(60, doc.y + 3)
        .lineTo(doc.page.width - 60, doc.y + 3)
        .strokeColor("#E8E8E8")
        .lineWidth(0.5)
        .stroke();

    doc.moveDown(0.8);
};