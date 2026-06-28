import express from "express";
import multer from "multer";
import { uploadFile, getStatus, streamProgress } from "../controllers/upload.controller.js";

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB max
    fileFilter: (req, file, cb) => {
        const allowed = [
            "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg",
            "audio/mp4", "video/mp4", "video/webm", "audio/webm",
            "audio/x-m4a", "audio/m4a"
        ];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Unsupported file type: ${file.mimetype}`));
        }
    },
});

router.post("/", upload.single("file"), uploadFile);
router.get("/status/:sessionId", getStatus);
router.get("/progress/:sessionId", streamProgress); // SSE endpoint
export default router;