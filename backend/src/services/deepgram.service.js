import { createClient } from "@deepgram/sdk";
import fs from "fs";
import logger from "../utils/logger.js";

const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

/**
 * transcribeFile — transcribe an audio/video file using Deepgram.
 * filePath: absolute path to audio file on disk
 * Returns: { fullText, segments, language, duration }
 */
export const transcribeFile = async (filePath) => {
    logger.info({ filePath }, "Starting Deepgram transcription");
    const start = Date.now();

    const audioBuffer = fs.readFileSync(filePath);

    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
            model: "nova-2",
            language: "en-IN",       // Indian English
            smart_format: true,       // punctuation + formatting
            diarize: true,            // speaker labels
            utterances: true,         // sentence-level segments
            punctuate: true,
        }
    );

    if (error) {
        logger.error({ error }, "Deepgram transcription error");
        throw new Error(`Deepgram error: ${error.message}`);
    }

    const channel = result.results?.channels?.[0];
    const alternative = channel?.alternatives?.[0];

    if (!alternative) {
        throw new Error("Deepgram returned no transcription result");
    }

    // Build full text
    const fullText = alternative.transcript || "";

    // Build segments from utterances (sentence level with speaker + timestamps)
    const utterances = result.results?.utterances || [];
    const segments = utterances.map(u => ({
        text: u.transcript,
        speaker: `Speaker ${u.speaker ?? 0}`,
        start: u.start,
        end: u.end,
    }));

    // Detect language from transcript
    const language = detectLanguage(fullText);

    // Duration from metadata
    const duration = result.metadata?.duration ?? null;

    logger.info({
        wordCount: fullText.split(/\s+/).length,
        segments: segments.length,
        durationMs: Date.now() - start,
        language,
    }, "Deepgram transcription complete");

    return { fullText, segments, language, duration };
};

/**
 * detectLanguage — detect if transcript is English, Hindi, or Mixed.
 * Uses common Hindi words written in Latin script (Deepgram romanizes Hindi).
 */
const detectLanguage = (text) => {
    if (!text || text.trim().length === 0) return "en";

    const hindiMarkers = [
        "aur", "hai", "hain", "nahi", "kya", "yeh", "woh",
        "main", "mujhe", "humara", "lekin", "kyunki", "bahut",
        "thoda", "abhi", "theek", "hoga", "karo", "baat",
        "accha", "bilkul", "matlab", "suno", "dekho", "phir",
        "toh", "agar", "isliye", "matlab", "samajh"
    ];

    const words = text.toLowerCase().split(/\s+/);
    const total = words.length;
    if (total === 0) return "en";

    const hindiCount = words.filter(w =>
        hindiMarkers.includes(w.replace(/[^a-z]/g, ""))
    ).length;

    const ratio = hindiCount / total;
    if (ratio > 0.3) return "hi";
    if (ratio > 0.1) return "mixed";
    return "en";
};
