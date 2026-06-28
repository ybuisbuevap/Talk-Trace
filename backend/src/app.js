import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import uploadRoutes from "./routes/upload.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import sessionsRoutes from "./routes/sessions.routes.js";
import exportRoutes from "./routes/export.routes.js";
import cookieParser from "cookie-parser";
import { initEmbedder } from "./services/embedder.service.js";
import { ownerMiddleware } from "./middleware/owner.middleware.js";
import { initAgenda } from "./services/agenda.service.js";
import logger from "./utils/logger.js";

const app = express();

app.use(cors({
    origin: (origin, callback) => {
        const allowed = [
            "http://localhost:5173",
            "http://localhost:3000",
            process.env.FRONTEND_URL,
        ].filter(Boolean);
        // Allow requests with no origin (mobile apps, curl) or matching origins
        if (!origin || allowed.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    credentials: true, // required for cookies to be sent cross-origin
}));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());      // parse cookies from request headers
app.use(ownerMiddleware);     // generate/attach ownerToken on every request

// Routes
app.use("/api/upload", uploadRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/export", exportRoutes);

// Health check
app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        mongo: mongoose.connection.readyState === 1 ? "connected" : "disconnected",
        uptime: Math.floor(process.uptime()),
    });
});

// Debug — check cookie received
app.get("/api/debug/cookie", (req, res) => {
    res.json({
        ownerToken: req.ownerToken ? req.ownerToken.slice(0, 8) + "..." : null,
        cookieReceived: !!req.cookies?.talktrace_owner,
        allCookies: Object.keys(req.cookies || {}),
    });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error({ err: err.message, path: req.path }, "Unhandled error");
    if (res.headersSent) return next(err);
    if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ message: "File too large. Maximum 100MB." });
    }
    res.status(500).json({ message: err.message || "Something went wrong." });
});

const start = async () => {
    try {
        // Step 1 — Connect MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info({ host: mongoose.connection.host }, "MongoDB connected");

        // Step 2 — Load embedding model before accepting requests
        await initEmbedder();

        // Step 3 — Start Agenda job queue
        // Uses same MongoDB connection — no extra infrastructure
        await initAgenda();

        // Step 4 — Start server
        const PORT = process.env.PORT || 8000;
        app.listen(PORT, () => {
            logger.info({ PORT }, "Server ready — accepting requests");
        });

    } catch (err) {
        logger.error({ err: err.message }, "Startup failed");
        process.exit(1);
    }
};

process.on("unhandledRejection", (reason) => {
    logger.error({ reason: String(reason) }, "Unhandled rejection");
    process.exit(1);
});

process.on("uncaughtException", (err) => {
    logger.error({ err: err.message }, "Uncaught exception");
    process.exit(1);
});

start();