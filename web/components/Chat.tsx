"use client";

// The chat surface: holds the message list + input, sends each turn to /api/chat with the prior
// SessionState, and stores the canonical state the server returns (spec §16.6). Short-term memory
// lives in sessionStorage (clientSession) — no accounts, no history, "New conversation" wipes it.
import { useEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { AnswerView } from "./AnswerView";
import { PreferencePanel } from "./PreferencePanel";
import type { AnswerResult } from "@/lib/generation/answer";
import { emptySession, type SessionState } from "@/lib/generation/session";
import { clearClientSession, loadClientSession, saveClientSession } from "@/lib/session/clientSession";
import {
  ChevronLeftIcon,
  NewChatIcon,
  ScaleIcon,
  SendIcon,
  SparkleIcon,
  UsersIcon,
  WalletIcon,
} from "@/lib/ui/icons";

type ChatMessage = { role: "user"; text: string } | { role: "assistant"; result: AnswerResult };

type Suggestion = { title: string; subtitle: string; query: string; icon: ComponentType<SVGProps<SVGSVGElement>> };

const SUGGESTIONS: Suggestion[] = [
  { title: "רכב למשפחה", subtitle: "איזה רכב מתאים למשפחה עם שלושה ילדים?", query: "איזה רכב מתאים למשפחה עם שלושה ילדים?", icon: UsersIcon },
  { title: "השוואת דגמים", subtitle: "השווה בין EV9 ל-GV80", query: "השווה בין EV9 ל-GV80", icon: ScaleIcon },
  { title: "רכב בתקציב", subtitle: "איזה רכב חשמלי נותן הכי הרבה תמורה?", query: "איזה רכב חשמלי נותן הכי הרבה תמורה?", icon: WalletIcon },
];

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [session, setSession] = useState<SessionState>(emptySession());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Monotonic conversation generation. A reset bumps it; a response captured under an older
  // generation is discarded, so a request in flight when "New conversation" is clicked can't
  // resurrect a stale message/session after the UI was cleared.
  const runIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

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
    const myRun = runIdRef.current; // this turn belongs to the current conversation generation
    const controller = new AbortController();
    abortRef.current = controller;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed, session }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const result = (await res.json()) as AnswerResult;
      if (runIdRef.current !== myRun) return; // a reset happened while awaiting → drop this response
      setMessages((m) => [...m, { role: "assistant", result }]);
      setSession(result.session);
      saveClientSession(result.session);
    } catch {
      if (runIdRef.current !== myRun) return; // reset (or its abort) → don't surface a stale error
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
      if (runIdRef.current === myRun) setLoading(false);
    }
  }

  function reset() {
    runIdRef.current += 1; // invalidate any in-flight response
    abortRef.current?.abort();
    clearClientSession();
    setSession(emptySession());
    setMessages([]);
    setInput("");
    setLoading(false);
  }

  return (
    <div className="mx-auto flex h-dvh max-w-5xl flex-col px-3 sm:px-5">
      <header className="flex items-start justify-between py-5">
        <button
          type="button"
          onClick={reset}
          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-3.5 py-2 text-sm font-medium text-white/85 transition hover:border-accent/40 hover:bg-white/5"
          data-testid="new-conversation"
        >
          <NewChatIcon className="h-4 w-4" />
          שיחה חדשה
        </button>
        <div className="text-left" dir="ltr">
          <h1 className="text-xl font-bold tracking-tight text-white">
            Car-Talk<span className="text-accent">.</span>
          </h1>
          <p className="text-xs text-accent/70" dir="rtl">
            מדברים רכב.
          </p>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 gap-4 pb-5 ${
          messages.length > 0 ? "md:grid-cols-[1fr_280px]" : "grid-cols-1"
        }`}
      >
        <div className="flex min-h-0 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {messages.length === 0 ? (
              <Welcome onPick={send} />
            ) : (
              <div className="flex flex-col gap-4 py-2">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl border border-accent/25 bg-accent/10 px-4 py-2.5 text-[15px] text-white">
                        {m.text}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className="rounded-2xl bg-surface p-4 shadow-lg shadow-black/20">
                      <AnswerView result={m.result} namespace={String(i)} />
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
            className="mt-3 flex items-stretch gap-2"
          >
            <div className="glow-focus relative flex flex-1 items-center rounded-full border border-white/15 bg-white/5 transition">
              <SparkleIcon className="pointer-events-none absolute right-4 h-5 w-5 text-accent/70" />
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="איזה רכב מעניין אותך?"
                className="w-full bg-transparent py-3.5 pr-12 pl-4 text-white placeholder:text-white/40 focus:outline-none"
                data-testid="chat-input"
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading || input.trim().length === 0}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-accent-strong px-6 py-3.5 font-semibold text-white shadow-[0_0_24px_rgba(45,212,191,0.25)] transition hover:bg-accent disabled:opacity-40 disabled:shadow-none"
              data-testid="send"
            >
              <SendIcon className="h-4 w-4" />
              בואו נבדוק
            </button>
          </form>
        </div>

        {messages.length > 0 && (
          <div className="min-h-0 overflow-y-auto">
            <PreferencePanel session={session} />
          </div>
        )}
      </div>
    </div>
  );
}

function Welcome({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">
          איזה רכב עומד <span className="text-accent">אצלך</span> על הפרק?
        </h2>
        <p className="mx-auto mt-3 max-w-2xl text-sm text-white/55 sm:text-base">
          אפשר להשוות דגמים, לבדוק התאמה למשפחה או להבין איפה כל רכב באמת נופל.
        </p>
      </div>
      <div className="flex w-full max-w-2xl flex-col gap-3">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onPick(s.query)}
            className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4 text-right transition hover:border-accent/40 hover:bg-white/[0.06] hover:shadow-[0_0_34px_rgba(45,212,191,0.12)]"
          >
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-accent/40 text-accent transition group-hover:bg-accent/10">
              <s.icon className="h-6 w-6" />
            </span>
            <span className="flex-1">
              <span className="block font-bold text-white">{s.title}</span>
              <span className="block text-sm text-white/55">{s.subtitle}</span>
            </span>
            <ChevronLeftIcon className="h-5 w-5 shrink-0 text-accent/60 transition group-hover:-translate-x-1 group-hover:text-accent" />
          </button>
        ))}
      </div>
    </div>
  );
}

// Rotating "thinking" copy — cycles through the pool every couple of seconds so the wait feels alive.
const THINKING_MESSAGES = [
  "אוסף את הפרטים החשובים ומכין תשובה",
  "רגע, בודק מה אומרים",
  "קורא בין השורות של הביקורות",
];

function Thinking() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % THINKING_MESSAGES.length), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70"
      data-testid="thinking"
    >
      <span className="inline-flex items-center gap-2">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
        {THINKING_MESSAGES[index]}…
      </span>
    </div>
  );
}
