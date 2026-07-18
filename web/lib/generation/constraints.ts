// Deterministic hard-constraint parsing (spec §11.3, line 246). Hard constraints are accepted ONLY
// when explicitly stated and are NEVER inferred (line 250). Supports the three locked constraint
// types; budget is intentionally not a hard constraint in the POC (§247). Reuses the same
// normalize + phrasePresent primitives as the vehicle/aspect resolvers.
import { phrasePresent } from "../retrieval/matcher";
import { normalize } from "../retrieval/normalize";

export type Powertrain = "electric" | "hybrid" | "gasoline" | "diesel";
export type Transmission = "automatic" | "manual";

export interface ParsedConstraints {
  minimumSeats?: number;
  allowedPowertrains?: Powertrain[];
  transmission?: Transmission;
}

const POWERTRAIN_ALIASES: Record<Powertrain, string[]> = {
  electric: ["חשמלי", "חשמלית", "electric", "ev"],
  hybrid: ["היברידי", "היברידית", "hybrid"],
  gasoline: ["בנזין", "gasoline", "petrol"],
  diesel: ["דיזל", "diesel"],
};

const TRANSMISSION_ALIASES: Record<Transmission, string[]> = {
  automatic: ["אוטומט", "אוטומטי", "אוטומטית", "automatic"],
  manual: ["ידני", "ידנית", "manual"],
};

// Hebrew number words for an explicit seat count.
const HEB_NUMBERS: Record<string, number> = {
  חמישה: 5, חמש: 5, שישה: 6, שש: 6, שבעה: 7, שבע: 7, שמונה: 8,
};

export function parseConstraints(query: string): ParsedConstraints {
  const haystack = normalize(query);
  const constraints: ParsedConstraints = {};

  const seats = parseMinimumSeats(haystack);
  if (seats !== undefined) constraints.minimumSeats = seats;

  const powertrains = (Object.keys(POWERTRAIN_ALIASES) as Powertrain[]).filter((p) =>
    POWERTRAIN_ALIASES[p].some((alias) => aliasAllowed(haystack, alias)),
  );
  if (powertrains.length > 0) constraints.allowedPowertrains = powertrains;

  const transmission = (Object.keys(TRANSMISSION_ALIASES) as Transmission[]).find((t) =>
    TRANSMISSION_ALIASES[t].some((alias) => aliasAllowed(haystack, alias)),
  );
  if (transmission) constraints.transmission = transmission;

  return constraints;
}

const NEGATIONS = ["לא", "בלי", "ללא", "אין", "not", "no", "without"];
const HEB_PREFIX = "[והבלמשכ]{0,2}";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A powertrain/transmission alias counts only when present AND not negated: "לא דיזל" / "not diesel"
// must NOT add diesel to the allowed set (that would invert the user's hard constraint).
function aliasAllowed(haystack: string, alias: string): boolean {
  const norm = normalize(alias);
  return phrasePresent(haystack, norm) && !isNegated(haystack, norm);
}

// True when the alias is directly preceded by a negation word (Hebrew-prefix tolerant).
function isNegated(haystack: string, aliasNorm: string): boolean {
  const neg = NEGATIONS.map(escapeRegExp).join("|");
  const re = new RegExp(`(?:^|\\s)(?:${neg})\\s+${HEB_PREFIX}${escapeRegExp(aliasNorm)}(?=\\s|$)`, "u");
  return re.test(haystack);
}

function parseMinimumSeats(haystack: string): number | undefined {
  // "7 מקומות" / "7 seats"
  const digit = haystack.match(/(\d+)\s*(?:מקומות|מושבים|מושבי|seats|seater)/);
  if (digit) return Number(digit[1]);
  // "שבעה מקומות"
  const seatWord = /(מקומות|מושבים|seats)/.test(haystack);
  if (seatWord) {
    for (const [word, n] of Object.entries(HEB_NUMBERS)) {
      if (phrasePresent(haystack, word)) return n;
    }
  }
  // "שלוש שורות" / "three rows" → a three-row vehicle is an explicit seven-seat requirement.
  if (/(שלוש|שלושה|3|three)\s*שורות|three\s*rows/.test(haystack)) return 7;
  return undefined;
}
