import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getSession, summarize, chat, toggleActionItem } from "../utils/api.js";

// Parse AI response — strip raw JSON, return clean text
const parseAIContent = (content) => {
    if (!content) return content;
    try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.summary) return parsed.summary;
            if (parsed.answer) return parsed.answer;
        }
    } catch {}
    return content
        .replace(/```json[\s\S]*?```/g, "")
        .replace(/^\s*\{[\s\S]*?\}\s*$/g, "")
        .trim() || content;
};

export default function Chat() {
    const { sessionId } = useParams();
    const navigate = useNavigate();
    const bottomRef = useRef(null);
    const inputRef = useRef(null);

    const [session, setSession] = useState(null);
    const [summaryData, setSummaryData] = useState(null);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [loadingSession, setLoadingSession] = useState(true);
    const [activePanel, setActivePanel] = useState("summary");
    const [error, setError] = useState(null);

    useEffect(() => {
        const load = async () => {
            try {
                const data = await getSession(sessionId);
                if (data.status !== "ready") {
                    setError("Session is still processing. Please wait and refresh.");
                    setLoadingSession(false);
                    return;
                }
                setSession(data);
                if (data.conversationHistory?.length) {
                    setMessages(data.conversationHistory.map(t => ({
                        role: t.role,
                        content: t.content,
                    })));
                }
                const sum = await summarize(sessionId);
                setSummaryData(sum);
                setSession(prev => ({
                    ...prev,
                    cache: {
                        ...prev?.cache,
                        summary: sum.summary,
                        actionItems: sum.actionItems,
                        keyDecisions: sum.keyDecisions,
                    }
                }));
            } catch {
                setError("Failed to load session.");
            } finally {
                setLoadingSession(false);
            }
        };
        load();
    }, [sessionId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const sendMessage = async () => {
        const msg = input.trim();
        if (!msg || loading) return;
        setInput("");
        setActivePanel("chat");
        setMessages(prev => [...prev, { role: "human", content: msg }]);
        setLoading(true);
        try {
            const data = await chat(sessionId, msg);
            setMessages(prev => [...prev, {
                role: "ai",
                content: data.response,
                sourceChunks: data.sourceChunks,
            }]);
        } catch {
            setMessages(prev => [...prev, {
                role: "ai",
                content: "Something went wrong. Please try again.",
                isError: true,
            }]);
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    };

    const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

    const handleExport = (format) => {
        // Direct browser download — cookies sent automatically
        window.open(`${API_BASE}/api/export/${sessionId}/${format}`, "_blank");
    };

    const handleToggle = async (itemId) => {
        try {
            const { status } = await toggleActionItem(sessionId, itemId);
            setSession(prev => ({
                ...prev,
                cache: {
                    ...prev.cache,
                    actionItems: prev.cache.actionItems.map(item =>
                        item._id === itemId ? { ...item, status } : item
                    ),
                }
            }));
        } catch {}
    };

    if (loadingSession) return <FullScreen><Spinner /><span style={s.loadingText}>Loading session</span></FullScreen>;
    if (error) return (
        <FullScreen>
            <p style={s.errorText}>{error}</p>
            <button style={s.backBtnFull} onClick={() => navigate("/")}>← Go back</button>
        </FullScreen>
    );
    if (!session) return null;

    const actionItems = session.cache?.actionItems || [];
    const keyDecisions = session.cache?.keyDecisions || [];

    return (
        <div style={s.page}>
            {/* Top bar — back only */}
            <div style={s.topBar}>
                <button style={s.backBtn} onClick={() => navigate("/")}>← Back</button>
                <span style={s.sessionInfo}>
                    {session.transcript?.wordCount?.toLocaleString()} words
                    {session.input?.duration && ` · ${Math.round(session.input.duration / 60)} min`}
                </span>
            </div>

            {/* Export buttons */}
            <div style={s.exportRow}>
                <button style={s.exportBtn} onClick={() => handleExport("pdf")}>
                    ↓ PDF
                </button>
                <button style={s.exportBtn} onClick={() => handleExport("markdown")}>
                    ↓ MD
                </button>
            </div>

            {/* Tabs */}
            <div style={s.tabs}>
                {["summary", "transcript", "chat"].map(tab => (
                    <button
                        key={tab}
                        style={{ ...s.tab, ...(activePanel === tab ? s.tabActive : {}) }}
                        onClick={() => setActivePanel(tab)}
                    >
                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                    </button>
                ))}
            </div>

            {/* Full content area — switches based on active tab */}
            <div style={s.contentArea}>
                {activePanel === "summary" && (
                    <div style={s.scrollArea}>
                        <SummaryPanel
                            summaryData={summaryData}
                            actionItems={actionItems}
                            keyDecisions={keyDecisions}
                            onToggle={handleToggle}
                        />
                    </div>
                )}

                {activePanel === "transcript" && (
                    <div style={s.scrollArea}>
                        <pre style={s.transcriptText}>
                            {session.transcript?.fullText || "No transcript available."}
                        </pre>
                    </div>
                )}

                {activePanel === "chat" && (
                    <div style={s.chatPanel}>
                        <div style={s.messages}>
                            {messages.length === 0 && (
                                <div style={s.emptyState}>
                                    <p style={s.emptyTitle}>Ask anything.</p>
                                    <p style={s.emptySubtitle}>Your content is indexed and ready.</p>
                                    <div style={s.suggestions}>
                                        {[
                                            "What were the key decisions?",
                                            "What action items were assigned?",
                                            "Summarise this meeting in 3 sentences",
                                            "Draft a follow-up email",
                                        ].map(q => (
                                            <button
                                                key={q}
                                                style={s.suggestion}
                                                onClick={() => { setInput(q); inputRef.current?.focus(); }}
                                            >
                                                {q} ↗
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {messages.map((msg, i) => (
                                <MessageBubble key={i} message={msg} />
                            ))}
                            {loading && <TypingIndicator />}
                            <div ref={bottomRef} />
                        </div>

                        {/* Input — only shown in chat tab */}
                        <div style={s.inputRow}>
                            <textarea
                                ref={inputRef}
                                style={s.input}
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        sendMessage();
                                    }
                                }}
                                placeholder="Ask anything about this content..."
                                rows={1}
                                disabled={loading}
                            />
                            <button
                                style={{
                                    ...s.sendBtn,
                                    ...(!input.trim() || loading ? s.sendBtnOff : {}),
                                }}
                                onClick={sendMessage}
                                disabled={!input.trim() || loading}
                            >
                                ↑
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function MessageBubble({ message }) {
    const isHuman = message.role === "human";
    const displayContent = isHuman ? message.content : parseAIContent(message.content);
    return (
        <div style={{ ...s.msgRow, ...(isHuman ? s.msgRowHuman : {}) }}>
            {!isHuman && <div style={s.aiDot}>●</div>}
            <div style={{
                ...s.bubble,
                ...(isHuman ? s.bubbleHuman : s.bubbleAI),
                ...(message.isError ? s.bubbleError : {}),
            }}>
                <div style={s.bubbleText}>{displayContent}</div>
                {message.sourceChunks?.length > 0 && (
                    <div style={s.sources}>
                        <div style={s.sourcesLabel}>Sources</div>
                        {message.sourceChunks.slice(0, 2).map((c, i) => (
                            <div key={i} style={s.sourceRow}>
                                <span style={s.sourceSpeaker}>{c.speaker}</span>
                                <span style={s.sourceSnippet}>"{c.text.slice(0, 80)}..."</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function TypingIndicator() {
    return (
        <div style={s.msgRow}>
            <div style={s.aiDot}>●</div>
            <div style={{ ...s.bubble, ...s.bubbleAI }}>
                <div style={s.typingDots}>
                    {[0, 0.2, 0.4].map((delay, i) => (
                        <span key={i} style={{ ...s.typingDot, animationDelay: `${delay}s` }} />
                    ))}
                </div>
            </div>
        </div>
    );
}

function SummaryPanel({ summaryData, actionItems, keyDecisions, onToggle }) {
    if (!summaryData) return (
        <div style={s.panelHint}>Generating summary...</div>
    );
    return (
        <div style={s.summaryPanel}>
            {summaryData.summary && (
                <div style={s.summaryBlock}>
                    <div style={s.summaryLabel}>Summary</div>
                    <p style={s.summaryText}>{summaryData.summary}</p>
                </div>
            )}
            {keyDecisions?.length > 0 && (
                <div style={s.summaryBlock}>
                    <div style={s.summaryLabel}>Decisions</div>
                    {keyDecisions.map((d, i) => (
                        <div key={i} style={s.decisionRow}>
                            <span style={s.decisionMark}>—</span>
                            <span style={s.decisionText}>{d}</span>
                        </div>
                    ))}
                </div>
            )}
            {actionItems?.length > 0 && (
                <div style={s.summaryBlock}>
                    <div style={s.summaryLabel}>Action Items</div>
                    {actionItems.map(item => (
                        <div key={item._id} style={s.actionRow} onClick={() => onToggle(item._id)}>
                            <div style={{
                                ...s.actionCheck,
                                ...(item.status === "done" ? s.actionCheckDone : {}),
                            }}>
                                {item.status === "done" && "✓"}
                            </div>
                            <div>
                                <div style={{
                                    ...s.actionTask,
                                    ...(item.status === "done" ? s.actionTaskDone : {}),
                                }}>{item.task}</div>
                                {item.assignedTo && (
                                    <div style={s.actionAssignee}>{item.assignedTo}</div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function FullScreen({ children }) {
    return (
        <div style={{
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            background: "#080808",
        }}>
            {children}
        </div>
    );
}

function Spinner() {
    return (
        <div style={{
            width: "20px", height: "20px",
            border: "1.5px solid #2E2E2E",
            borderTopColor: "#7B6EF6",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
        }} />
    );
}

const s = {
    page: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        background: "#080808",
        overflow: "hidden",
        fontFamily: "'DM Sans', sans-serif",
    },
    topBar: {
        display: "flex",
        alignItems: "center",
        gap: "1.5rem",
        padding: "1.25rem 3rem",
        borderBottom: "1px solid #1C1C1C",
        flexShrink: 0,
    },
    exportRow: {
        display: "flex",
        gap: "0.5rem",
        padding: "0.75rem 3rem",
        borderBottom: "1px solid #1C1C1C",
        flexShrink: 0,
        justifyContent: "flex-end",
    },
    exportBtn: {
        background: "none",
        border: "1px solid #2E2E2E",
        borderRadius: "2px",
        padding: "0.4rem 0.9rem",
        color: "#B0B0B0",
        fontSize: "0.78rem",
        fontFamily: "'DM Sans', sans-serif",
        letterSpacing: "0.06em",
        cursor: "pointer",
        transition: "border-color 0.2s, color 0.2s",
    },
    backBtn: {
        background: "none",
        border: "none",
        color: "#D0D0D0",
        fontSize: "0.95rem",
        cursor: "pointer",
        padding: 0,
        letterSpacing: "0.04em",
        flexShrink: 0,
        transition: "color 0.2s",
    },
    sessionMeta: {
        display: "flex",
        alignItems: "baseline",
        gap: "1rem",
        overflow: "hidden",
    },
    sessionTitle: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "1.02rem",
        fontWeight: 400,
        color: "#F0F0F0",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
    },
    sessionInfo: {
        fontSize: "0.87rem",
        color: "#A0A0A0",
        letterSpacing: "0.06em",
        flexShrink: 0,
    },
    tabs: {
        display: "flex",
        borderBottom: "1px solid #1C1C1C",
        padding: "0 3rem",
        flexShrink: 0,
    },
    tab: {
        background: "none",
        border: "none",
        borderBottom: "1px solid transparent",
        padding: "0.75rem 0",
        marginRight: "2.5rem",
        color: "#B0B0B0",
        fontSize: "0.97rem",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        cursor: "pointer",
        transition: "color 0.2s, border-color 0.2s",
        marginBottom: "-1px",
    },
    tabActive: {
        color: "#F0F0F0",
        borderBottomColor: "#F0F0F0",
    },
    contentArea: {
        flex: 1,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
    },
    scrollArea: {
        flex: 1,
        overflowY: "auto",
        padding: "2.5rem 0",
        display: "flex",
        justifyContent: "center",
    },
    summaryPanel: {
        display: "flex",
        flexDirection: "column",
        gap: "2.5rem",
        width: "100%",
        maxWidth: "720px",
        padding: "0 3rem",
    },
    summaryBlock: {
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
    },
    summaryLabel: {
        fontSize: "1.02rem",
        color: "#B0B0B0",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
    },
    summaryText: {
        fontSize: "0.95rem",
        color: "#A0A0A0",
        lineHeight: 1.7,
    },
    decisionRow: {
        display: "flex",
        gap: "0.5rem",
        alignItems: "flex-start",
    },
    decisionMark: {
        color: "#B0B0B0",
        flexShrink: 0,
        marginTop: "1px",
    },
    decisionText: {
        fontSize: "0.95rem",
        color: "#A0A0A0",
        lineHeight: 1.5,
    },
    actionRow: {
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        cursor: "pointer",
        padding: "0.4rem 0",
    },
    actionCheck: {
        width: "14px",
        height: "14px",
        border: "1px solid #2E2E2E",
        borderRadius: "2px",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.55rem",
        color: "#4ADE80",
        marginTop: "2px",
        transition: "all 0.15s",
    },
    actionCheckDone: {
        borderColor: "#4ADE80",
        background: "rgba(74,222,128,0.08)",
    },
    actionTask: {
        fontSize: "0.95rem",
        color: "#F0F0F0",
        lineHeight: 1.4,
    },
    actionTaskDone: {
        color: "#B0B0B0",
        textDecoration: "line-through",
    },
    actionAssignee: {
        fontSize: "0.97rem",
        color: "#B0B0B0",
        marginTop: "2px",
    },
    transcriptText: {
        fontSize: "0.95rem",
        color: "#A0A0A0",
        lineHeight: 1.9,
        whiteSpace: "pre-wrap",
        fontFamily: "'DM Sans', sans-serif",
        width: "100%",
        maxWidth: "720px",
        padding: "0 3rem",
    },
    chatPanel: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        alignItems: "center",
    },
    messages: {
        flex: 1,
        overflowY: "auto",
        padding: "2.5rem 0",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
        width: "100%",
        maxWidth: "760px",
        alignSelf: "center",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        paddingTop: "1rem",
    },
    emptyTitle: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "2rem",
        fontWeight: 400,
        color: "#F0F0F0",
        fontStyle: "italic",
    },
    emptySubtitle: {
        fontSize: "0.97rem",
        color: "#B0B0B0",
        marginBottom: "1rem",
    },
    suggestions: {
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "400px",
    },
    suggestion: {
        background: "none",
        border: "1px solid #1C1C1C",
        borderRadius: "2px",
        padding: "0.6rem 1rem",
        color: "#A0A0A0",
        fontSize: "0.95rem",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "'DM Sans', sans-serif",
        transition: "border-color 0.2s, color 0.2s",
        letterSpacing: "0.02em",
    },
    msgRow: {
        display: "flex",
        gap: "1rem",
        alignItems: "flex-start",
    },
    msgRowHuman: {
        flexDirection: "row-reverse",
    },
    aiDot: {
        fontSize: "0.5rem",
        color: "#7B6EF6",
        marginTop: "6px",
        flexShrink: 0,
    },
    bubble: {
        maxWidth: "65%",
        borderRadius: "2px",
        padding: "1rem 1.25rem",
        fontSize: "1rem",
        lineHeight: 1.7,
    },
    bubbleHuman: {
        background: "#111111",
        color: "#F0F0F0",
        border: "1px solid #1C1C1C",
        marginLeft: "auto",
    },
    bubbleAI: {
        background: "transparent",
        color: "#D0D0D0",
        border: "1px solid #1C1C1C",
    },
    bubbleError: {
        border: "1px solid #3A1515",
        color: "#F87171",
    },
    bubbleText: {
        whiteSpace: "pre-wrap",
    },
    sources: {
        marginTop: "1rem",
        paddingTop: "0.75rem",
        borderTop: "1px solid #1C1C1C",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
    },
    sourcesLabel: {
        fontSize: "1.02rem",
        color: "#B0B0B0",
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        marginBottom: "0.25rem",
    },
    sourceRow: {
        display: "flex",
        gap: "0.5rem",
        fontSize: "0.87rem",
    },
    sourceSpeaker: {
        color: "#7B6EF6",
        fontWeight: 500,
        flexShrink: 0,
    },
    sourceSnippet: {
        color: "#B0B0B0",
        fontStyle: "italic",
    },
    typingDots: {
        display: "flex",
        gap: "4px",
        padding: "2px 0",
    },
    typingDot: {
        width: "5px",
        height: "5px",
        borderRadius: "50%",
        background: "#3A3A3A",
        animation: "pulse 1s ease-in-out infinite",
        display: "block",
    },
    inputRow: {
        padding: "1.25rem 3rem",
        borderTop: "1px solid #1C1C1C",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-end",
        background: "#080808",
        flexShrink: 0,
        width: "100%",
        maxWidth: "760px",
        alignSelf: "center",
    },
    input: {
        flex: 1,
        background: "transparent",
        border: "none",
        borderBottom: "1px solid #2E2E2E",
        borderRadius: 0,
        padding: "0.75rem 0",
        color: "#F0F0F0",
        fontSize: "1.02rem",
        resize: "none",
        outline: "none",
        fontFamily: "'DM Sans', sans-serif",
        lineHeight: 1.5,
        maxHeight: "120px",
        transition: "border-color 0.2s",
    },
    sendBtn: {
        width: "36px",
        height: "36px",
        borderRadius: "2px",
        background: "#F0F0F0",
        border: "none",
        color: "#080808",
        fontSize: "1rem",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        transition: "background 0.2s",
        marginBottom: "0.75rem",
    },
    sendBtnOff: {
        background: "#1C1C1C",
        color: "#B0B0B0",
        cursor: "not-allowed",
    },
    loadingText: {
        fontSize: "0.92rem",
        color: "#B0B0B0",
        letterSpacing: "0.08em",
        fontFamily: "'DM Sans', sans-serif",
    },
    errorText: {
        color: "#F87171",
        fontSize: "0.97rem",
        fontFamily: "'DM Sans', sans-serif",
    },
    backBtnFull: {
        background: "none",
        border: "1px solid #1C1C1C",
        borderRadius: "2px",
        padding: "0.5rem 1rem",
        color: "#A0A0A0",
        fontSize: "0.92rem",
        cursor: "pointer",
        fontFamily: "'DM Sans', sans-serif",
    },
};