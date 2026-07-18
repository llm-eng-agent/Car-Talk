// Browser-side short-term memory (spec §16.2): the SessionState lives in sessionStorage and is
// sent with every request; the server returns the canonical updated state (§16.6), which we store
// back. No long-term memory, no DB — closing the tab ends the session. All state is re-validated
// server-side, so a corrupted or tampered store is harmless (answer() runs sanitizeSession()).
import { sanitizeSession, type SessionState } from "@/lib/generation/session";

const STORAGE_KEY = "car-talk:session";

export function loadClientSession(): SessionState | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    // Parse can yield any shape (old version, tampering). sanitizeSession() accepts `unknown` and
    // rebuilds a valid SessionState from emptySession(), so the UI never dereferences a malformed
    // object (e.g. `{}` → crash in PreferencePanel). This mirrors the server-side validation (§16.6).
    return sanitizeSession(JSON.parse(raw));
  } catch {
    return undefined; // unparseable store → start fresh
  }
}

export function saveClientSession(session: SessionState): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearClientSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(STORAGE_KEY);
}
