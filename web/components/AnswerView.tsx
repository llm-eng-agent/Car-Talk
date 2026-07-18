"use client";

// Renders one assistant turn from a validated AnswerResult (the JSON returned by /api/chat).
// Every branch here maps a pipeline field to UI — no logic, no fetching. Terminal states
// (out_of_scope / insufficient / error) carry only a `message`; generated answers carry `output`,
// `citations`, and optionally a deterministic `recommendation`.
import { useState } from "react";
import type { AnswerResult } from "@/lib/generation/answer";
import type { Citation } from "@/lib/generation/citations";
import type { Recommendation } from "@/lib/generation/recommend";
import type { AspectAssessment, ConstraintAssessment } from "@/lib/generation/schema";
import {
  ASPECT_ASSESSMENT_LABELS,
  ASSESSMENT_TONE,
  CONSTRAINT_LABELS,
  CONSTRAINT_STATUS_LABELS,
  CONSTRAINT_STATUS_TONE,
  DECISION_RULE_LABELS,
  aspectLabel,
  vehicleName,
} from "@/lib/ui/labels";

const TONE_CLASS: Record<"good" | "warn" | "bad" | "neutral", string> = {
  good: "bg-good-soft text-good",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  neutral: "bg-surface-muted text-ink-soft",
};

export function AnswerView({ result }: { result: AnswerResult }) {
  // Terminal / error turns: a single message card, tinted by status.
  if (!result.output) {
    const tone =
      result.status === "out_of_scope"
        ? "bg-brand-soft text-brand"
        : result.status === "error"
          ? "bg-bad-soft text-bad"
          : "bg-warn-soft text-warn";
    return (
      <div className={`rounded-2xl px-4 py-3 leading-relaxed ${tone}`} data-testid="terminal-message">
        {result.message}
      </div>
    );
  }

  const { output } = result;
  return (
    <div className="flex flex-col gap-4" data-testid="answer">
      <p className="text-[15px] leading-7 text-ink whitespace-pre-wrap">{output.overview.text}</p>
      <CitationRefs ids={output.overview.citation_ids} />

      {output.aspect_assessments.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="aspects">
          {output.aspect_assessments.map((a, i) => (
            <AspectRow key={`${a.aspect}-${i}`} a={a} />
          ))}
        </section>
      )}

      {output.constraint_assessments.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="constraints">
          <h3 className="text-xs font-semibold text-ink-soft">עמידה באילוצים</h3>
          {output.constraint_assessments.map((c, i) => (
            <ConstraintRow key={`${c.constraint}-${c.vehicle_id}-${i}`} c={c} />
          ))}
        </section>
      )}

      {result.recommendation && <RecommendationCard rec={result.recommendation} />}

      {output.missing_information.length > 0 && (
        <section className="rounded-xl bg-surface-muted px-4 py-3" data-testid="missing-info">
          <h3 className="mb-1 text-xs font-semibold text-ink-soft">מה חסר במאגר כדי לענות במלואו</h3>
          <ul className="list-disc pr-5 text-sm text-ink-soft">
            {output.missing_information.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </section>
      )}

      {output.follow_up_question && (
        <p className="rounded-xl bg-brand-soft px-4 py-3 text-sm font-medium text-brand" data-testid="follow-up">
          {output.follow_up_question}
        </p>
      )}

      {result.citations.length > 0 && <SourceList citations={result.citations} />}
    </div>
  );
}

function AspectRow({ a }: { a: AspectAssessment }) {
  const tone = ASSESSMENT_TONE[a.assessment];
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-semibold text-ink">{aspectLabel(a.aspect)}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
          {ASPECT_ASSESSMENT_LABELS[a.assessment]}
          {a.winner_vehicle_id ? `: ${vehicleName(a.winner_vehicle_id)}` : ""}
        </span>
      </div>
      <p className="text-sm leading-6 text-ink-soft">{a.explanation}</p>
      <CitationRefs ids={a.citation_ids} />
    </div>
  );
}

function ConstraintRow({ c }: { c: ConstraintAssessment }) {
  const tone = CONSTRAINT_STATUS_TONE[c.status];
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{vehicleName(c.vehicle_id)}</span>
        <span className="text-ink-soft">·</span>
        <span className="text-ink-soft">{CONSTRAINT_LABELS[c.constraint] ?? c.constraint}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
          {CONSTRAINT_STATUS_LABELS[c.status]}
        </span>
      </div>
      {c.explanation && <p className="mt-1 text-ink-soft">{c.explanation}</p>}
      <CitationRefs ids={c.citation_ids} />
    </div>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <section
      className="rounded-2xl border-2 border-brand/20 bg-brand-soft px-4 py-3"
      data-testid="recommendation"
    >
      <div className="mb-1 flex items-center gap-2">
        <h3 className="font-bold text-brand">
          {rec.decision ? `המלצה: ${vehicleName(rec.decision)}` : "פשרה — בחירה תלויה בך"}
        </h3>
        {rec.tradeOff && (
          <span className="rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn" data-testid="tradeoff-badge">
            פשרה
          </span>
        )}
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">
          {DECISION_RULE_LABELS[rec.decisionRule]}
        </span>
      </div>
      <p className="text-sm leading-6 text-ink">{rec.reason}</p>
      {rec.eliminated.length > 0 && (
        <p className="mt-1 text-xs text-ink-soft">
          נפסלו על אילוץ: {rec.eliminated.map((e) => vehicleName(e.vehicleId)).join(", ")}
        </p>
      )}
      {rec.followUpQuestion && <p className="mt-2 text-sm font-medium text-brand">{rec.followUpQuestion}</p>}
    </section>
  );
}

// Inline references to the source cards below (C1, C2, …). Each links to its card anchor.
function CitationRefs({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => (
        <a
          key={id}
          href={`#source-${id}`}
          className="rounded bg-surface-muted px-1.5 py-0.5 text-xs font-medium text-brand hover:bg-brand-soft"
        >
          {id}
        </a>
      ))}
    </div>
  );
}

function SourceList({ citations }: { citations: Citation[] }) {
  return (
    <section className="flex flex-col gap-2" data-testid="sources">
      <h3 className="text-xs font-semibold text-ink-soft">מקורות</h3>
      {citations.map((c) => (
        <SourceCard key={c.id} citation={c} />
      ))}
    </section>
  );
}

function SourceCard({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  return (
    <div id={`source-${citation.id}`} className="rounded-xl border border-line bg-surface px-4 py-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-brand px-1.5 py-0.5 text-xs font-bold text-white">
          {citation.id}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{citation.articleTitle}</p>
          <p className="text-xs text-ink-soft">
            {vehicleName(citation.vehicleId)} · {citation.sectionHeading}
          </p>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-1 text-xs font-medium text-brand hover:underline"
            data-testid="expand-excerpt"
          >
            {open ? "הסתר ציטוט" : "הצג ציטוט מקורי"}
          </button>
          {open && (
            <blockquote
              className="mt-2 border-r-2 border-brand/30 bg-surface-muted px-3 py-2 text-sm leading-6 text-ink-soft"
              data-testid="excerpt"
            >
              {citation.excerpt}
              <a
                href={citation.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block text-xs font-medium text-brand hover:underline"
              >
                למאמר המלא ↗
              </a>
            </blockquote>
          )}
        </div>
      </div>
    </div>
  );
}
