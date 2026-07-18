import { expect, test, type Page, type Route } from "@playwright/test";
import type { AnswerResult } from "@/lib/generation/answer";
import type { Citation } from "@/lib/generation/citations";
import type { SessionState } from "@/lib/generation/session";

// Drives the spec §28 Final Acceptance Scenario end-to-end through the real UI, with /api/chat
// mocked so the run is deterministic and makes no paid API calls (spec §27A). The fixtures below
// stand in for the pipeline's output; the assertions check that each Phase-9 DoD behavior renders.

function cite(id: string, vehicleId: string, title: string): Citation {
  return {
    id,
    chunkId: `${vehicleId}::b1::c1`,
    vehicleId,
    articleTitle: title,
    sectionHeading: "מרחב ונוחות",
    sourceUrl: "https://www.auto.co.il/example",
    excerpt: `קטע ראיה מתוך הביקורת על ${title} — טקסט מקורי שמגבה את הטענה.`,
  };
}

const EMPTY: SessionState = {
  activeVehicleIds: [],
  comparisonVehicleIds: [],
  preferences: { priorities: [], constraints: {}, usagePatterns: [] },
  recentTurns: [],
  inferredCounts: {},
};

// Turn 1 — family recommendation: stores priorities + usage, proposes candidates.
const TURN1: AnswerResult = {
  status: "partial",
  mode: "recommendation",
  citations: [cite("C1", "kia_ev9", "מבחן דרך קיה EV9"), cite("C2", "genesis_gv80", "מבחן דרך ג'נסיס GV80")],
  recommendation: {
    decision: null,
    decisionRule: "none",
    reason: "שלושה רכבים משפחתיים מתאימים; הבחירה תלויה בהעדפה בין מרחב לנוחות.",
    eliminated: [],
    tradeOff: true,
    followUpQuestion: "כמה מקומות ישיבה חשובים לך?",
  },
  output: {
    status: "partial",
    mode: "recommendation",
    overview: { text: "על סמך הצורך במרחב ונוחות למשפחה, הנה מועמדים מבוססי-ביקורת.", citation_ids: ["C1", "C2"] },
    aspect_assessments: [
      { aspect: "space_practicality", assessment: "positive", winner_vehicle_id: null, explanation: "תא מטען גדול ומרחב לשלושה מושבי בטיחות.", citation_ids: ["C1"] },
    ],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: "כמה מקומות ישיבה חשובים לך?",
  },
  session: {
    ...EMPTY,
    activeVehicleIds: ["kia_ev9", "genesis_gv80"],
    preferences: { priorities: ["space_practicality", "ride_comfort"], constraints: {}, usagePatterns: ["family_with_children"] },
  },
};

// Turn 2 — comparison with no universal winner (trade-off).
const TURN2: AnswerResult = {
  status: "complete",
  mode: "comparison",
  citations: [cite("C1", "kia_ev9", "מבחן דרך קיה EV9"), cite("C2", "genesis_gv80", "מבחן דרך ג'נסיס GV80")],
  recommendation: {
    decision: null,
    decisionRule: "none",
    reason: "לכל רכב יתרון באספקט אחר — אין מנצח גורף.",
    eliminated: [],
    tradeOff: true,
    followUpQuestion: null,
  },
  output: {
    status: "complete",
    mode: "comparison",
    overview: { text: "השוואה מאוזנת בין EV9 ל-GV80 על סמך שתי הביקורות.", citation_ids: ["C1", "C2"] },
    aspect_assessments: [
      { aspect: "space_practicality", assessment: "vehicle_advantage", winner_vehicle_id: "kia_ev9", explanation: "מרחב פנימי גדול יותר.", citation_ids: ["C1"] },
      { aspect: "interior_quality", assessment: "vehicle_advantage", winner_vehicle_id: "genesis_gv80", explanation: "גימור פנים יוקרתי יותר.", citation_ids: ["C2"] },
    ],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: null,
  },
  session: {
    ...EMPTY,
    activeVehicleIds: ["kia_ev9", "genesis_gv80"],
    comparisonVehicleIds: ["kia_ev9", "genesis_gv80"],
    preferences: { priorities: ["space_practicality", "ride_comfort"], constraints: {}, usagePatterns: ["family_with_children"] },
  },
};

// Turn 3 — follow-up: remembers both vehicles + priority order, adds long-trips usage.
const TURN3: AnswerResult = {
  status: "complete",
  mode: "comparison",
  citations: [cite("C1", "kia_ev9", "מבחן דרך קיה EV9"), cite("C2", "genesis_gv80", "מבחן דרך ג'נסיס GV80")],
  output: {
    status: "complete",
    mode: "comparison",
    overview: { text: "בנסיעות ארוכות שני הרכבים מציעים נוחות טובה, עם הבדלים קלים.", citation_ids: ["C1", "C2"] },
    aspect_assessments: [
      { aspect: "ride_comfort", assessment: "tie", winner_vehicle_id: null, explanation: "שניהם שקטים ונוחים בכביש פתוח.", citation_ids: ["C1", "C2"] },
    ],
    constraint_assessments: [],
    missing_information: [],
    preference_updates: [],
    usage_pattern_updates: [],
    follow_up_question: null,
  },
  session: {
    ...EMPTY,
    activeVehicleIds: ["kia_ev9", "genesis_gv80"],
    comparisonVehicleIds: ["kia_ev9", "genesis_gv80"],
    preferences: { priorities: ["space_practicality", "ride_comfort"], constraints: {}, usagePatterns: ["family_with_children", "long_trips"] },
  },
};

// Turn 4 — insufficient evidence: abstains, no invented answer.
const TURN4: AnswerResult = {
  status: "insufficient_evidence",
  mode: null,
  citations: [],
  message: "הביקורות במאגר אינן מספקות מספיק מידע על אמינות לאורך חמש שנים, ולכן לא אענה מתוך ידע כללי.",
  session: TURN3.session,
};

async function mockChat(page: Page): Promise<void> {
  await page.route("**/api/chat", async (route: Route) => {
    const message = (route.request().postDataJSON() as { message: string }).message;
    const reply = message.includes("משפחתי")
      ? TURN1
      : message.includes("השווה")
        ? TURN2
        : message.includes("ארוכות")
          ? TURN3
          : TURN4;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("send").click();
}

test("§28 acceptance conversation renders every Phase-9 behavior", async ({ page }) => {
  await mockChat(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /מה תרצו לדעת/ })).toBeVisible();

  // Turn 1 — recommendation: preferences stored, candidates proposed.
  await ask(page, "אני מחפש רכב משפחתי לשלושה ילדים, נוחות ומרחב חשובים לי מביצועים");
  await expect(page.getByTestId("recommendation")).toBeVisible();
  const panel = page.getByTestId("preference-panel");
  await expect(panel).toContainText("משפחה עם ילדים");
  await expect(panel).toContainText("מרחב ופרקטיות");

  // Turn 2 — comparison: balanced sources from both, no universal winner (trade-off).
  await ask(page, "השווה בין ה-EV9 ל-GV80");
  const sources = page.getByTestId("sources").last();
  await expect(sources.getByTestId("expand-excerpt")).toHaveCount(2);
  await expect(page.getByTestId("tradeoff-badge").last()).toBeVisible();

  // Expand original evidence (§19.5).
  await sources.getByTestId("expand-excerpt").first().click();
  await expect(sources.getByTestId("excerpt").first()).toBeVisible();

  // Turn 3 — follow-up: memory keeps both active vehicles + adds long-trips usage.
  await ask(page, "מה לגבי הנוחות שלהם בנסיעות ארוכות?");
  await expect(panel).toContainText("Kia EV9");
  await expect(panel).toContainText("Genesis GV80");
  await expect(panel).toContainText("נסיעות ארוכות");

  // Turn 4 — insufficient evidence: explicit abstention, no fabricated answer.
  await ask(page, "מי מהם אמין יותר אחרי חמש שנים?");
  await expect(page.getByTestId("terminal-message").last()).toContainText("אינן מספקות מספיק מידע");

  // Reset conversation: memory and messages cleared.
  await page.getByTestId("new-conversation").click();
  await expect(page.getByRole("heading", { name: /מה תרצו לדעת/ })).toBeVisible();
  await expect(panel).toContainText("עדיין לא ציינת העדפות");
});
