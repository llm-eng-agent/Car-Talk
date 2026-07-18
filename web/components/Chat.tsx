"use client";

// The chat surface: holds the message list + input, sends each turn to /api/chat with the prior
// SessionState, and stores the canonical state the server returns (spec §16.6). Short-term memory
// lives in sessionStorage (clientSession) — no accounts, no history, "New conversation" wipes it.
import { useEffect, useRef, useState } from "react";
import { AnswerView } from "./AnswerView";
import { PreferencePanel } from "./PreferencePanel";
import type { AnswerResult } from "@/lib/generation/answer";
import { emptySession, type SessionState } from "@/lib/generation/session";
import { clearClientSession, loadClientSession, saveClientSession } from "@/lib/session/clientSession";

type ChatMessage = { role: "user"; text: string } | { role: "assistant"; result: AnswerResult };

const SUGGESTIONS = [
  "אני מחפש רכב משפחתי לשלושה ילדים. נוחות ומרחב חשובים לי יותר מביצועים.",
  "השווה בין ה-EV9 ל-GV80.",
  "מה אתה ממליץ לנהיגה עירונית עם תקציב חשמלי?",
];

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [session, setSession] = useState<SessionState>(emptySession());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Restore session on mount (client-only; the server re-validates it on every request anyway).
  useEffect(() => {
    const stored = loadClientSession();
    if (stored) setSession(stored);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, session }),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const result = (await res.json()) as AnswerResult;
      setMessages((m) => [...m, { role: "assistant", result }]);
      setSession(result.session);
      saveClientSession(result.session);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          result: {
            status: "error",
            mode: null,
            citations: [],
            message: "אירעה שגיאה זמנית. נסו שוב בעוד רגע.",
            session,
          },
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    clearClientSession();
    setSession(emptySession());
    setMessages([]);
    setInput("");
  }

  return (
    <div className="mx-auto flex h-dvh max-w-5xl flex-col px-3 sm:px-5">
      <header className="flex items-center justify-between py-4">
        <div>
          <h1 className="text-lg font-bold text-white">Car-Talk</h1>
          <p className="text-xs text-white/60">יועץ רכב מבוסס-ביקורות · תשובה מצוטטת בלבד</p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-full border border-white/20 px-3 py-1.5 text-sm font-medium text-white/90 hover:bg-white/10"
          data-testid="new-conversation"
        >
          שיחה חדשה
        </button>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 pb-4 md:grid-cols-[1fr_280px]">
        <div className="flex min-h-0 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-canvas">
            {messages.length === 0 ? (
              <Welcome onPick={send} />
            ) : (
              <div className="flex flex-col gap-4 py-2">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl bg-brand px-4 py-2.5 text-[15px] text-white">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="rounded-2xl bg-surface p-4 shadow-sm">
                      <AnswerView result={m.result} />
                    </div>
                  ),
                )}
                {loading && <Thinking />}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="mt-3 flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="שאלו על רכב, בקשו השוואה או המלצה…"
              className="flex-1 rounded-full border border-white/15 bg-white/5 px-4 py-3 text-white placeholder:text-white/40 focus:border-accent focus:outline-none"
              data-testid="chat-input"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="rounded-full bg-accent px-5 py-3 font-semibold text-white disabled:opacity-40"
              data-testid="send"
            >
              שליחה
            </button>
          </form>
        </div>

        <div className="min-h-0 overflow-y-auto">
          <PreferencePanel session={session} />
        </div>
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-4 text-center">
      <div>
        <h2 className="text-2xl font-bold text-white">מה תרצו לדעת על הרכב הבא שלכם?</h2>
        <p className="mt-2 text-sm text-white/60">
          אני עונה אך ורק מתוך 8 ביקורות מאושרות, ומצטט מקור לכל טענה. אם אין מידע — אומר זאת במפורש.
        </p>
      </div>
      <div className="flex w-full max-w-xl flex-col gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-right text-sm text-white/90 hover:bg-white/10"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="rounded-2xl bg-surface p-4 text-sm text-ink-soft" data-testid="thinking">
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        אוחז ראיות ומנסח תשובה מצוטטת…
      </span>
    </div>
  );
}
