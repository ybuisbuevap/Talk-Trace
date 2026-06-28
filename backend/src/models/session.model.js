import mongoose, { Schema } from "mongoose";
import crypto from "crypto";

// --- Sub schemas ---

const segmentSchema = new Schema({
    text: { type: String, required: true },
    speaker: { type: String, default: "Speaker 0" },
    start: { type: Number, default: 0 },  // seconds
    end: { type: Number, default: 0 },
}, { _id: false });

const chunkSchema = new Schema({
    text: { type: String, required: true },
    speaker: { type: String, default: "Speaker 0" },
    start: { type: Number, default: 0 },
    end: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
    embedding: { type: [Number], default: [] }, // 384-dim vector (all-MiniLM-L6-v2)
}, { _id: true });

const actionItemSchema = new Schema({
    task: { type: String, required: true },
    assignedTo: { type: String, default: null },
    dueDate: { type: String, default: null },
    status: { type: String, enum: ["pending", "done"], default: "pending" },
}, { _id: true });

const conversationTurnSchema = new Schema({
    role: { type: String, enum: ["human", "ai"], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
}, { _id: false });

// --- Main schema ---

const sessionSchema = new Schema({
    sessionId: { type: String, required: true, unique: true, index: true },
    ownerToken: { type: String, required: true, index: true }, // httpOnly cookie value
    title: { type: String, default: "Untitled Meeting" },

    input: {
        type: { type: String, enum: ["file", "youtube"], default: "file" },
        source: { type: String, default: null }, // filename or YouTube URL
        duration: { type: Number, default: null }, // seconds
        mimeType: { type: String, default: null },
    },

    transcript: {
        fullText: { type: String, default: "" },
        wordCount: { type: Number, default: 0 },
        language: { type: String, enum: ["en", "hi", "mixed"], default: "en" },
        segments: { type: [segmentSchema], default: [] }, // raw Deepgram output
        generatedAt: { type: Date, default: null },
    },

    // Chunks used for RAG — speaker-turn based with 150 word cap
    chunks: { type: [chunkSchema], default: [] },

    // MD5 hash of fullText — used for cache invalidation per field
    transcriptHash: { type: String, default: null },

    // Cached AI outputs — only valid when *Hash === transcriptHash
    cache: {
        summary: { type: String, default: null },
        summaryHash: { type: String, default: null },

        actionItems: { type: [actionItemSchema], default: [] },
        actionItemsHash: { type: String, default: null },

        keyDecisions: { type: [String], default: [] },
        keyDecisionsHash: { type: String, default: null },
    },

    // Conversation history — persisted in MongoDB, not in-memory
    // Capped at 100 turns at write time to prevent unbounded growth
    conversationHistory: {
        type: [conversationTurnSchema],
        default: [],
    },

    status: {
        type: String,
        enum: ["uploading", "transcribing", "embedding", "ready", "failed"],
        default: "uploading",
        index: true,
    },

    errorMessage: { type: String, default: null },

}, { timestamps: true, versionKey: false });

// --- Indexes ---
// Text index for search across titles and transcripts
sessionSchema.index({
    title: "text",
    "transcript.fullText": "text",
}, {
    weights: { title: 10, "transcript.fullText": 1 },
    name: "talktrace_text_search",
});

// Compound index for dashboard — owner + newest first
sessionSchema.index({ ownerToken: 1, createdAt: -1 });

// --- Instance methods ---

// Check if a specific cache field is valid for current transcript
sessionSchema.methods.isCacheValid = function (field) {
    return this.cache[`${field}Hash`] === this.transcriptHash;
};

// Invalidate all cache fields — called when transcript changes
sessionSchema.methods.invalidateCache = function () {
    this.cache.summaryHash = null;
    this.cache.actionItemsHash = null;
    this.cache.keyDecisionsHash = null;
};

// Add a conversation turn — enforces 100 turn cap at write time
sessionSchema.methods.addConversationTurns = function (humanContent, aiContent) {
    this.conversationHistory.push(
        { role: "human", content: humanContent, timestamp: new Date() },
        { role: "ai", content: aiContent, timestamp: new Date() }
    );
    // Cap at 100 turns — trim oldest first
    if (this.conversationHistory.length > 100) {
        this.conversationHistory = this.conversationHistory.slice(-100);
    }
};

// Get last N turns for LangChain MessagesPlaceholder
sessionSchema.methods.getRecentHistory = function (n = 10) {
    return this.conversationHistory.slice(-n);
};

// Generate transcript hash
sessionSchema.statics.hashText = function (text) {
    return crypto.createHash("md5").update(text).digest("hex");
};

const Session = mongoose.model("Session", sessionSchema);
export { Session };