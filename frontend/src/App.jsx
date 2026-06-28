import { Routes, Route, Navigate } from "react-router-dom";
import Home from "./pages/Home.jsx";
import Chat from "./pages/Chat.jsx";
import Sessions from "./pages/Sessions.jsx";

export default function App() {
    return (
        <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/chat/:sessionId" element={<Chat />} />
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}