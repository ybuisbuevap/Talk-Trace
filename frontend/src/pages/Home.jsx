import { useState, useRef, useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { uploadFile, getStatus } from "../utils/api.js";

const HERO_WORD = "TALKTRACE";

const STAGE_LABELS = {
    uploading:    "Uploading file...",
    transcribing: "Transcribing audio with Deepgram...",
    embedding:    "Generating embeddings...",
    ready:        "Ready — opening...",
    failed:       "Processing failed",
};

const STAGE_STEPS = {
    uploading: 0, transcribing: 1, embedding: 2, ready: 3, failed: 0,
};

export default function Home() {
    const navigate = useNavigate();
    const inputRef = useRef(null);
    const eventSourceRef = useRef(null);
    const fallbackPollRef = useRef(null);

    const [dragOver, setDragOver] = useState(false);
    const [file, setFile] = useState(null);
    const [processing, setProcessing] = useState(false);
    const [stage, setStage] = useState(null);
    const [error, setError] = useState(null);
    const [charsRevealed, setCharsRevealed] = useState(0);

    // Letter-by-letter hero reveal
    useEffect(() => {
        let i = 0;
        const interval = setInterval(() => {
            i++;
            setCharsRevealed(i);
            if (i >= HERO_WORD.length) clearInterval(interval);
        }, 80);
        return () => clearInterval(interval);
    }, []);

    const handleFile = useCallback((f) => {
        if (!f) return;
        setFile(f);
        setError(null);
    }, []);

    const onDrop = (e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files[0]);
    };

    // Cleanup SSE connection
    const closeSSE = () => {
        if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
        }
        if (fallbackPollRef.current) {
            clearInterval(fallbackPollRef.current);
            fallbackPollRef.current = null;
        }
    };

    // Connect SSE for progress updates
    const connectSSE = (sessionId) => {
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";
        const es = new EventSource(`${API_BASE}/api/upload/progress/${sessionId}`);
        eventSourceRef.current = es;

        es.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                setStage(data.stage);

                if (data.stage === "ready") {
                    closeSSE();
                    setTimeout(() => navigate(`/chat/${sessionId}`), 1500);
                }
                if (data.stage === "failed") {
                    closeSSE();
                    setProcessing(false);
                    setError(data.error || "Processing failed. Please try again.");
                }
            } catch {}
        };

        es.onerror = () => {
            // SSE failed — fall back to polling
            closeSSE();
            startFallbackPoll(sessionId);
        };
    };

    // Fallback polling if SSE fails
    const startFallbackPoll = (sessionId) => {
        fallbackPollRef.current = setInterval(async () => {
            try {
                const data = await getStatus(sessionId);
                setStage(data.status);
                if (data.status === "ready") {
                    clearInterval(fallbackPollRef.current);
                    setTimeout(() => navigate(`/chat/${sessionId}`), 1500);
                }
                if (data.status === "failed") {
                    clearInterval(fallbackPollRef.current);
                    setProcessing(false);
                    setError(data.errorMessage || "Processing failed.");
                }
            } catch {
                clearInterval(fallbackPollRef.current);
                setProcessing(false);
                setError("Connection lost. Please refresh.");
            }
        }, 2000);
    };

    const handleUpload = async () => {
        if (!file) return;
        setError(null);
        setProcessing(true);
        setStage("uploading");

        try {
            const { sessionId } = await uploadFile(file);
            setStage("transcribing");
            connectSSE(sessionId);
        } catch (err) {
            setProcessing(false);
            setStage(null);
            setError(err.response?.data?.message || "Upload failed. Please try again.");
        }
    };

    // Cleanup on unmount
    useEffect(() => () => closeSSE(), []);

    const stepsDone = STAGE_STEPS[stage] || 0;

    return (
        <div style={s.page}>
            {/* Nav */}
            <nav style={s.nav}>
                <div style={s.logo}>TalkTrace</div>
                <div style={s.navRight}>
                    <button style={s.navLink} onClick={() => navigate("/sessions")}>My Sessions</button>
                    <span style={s.navTag}>Audio · Video · AI</span>
                </div>
            </nav>

            {/* Hero */}
            <section style={s.hero}>
                <div style={s.heroLeft}>
                    <h1 style={s.heroWord} aria-label="TalkTrace">
                        {HERO_WORD.split("").map((char, i) => (
                            <span key={i} style={{
                                ...s.heroChar,
                                opacity: i < charsRevealed ? 1 : 0,
                                transform: i < charsRevealed ? "translateY(0)" : "translateY(24px)",
                                transition: "opacity 0.4s ease, transform 0.4s ease",
                            }}>
                                {char}
                            </span>
                        ))}
                    </h1>
                    <div style={s.heroSub}>
                        <p style={s.heroDesc}>
                            Any audio or video. Transcribed,<br />
                            searchable, queryable.
                        </p>
                    </div>
                </div>

                <div style={s.heroRight}>
                    {["Upload", "Transcribe", "Ask"].map((label, i) => (
                        <div key={label} style={s.heroIndex}>
                            <span style={s.indexNum}>0{i + 1}</span>
                            <span style={s.indexLine} />
                            <span style={s.indexLabel}>{label}</span>
                        </div>
                    ))}
                </div>
            </section>

            <div style={s.divider} />

            {/* Upload section */}
            <section style={s.uploadSection}>
                <div style={s.uploadLeft}>
                    <span style={s.sectionEyebrow}>— Begin</span>
                    <p style={s.uploadGuide}>
                        Drop any audio or video.<br />
                        We handle the rest.
                    </p>
                    <p style={s.uploadFormats}>
                        MP3 · MP4 · WAV · OGG · WebM · M4A
                    </p>
                </div>

                <div style={s.uploadRight}>
                    {!processing ? (
                        <>
                            <div
                                style={{
                                    ...s.dropzone,
                                    ...(dragOver ? s.dropzoneActive : {}),
                                    ...(file ? s.dropzoneHasFile : {}),
                                }}
                                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={onDrop}
                                onClick={() => inputRef.current?.click()}
                            >
                                <input
                                    ref={inputRef}
                                    type="file"
                                    accept="audio/*,video/*"
                                    style={{ display: "none" }}
                                    onChange={(e) => handleFile(e.target.files[0])}
                                />
                                {file ? (
                                    <div style={s.fileReady}>
                                        <span style={s.fileReadyDot} />
                                        <span style={s.fileReadyName}>{file.name}</span>
                                        <span style={s.fileReadySize}>
                                            {(file.size / 1024 / 1024).toFixed(1)} MB
                                        </span>
                                    </div>
                                ) : (
                                    <div style={s.dropPrompt}>
                                        <span style={s.dropArrow}>↑</span>
                                        <span style={s.dropText}>
                                            {dragOver ? "Release to upload" : "Drop audio or video file"}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {error && <p style={s.error}>{error}</p>}

                            <button
                                style={{
                                    ...s.uploadBtn,
                                    ...(!file ? s.uploadBtnOff : {}),
                                }}
                                onClick={handleUpload}
                                disabled={!file}
                            >
                                {file ? "Analyse →" : "Select a file first"}
                            </button>
                        </>
                    ) : (
                        <div style={s.processingBlock}>
                            <div style={s.processingTop}>
                                <div style={s.spinner} />
                                <span style={s.processingStatus}>
                                    {STAGE_LABELS[stage] || "Processing..."}
                                </span>
                            </div>

                            {/* SSE-driven progress steps */}
                            <div style={s.steps}>
                                {["Transcribe", "Embed", "Ready"].map((label, i) => {
                                    const done = stepsDone > i;
                                    const active = stepsDone === i + 1;
                                    return (
                                        <div key={label} style={s.stepRow}>
                                            <span style={{
                                                ...s.stepNum,
                                                color: done ? "#F0F0F0" : active ? "#7B6EF6" : "#7A7A7A",
                                            }}>
                                                {String(i + 1).padStart(2, "0")}
                                            </span>
                                            <span style={{
                                                ...s.stepLabel,
                                                color: done ? "#F0F0F0" : active ? "#A89BF8" : "#7A7A7A",
                                            }}>
                                                {done ? `${label} ✓` : label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* SSE indicator */}
                            <div style={s.sseIndicator}>
                                <span style={s.sseDot} />
                                <span style={s.sseLabel}>Live updates via SSE</span>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            <footer style={s.footer}>
                <span style={s.footerLeft}>TalkTrace</span>
                <span style={s.footerRight}>Deepgram · ONNX · Mistral · Agenda</span>
            </footer>
        </div>
    );
}

const s = {
    page: {
        minHeight: "100vh",
        background: "#080808",
        display: "flex",
        flexDirection: "column",
        padding: "0 3rem",
    },
    nav: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "2rem 0",
        borderBottom: "1px solid #1C1C1C",
    },
    logo: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontWeight: 900,
        fontSize: "1.1rem",
        color: "#F0F0F0",
        letterSpacing: "0.05em",
    },
    navRight: {
        display: "flex",
        alignItems: "center",
        gap: "2rem",
    },
    navLink: {
        fontSize: "0.87rem",
        color: "#F0F0F0",
        fontFamily: "'DM Sans', sans-serif",
        letterSpacing: "0.04em",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        transition: "color 0.2s",
    },
    navTag: {
        fontSize: "0.85rem",
        color: "#A0A0A0",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        fontFamily: "'DM Sans', sans-serif",
    },
    hero: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-end",
        padding: "5rem 0 4rem",
        gap: "2rem",
    },
    heroLeft: { flex: 1 },
    heroWord: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "clamp(5rem, 12vw, 10rem)",
        fontWeight: 900,
        lineHeight: 0.9,
        color: "#F0F0F0",
        letterSpacing: "-0.03em",
        display: "flex",
        gap: "0.02em",
        marginBottom: "2.5rem",
    },
    heroChar: { display: "inline-block" },
    heroSub: { maxWidth: "380px" },
    heroDesc: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "1.1rem",
        color: "#A0A0A0",
        lineHeight: 1.7,
        fontWeight: 300,
    },
    heroRight: {
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        paddingBottom: "0.5rem",
    },
    heroIndex: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
    },
    indexNum: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.85rem",
        color: "#7A7A7A",
        letterSpacing: "0.08em",
        minWidth: "24px",
    },
    indexLine: {
        display: "block",
        width: "40px",
        height: "1px",
        background: "#2E2E2E",
    },
    indexLabel: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.85rem",
        color: "#A0A0A0",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
    },
    divider: { height: "1px", background: "#1C1C1C" },
    uploadSection: {
        display: "flex",
        gap: "6rem",
        padding: "5rem 0",
        flex: 1,
        alignItems: "flex-start",
    },
    uploadLeft: {
        width: "280px",
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
    },
    sectionEyebrow: {
        fontSize: "0.85rem",
        color: "#7A7A7A",
        letterSpacing: "0.1em",
        fontFamily: "'DM Sans', sans-serif",
    },
    uploadGuide: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "1.6rem",
        fontWeight: 400,
        lineHeight: 1.4,
        color: "#F0F0F0",
        fontStyle: "italic",
    },
    uploadFormats: {
        fontSize: "0.85rem",
        color: "#7A7A7A",
        letterSpacing: "0.06em",
        fontFamily: "'DM Sans', sans-serif",
    },
    uploadRight: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        gap: "1.25rem",
        maxWidth: "520px",
    },
    dropzone: {
        border: "1px solid #2E2E2E",
        borderRadius: "2px",
        padding: "3rem 2rem",
        cursor: "pointer",
        transition: "all 0.2s ease",
        background: "transparent",
        textAlign: "center",
    },
    dropzoneActive: { borderColor: "#F0F0F0", background: "#111111" },
    dropzoneHasFile: { borderColor: "#4ADE80", borderStyle: "solid" },
    dropPrompt: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
    },
    dropArrow: { fontSize: "1.5rem", color: "#7A7A7A", display: "block" },
    dropText: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.95rem",
        color: "#A0A0A0",
        letterSpacing: "0.04em",
    },
    fileReady: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
    },
    fileReadyDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "#4ADE80",
        flexShrink: 0,
        display: "block",
    },
    fileReadyName: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.95rem",
        color: "#F0F0F0",
    },
    fileReadySize: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.85rem",
        color: "#A0A0A0",
    },
    error: {
        fontSize: "0.9rem",
        color: "#F87171",
        fontFamily: "'DM Sans', sans-serif",
    },
    uploadBtn: {
        background: "#F0F0F0",
        color: "#080808",
        border: "none",
        borderRadius: "2px",
        padding: "0.9rem 2rem",
        fontSize: "0.95rem",
        fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
        letterSpacing: "0.04em",
        cursor: "pointer",
        transition: "background 0.2s ease",
        alignSelf: "flex-start",
    },
    uploadBtnOff: {
        background: "#1C1C1C",
        color: "#7A7A7A",
        cursor: "not-allowed",
    },
    processingBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "2rem",
        padding: "2.5rem",
        border: "1px solid #1C1C1C",
        borderRadius: "2px",
    },
    processingTop: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
    },
    spinner: {
        width: "14px",
        height: "14px",
        border: "1.5px solid #2E2E2E",
        borderTopColor: "#7B6EF6",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        flexShrink: 0,
    },
    processingStatus: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.95rem",
        color: "#A0A0A0",
    },
    steps: {
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
    },
    stepRow: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
    },
    stepNum: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.78rem",
        letterSpacing: "0.08em",
        minWidth: "24px",
        transition: "color 0.3s ease",
    },
    stepLabel: {
        fontFamily: "'DM Sans', sans-serif",
        fontSize: "0.9rem",
        letterSpacing: "0.06em",
        transition: "color 0.3s ease",
    },
    sseIndicator: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        marginTop: "0.5rem",
    },
    sseDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        background: "#4ADE80",
        display: "block",
        animation: "pulse 1.5s ease-in-out infinite",
    },
    sseLabel: {
        fontSize: "0.78rem",
        color: "#7A7A7A",
        fontFamily: "'DM Sans', sans-serif",
        letterSpacing: "0.04em",
    },
    footer: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1.5rem 0",
        borderTop: "1px solid #1C1C1C",
        marginTop: "auto",
    },
    footerLeft: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "0.85rem",
        color: "#7A7A7A",
        fontStyle: "italic",
    },
    footerRight: {
        fontSize: "0.78rem",
        color: "#7A7A7A",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        fontFamily: "'DM Sans', sans-serif",
    },
};