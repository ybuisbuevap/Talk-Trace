/**
 * chunker.service.js
 * Splits Deepgram segments into RAG-ready chunks.
 * Strategy: speaker-turn based + 150 word max cap.
 * 
 * Why speaker-turn chunking?
 * Keeps one person's complete thought together.
 * Better than flat word-count chunking which splits mid-sentence.
 * 
 * Why 150 word cap?
 * A single speaker can talk for 10+ minutes uninterrupted.
 * One giant chunk = diluted embedding = poor retrieval.
 * 150 words ≈ 1 minute of speech = good semantic density.
 */

const MAX_CHUNK_WORDS = 150;

/**
 * chunkSegments — convert Deepgram segments into embedding-ready chunks.
 * segments: [{ text, speaker, start, end }]
 * Returns: [{ text, speaker, start, end, wordCount }]
 */
export const chunkSegments = (segments) => {
    if (!segments || segments.length === 0) return [];

    const chunks = [];
    let currentChunk = null;

    for (const seg of segments) {
        const currentWordCount = currentChunk
            ? currentChunk.text.split(/\s+/).length
            : 0;

        const shouldStartNew =
            !currentChunk ||                              // first segment
            currentChunk.speaker !== seg.speaker ||       // speaker changed
            currentWordCount >= MAX_CHUNK_WORDS;          // chunk too long

        if (shouldStartNew) {
            // Save previous chunk
            if (currentChunk) {
                chunks.push({
                    ...currentChunk,
                    wordCount: currentChunk.text.split(/\s+/).length,
                });
            }
            // Start new chunk
            currentChunk = {
                text: seg.text,
                speaker: seg.speaker,
                start: seg.start,
                end: seg.end,
            };
        } else {
            // Append to current chunk
            currentChunk.text += " " + seg.text;
            currentChunk.end = seg.end;
        }
    }

    // Don't forget the last chunk
    if (currentChunk) {
        chunks.push({
            ...currentChunk,
            wordCount: currentChunk.text.split(/\s+/).length,
        });
    }

    return chunks;
};

/**
 * generateTitle — auto generate meeting title from first 2 lines.
 */
export const generateTitle = (fullText) => {
    if (!fullText) return "Untitled Meeting";
    const firstLine = fullText
        .split(/[\n.!?]/)
        .find(l => l.trim().length > 10);
    return firstLine
        ? firstLine.trim().slice(0, 80)
        : "Untitled Meeting";
};
