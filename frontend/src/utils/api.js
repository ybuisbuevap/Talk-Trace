import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
    baseURL: API_BASE,
    timeout: 120000, // 2 min — transcription can take time
    withCredentials: true, // send httpOnly cookies with every request
});

// Upload audio/video file
export const uploadFile = async (file, onProgress) => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await api.post("/api/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (e) => {
            const pct = Math.round((e.loaded * 100) / e.total);
            onProgress?.(pct);
        },
    });
    return res.data;
};

// Poll processing status
export const getStatus = async (sessionId) => {
    const res = await api.get(`/api/upload/status/${sessionId}`);
    return res.data;
};

// Get session details
export const getSession = async (sessionId) => {
    const res = await api.get(`/api/chat/${sessionId}`);
    return res.data;
};

// Generate summary
export const summarize = async (sessionId) => {
    const res = await api.post(`/api/chat/${sessionId}/summarize`);
    return res.data;
};

// Chat with agent
export const chat = async (sessionId, message) => {
    const res = await api.post("/api/chat", { sessionId, message });
    return res.data;
};

// Toggle action item
export const toggleActionItem = async (sessionId, itemId) => {
    const res = await api.patch(`/api/chat/${sessionId}/action-items/${itemId}`);
    return res.data;
};

// Get paginated sessions dashboard
export const getSessions = async (cursor = null, search = "") => {
    const params = new URLSearchParams();
    if (cursor) params.append("cursor", cursor);
    if (search) params.append("search", search);
    const res = await api.get(`/api/sessions?${params.toString()}`);
    return res.data;
};

// Delete a session
export const deleteSession = async (sessionId) => {
    const res = await api.delete(`/api/sessions/${sessionId}`);
    return res.data;
};

export default api;