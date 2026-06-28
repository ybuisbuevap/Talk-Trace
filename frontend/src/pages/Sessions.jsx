import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { getSessions, deleteSession } from "../utils/api.js";

export default function Sessions() {
    const navigate = useNavigate();
    const searchRef = useRef(null);
    const observerRef = useRef(null);
    const loadMoreRef = useRef(null);

    const [sessions, setSessions] = useState([]);
    const [search, setSearch] = useState("");
    const [cursor, setCursor] = useState(null);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(null);
    const [deletingId, setDeletingId] = useState(null);

    // Load sessions — reset on search change
    const loadSessions = useCallback(async (searchQuery = "", cursorVal = null, append = false) => {
        if (!append) setLoading(true);
        else setLoadingMore(true);

        try {
            const data = await getSessions(cursorVal, searchQuery);
            setSessions(prev => append ? [...prev, ...data.sessions] : data.sessions);
            setCursor(data.pagination.nextCursor);
            setHasNextPage(data.pagination.hasNextPage);
        } catch {
            setError("Failed to load sessions.");
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    }, []);

    // Initial load
    useEffect(() => {
        loadSessions();
    }, [loadSessions]);

    // Search — debounced 400ms
    useEffect(() => {
        const timer = setTimeout(() => {
            loadSessions(search, null, false);
        }, 400);
        return () => clearTimeout(timer);
    }, [search, loadSessions]);

    // Infinite scroll via IntersectionObserver
    useEffect(() => {
        if (!loadMoreRef.current) return;
        observerRef.current = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting && hasNextPage && !loadingMore) {
                    loadSessions(search, cursor, true);
                }
            },
            { threshold: 0.1 }
        );
        observerRef.current.observe(loadMoreRef.current);
        return () => observerRef.current?.disconnect();
    }, [hasNextPage, cursor, loadingMore, search, loadSessions]);

    const handleDelete = async (e, sessionId) => {
        e.stopPropagation(); // prevent navigating to session
        if (!confirm("Delete this session? This cannot be undone.")) return;
        setDeletingId(sessionId);
        try {
            await deleteSession(sessionId);
            setSessions(prev => prev.filter(s => s.sessionId !== sessionId));
        } catch {
            alert("Delete failed. Please try again.");
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div style={s.page}>
            {/* Header */}
            <header style={s.header}>
                <button style={s.backBtn} onClick={() => navigate("/")}>← New upload</button>
                <div style={s.headerRight}>
                    <div style={s.logoMark}>TalkTrace</div>
                </div>
            </header>

            {/* Title + search */}
            <div style={s.topSection}>
                <div style={s.titleRow}>
                    <h1 style={s.pageTitle}>Your Sessions</h1>
                    <span style={s.sessionCount}>
                        {sessions.length > 0 && `${sessions.length}${hasNextPage ? "+" : ""} sessions`}
                    </span>
                </div>

                {/* Search */}
                <div style={s.searchRow}>
                    <div style={s.searchWrapper}>
                        <span style={s.searchIcon}>⌕</span>
                        <input
                            ref={searchRef}
                            style={s.searchInput}
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            placeholder="Search across titles and transcripts..."
                        />
                        {search && (
                            <button style={s.clearBtn} onClick={() => setSearch("")}>×</button>
                        )}
                    </div>
                </div>
            </div>

            <div style={s.divider} />

            {/* Sessions grid */}
            <div style={s.content}>
                {loading ? (
                    <div style={s.loadingState}>
                        <div style={s.spinner} />
                        <span style={s.loadingText}>Loading sessions...</span>
                    </div>
                ) : error ? (
                    <div style={s.emptyState}>
                        <p style={s.emptyText}>{error}</p>
                    </div>
                ) : sessions.length === 0 ? (
                    <div style={s.emptyState}>
                        <p style={s.emptyTitle}>
                            {search ? "No sessions match your search." : "No sessions yet."}
                        </p>
                        <p style={s.emptyText}>
                            {search
                                ? "Try a different search term."
                                : "Upload an audio or video file to get started."}
                        </p>
                        {!search && (
                            <button style={s.uploadBtn} onClick={() => navigate("/")}>
                                Upload your first file →
                            </button>
                        )}
                    </div>
                ) : (
                    <div style={s.grid}>
                        {sessions.map(session => (
                            <SessionCard
                                key={session.sessionId}
                                session={session}
                                deleting={deletingId === session.sessionId}
                                onClick={() => navigate(`/chat/${session.sessionId}`)}
                                onDelete={(e) => handleDelete(e, session.sessionId)}
                            />
                        ))}
                    </div>
                )}

                {/* Infinite scroll trigger */}
                <div ref={loadMoreRef} style={{ height: "1px" }} />

                {loadingMore && (
                    <div style={s.loadingMore}>
                        <div style={s.spinnerSm} />
                        <span style={s.loadingText}>Loading more...</span>
                    </div>
                )}
            </div>
        </div>
    );
}

function SessionCard({ session, onClick, onDelete, deleting }) {
    const date = new Date(session.createdAt);
    const dateStr = date.toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric"
    });
    const timeStr = date.toLocaleTimeString("en-IN", {
        hour: "2-digit", minute: "2-digit"
    });

    return (
        <div
            style={{
                ...s.card,
                ...(deleting ? s.cardDeleting : {}),
            }}
            onClick={onClick}
        >
            {/* Card header */}
            <div style={s.cardTop}>
                <div style={s.cardStatus}>
                    <span style={{
                        ...s.statusDot,
                        background: session.status === "ready" ? "#4ADE80" : "#F87171",
                    }} />
                    <span style={s.statusText}>{session.status}</span>
                </div>
                <button
                    style={s.deleteBtn}
                    onClick={onDelete}
                    title="Delete session"
                >
                    ×
                </button>
            </div>

            {/* Title */}
            <div style={s.cardTitle}>{session.title || "Untitled"}</div>

            {/* Summary preview */}
            {session.summary && (
                <p style={s.cardSummary}>
                    {session.summary.slice(0, 120)}
                    {session.summary.length > 120 ? "..." : ""}
                </p>
            )}

            {/* Meta row */}
            <div style={s.cardMeta}>
                <span style={s.metaItem}>
                    {session.wordCount?.toLocaleString()} words
                </span>
                {session.duration && (
                    <span style={s.metaItem}>
                        {Math.round(session.duration / 60)} min
                    </span>
                )}
                {session.actionItemCount > 0 && (
                    <span style={s.metaItem}>
                        {session.actionItemCount} action {session.actionItemCount === 1 ? "item" : "items"}
                    </span>
                )}
                <span style={{ ...s.metaItem, marginLeft: "auto" }}>
                    {dateStr} · {timeStr}
                </span>
            </div>
        </div>
    );
}

const s = {
    page: {
        minHeight: "100vh",
        background: "#080808",
        display: "flex",
        flexDirection: "column",
        fontFamily: "'DM Sans', sans-serif",
    },
    header: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "1.5rem 3rem",
        borderBottom: "1px solid #1C1C1C",
    },
    backBtn: {
        background: "none",
        border: "none",
        color: "#B0B0B0",
        fontSize: "0.87rem",
        cursor: "pointer",
        padding: 0,
        letterSpacing: "0.04em",
        transition: "color 0.2s",
    },
    headerRight: {},
    logoMark: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontWeight: 900,
        fontSize: "1rem",
        color: "#F0F0F0",
        fontStyle: "italic",
    },
    topSection: {
        padding: "3rem 3rem 2rem",
        display: "flex",
        flexDirection: "column",
        gap: "1.5rem",
    },
    titleRow: {
        display: "flex",
        alignItems: "baseline",
        gap: "1rem",
    },
    pageTitle: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "2.5rem",
        fontWeight: 700,
        color: "#F0F0F0",
        lineHeight: 1.1,
    },
    sessionCount: {
        fontSize: "0.85rem",
        color: "#7A7A7A",
        letterSpacing: "0.06em",
    },
    searchRow: {
        maxWidth: "520px",
    },
    searchWrapper: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        border: "1px solid #2E2E2E",
        borderRadius: "2px",
        padding: "0.75rem 1rem",
        background: "#111111",
        transition: "border-color 0.2s",
    },
    searchIcon: {
        color: "#7A7A7A",
        fontSize: "1.1rem",
        flexShrink: 0,
    },
    searchInput: {
        flex: 1,
        background: "none",
        border: "none",
        outline: "none",
        color: "#F0F0F0",
        fontSize: "0.92rem",
        fontFamily: "'DM Sans', sans-serif",
    },
    clearBtn: {
        background: "none",
        border: "none",
        color: "#7A7A7A",
        fontSize: "1.2rem",
        cursor: "pointer",
        padding: 0,
        lineHeight: 1,
    },
    divider: {
        height: "1px",
        background: "#1C1C1C",
        margin: "0 3rem",
    },
    content: {
        flex: 1,
        padding: "2.5rem 3rem",
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
        gap: "1px",
        background: "#1C1C1C", // gap color — creates hairline grid effect
    },
    card: {
        background: "#080808",
        padding: "1.75rem",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        transition: "background 0.15s",
        borderBottom: "1px solid #1C1C1C",
    },
    cardDeleting: {
        opacity: 0.4,
        pointerEvents: "none",
    },
    cardTop: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
    },
    cardStatus: {
        display: "flex",
        alignItems: "center",
        gap: "0.4rem",
    },
    statusDot: {
        width: "6px",
        height: "6px",
        borderRadius: "50%",
        display: "block",
        flexShrink: 0,
    },
    statusText: {
        fontSize: "0.78rem",
        color: "#7A7A7A",
        letterSpacing: "0.06em",
        textTransform: "uppercase",
    },
    deleteBtn: {
        background: "none",
        border: "none",
        color: "#7A7A7A",
        fontSize: "1.2rem",
        cursor: "pointer",
        padding: "0 0.25rem",
        lineHeight: 1,
        transition: "color 0.15s",
    },
    cardTitle: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "1rem",
        fontWeight: 400,
        color: "#F0F0F0",
        lineHeight: 1.4,
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
    },
    cardSummary: {
        fontSize: "0.85rem",
        color: "#7A7A7A",
        lineHeight: 1.6,
        display: "-webkit-box",
        WebkitLineClamp: 3,
        WebkitBoxOrient: "vertical",
        overflow: "hidden",
    },
    cardMeta: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        marginTop: "0.5rem",
        flexWrap: "wrap",
    },
    metaItem: {
        fontSize: "0.78rem",
        color: "#3A3A3A",
        letterSpacing: "0.04em",
    },
    loadingState: {
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        padding: "4rem 0",
        justifyContent: "center",
    },
    loadingMore: {
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        justifyContent: "center",
        padding: "2rem 0",
    },
    loadingText: {
        fontSize: "0.85rem",
        color: "#7A7A7A",
    },
    spinner: {
        width: "18px",
        height: "18px",
        border: "1.5px solid #2E2E2E",
        borderTopColor: "#7B6EF6",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
    },
    spinnerSm: {
        width: "14px",
        height: "14px",
        border: "1.5px solid #2E2E2E",
        borderTopColor: "#7B6EF6",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
    },
    emptyState: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.75rem",
        padding: "6rem 0",
        textAlign: "center",
    },
    emptyTitle: {
        fontFamily: "'Playfair Display', Georgia, serif",
        fontSize: "1.5rem",
        fontWeight: 400,
        color: "#F0F0F0",
        fontStyle: "italic",
    },
    emptyText: {
        fontSize: "0.9rem",
        color: "#7A7A7A",
    },
    uploadBtn: {
        marginTop: "1rem",
        background: "#F0F0F0",
        color: "#080808",
        border: "none",
        borderRadius: "2px",
        padding: "0.75rem 1.5rem",
        fontSize: "0.9rem",
        fontWeight: 500,
        fontFamily: "'DM Sans', sans-serif",
        cursor: "pointer",
    },
};