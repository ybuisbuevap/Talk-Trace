import express from "express";
import { exportPDF, exportMarkdown } from "../controllers/export.controller.js";

const router = express.Router();

router.get("/:sessionId/pdf", exportPDF);
router.get("/:sessionId/markdown", exportMarkdown);

export default router;