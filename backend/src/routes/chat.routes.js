import express from "express";
import {
    chatWithAgent,
    getSession,
    summarizeSession,
    toggleActionItem,
} from "../controllers/chat.controller.js";

const router = express.Router();

router.post("/", chatWithAgent);
router.get("/:sessionId", getSession);
router.post("/:sessionId/summarize", summarizeSession);
router.patch("/:sessionId/action-items/:itemId", toggleActionItem);

export default router;
