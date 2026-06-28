import crypto from "crypto";
import logger from "../utils/logger.js";

const COOKIE_NAME = "talktrace_owner";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year

const generateOwnerToken = () =>
    crypto.randomBytes(32).toString("hex");

/**
 * ownerMiddleware — runs on every request.
 * Generates ownerToken cookie on first visit.
 * Attaches req.ownerToken for controllers to use.
 */
export const ownerMiddleware = (req, res, next) => {
    let ownerToken = req.cookies?.[COOKIE_NAME];

    if (!ownerToken) {
        ownerToken = generateOwnerToken();
        res.cookie(COOKIE_NAME, ownerToken, {
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "none" : "lax", // "none" required for cross-origin
            secure: process.env.NODE_ENV === "production", // "none" requires secure=true
            maxAge: COOKIE_MAX_AGE,
        });
        logger.debug({ msg: "New owner token issued" });
    }

    req.ownerToken = ownerToken;
    next();
};

/**
 * requireOwner — verifies session belongs to this owner.
 * Returns true if valid, sends 404 and returns false if not.
 * Using 404 (not 403) to prevent session enumeration attacks.
 */
export const requireOwner = (session, req, res) => {
    if (!session) {
        res.status(404).json({ message: "Session not found" });
        return false;
    }
    if (session.ownerToken !== req.ownerToken) {
        res.status(404).json({ message: "Session not found" });
        return false;
    }
    return true;
};