// Browser-side short-term memory (spec §16.2): the SessionState lives in sessionStorage and is
// sent with every request; the server returns the canonical updated state (§16.6), which we store
// back. No long-term memory, no DB — closing the tab ends the session. All state is re-validated
// server-side, so a corrupted or tampered store is harmless (answer() runs sanitizeSession()).
import { type SessionState } from "@/lib/generation/session";

const STORAGE_KEY = "car-talk:session";

export function loadClientSession(): SessionState | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as SessionState;
  } catch {
    return undefined; // corrupted store → start fresh; the server would reject it anyway
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
