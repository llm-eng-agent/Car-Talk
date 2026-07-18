"use client";

// The live view of short-term memory (spec §16 / §19.5 preference panel). Reads the canonical
// SessionState the server returned on the last turn — priorities, hard constraints, usage
// patterns, and the active vehicles the follow-up path remembers.
import type { SessionState } from "@/lib/generation/session";
import {
  POWERTRAIN_LABELS,
  TRANSMISSION_LABELS,
  USAGE_PATTERN_LABELS,
  aspectLabel,
  vehicleName,
} from "@/lib/ui/labels";

export function PreferencePanel({ session }: { session: SessionState }) {
  const { preferences: p, activeVehicleIds } = session;
  const constraints: string[] = [];
  if (p.constraints.minimumSeats !== undefined) constraints.push(`לפחות ${p.constraints.minimumSeats} מושבים`);
  if (p.constraints.allowedPowertrains?.length)
    constraints.push(`הנעה: ${p.constraints.allowedPowertrains.map((t) => POWERTRAIN_LABELS[t] ?? t).join(" / ")}`);
  if (p.constraints.transmission)
    constraints.push(`תיבה: ${TRANSMISSION_LABELS[p.constraints.transmission] ?? p.constraints.transmission}`);

  const empty =
    p.priorities.length === 0 &&
    constraints.length === 0 &&
    p.usagePatterns.length === 0 &&
    activeVehicleIds.length === 0;

  return (
    <aside
      className="rounded-2xl border border-line bg-surface p-4 text-sm text-ink"
      data-testid="preference-panel"
    >
      <h2 className="mb-3 font-bold text-brand">מה שאני זוכר עליך</h2>
      {empty ? (
        <p className="text-ink-soft">עדיין לא ציינת העדפות. ספר לי מה חשוב לך ברכב.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {activeVehicleIds.length > 0 && (
            <Group title="רכבים בשיחה">
              {activeVehicleIds.map((id) => (
                <Chip key={id}>{vehicleName(id)}</Chip>
              ))}
            </Group>
          )}
          {p.priorities.length > 0 && (
            <Group title="סדר עדיפויות">
              {p.priorities.map((a, i) => (
                <Chip key={a}>
                  {i + 1}. {aspectLabel(a)}
                </Chip>
              ))}
            </Group>
          )}
          {constraints.length > 0 && (
            <Group title="אילוצים">
              {constraints.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </Group>
          )}
          {p.usagePatterns.length > 0 && (
            <Group title="שימוש">
              {p.usagePatterns.map((u) => (
                <Chip key={u}>{USAGE_PATTERN_LABELS[u] ?? u}</Chip>
              ))}
            </Group>
          )}
        </div>
      )}
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold text-ink-soft">{title}</h3>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand">{children}</span>;
}
