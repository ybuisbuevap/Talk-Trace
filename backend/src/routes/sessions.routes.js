import express from "express";
import { getSessions, deleteSession } from "../controllers/sessions.controller.js";

const router = express.Router();

router.get("/", getSessions);
router.delete("/:sessionId", deleteSession);

export default router;