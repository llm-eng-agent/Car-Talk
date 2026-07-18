import { expect, test, type Page, type Route } from "@playwright/test";
import type { AnswerResult } from "@/lib/generation/answer";
import type { SessionState } from "@/lib/generation/session";

// Regression tests for three code-review findings on the Phase-9 UI (PR #16): malformed stored
// session, cross-turn citation-anchor collisions, and stale responses surviving a reset.

const SESSION: SessionState = {
  activeVehicleIds: [],
  comparisonVehicleIds: [],
  preferences: { priorities: [], constraints: {}, usagePatterns: [] },
  recentTurns: [],
  inferredCounts: {},
};

// A minimal citation-bearing answer; ids restart at C1 every turn (the collision source).
function answerWithCitation(text: string): AnswerResult {
  return {
    status: "complete",
    mode: "single_vehicle",
    citations: [
      {
        id: "C1",
        chunkId: "mg_s6::b1::c1",
        vehicleId: "mg_s6",
        articleTitle: `מבחן דרך — ${text}`,
        sectionHeading: "סקירה",
        sourceUrl: "https://www.auto.co.il/x",
        excerpt: `קטע ראיה עבור ${text}.`,
      },
    ],
    output: {
      status: "complete",
      mode: "single_vehicle",
      overview: { text, citation_ids: ["C1"] },
      aspect_assessments: [],
      constraint_assessments: [],
      missing_information: [],
      preference_updates: [],
      usage_pattern_updates: [],
      follow_up_question: null,
    },
    session: SESSION,
  };
}

async function ask(page: Page, text: string): Promise<void> {
  await page.getByTestId("chat-input").fill(text);
  await page.getByTestId("send").click();
}

test("malformed stored session does not crash the page", async ({ page }) => {
  // Seed a parseable-but-invalid shape (e.g. a stale/tampered value) before the app loads.
  await page.addInitScript(() => {
    window.sessionStorage.setItem("car-talk:session", JSON.stringify({ preferences: "nope" }));
  });
  await page.route("**/api/chat", async (route: Route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answerWithCitation("תשובה")) });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /על הפרק/ })).toBeVisible();
  // Starting a turn renders the preference panel with the restored (sanitized) session — this is the
  // render that used to crash on the raw malformed value. It must render cleanly instead.
  await ask(page, "שאלה כלשהי");
  await expect(page.getByTestId("answer")).toBeVisible();
  await expect(page.getByTestId("preference-panel")).toBeVisible();
});

test("citation anchors are namespaced per turn (no cross-turn collision)", async ({ page }) => {
  await page.route("**/api/chat", async (route: Route) => {
    const message = (route.request().postDataJSON() as { message: string }).message;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(answerWithCitation(message)),
    });
  });
  await page.goto("/");
  await ask(page, "שאלה ראשונה");
  await expect(page.getByTestId("answer")).toHaveCount(1);
  await ask(page, "שאלה שנייה");
  await expect(page.getByTestId("answer")).toHaveCount(2);

  // Both turns emit a card for their own C1. The anchor ids must be distinct and namespaced —
  // never the bare `source-C1` that would let a later chip target an earlier card.
  const ids = await page.locator('[id^="source-"]').evaluateAll((els) => els.map((e) => e.id));
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  expect(ids.every((id) => /^source-\d+-C1$/.test(id))).toBe(true);
  await expect(page.locator("#source-C1")).toHaveCount(0);

  // A chip in the second answer points at its own card, not the first turn's.
  const secondHref = await page.getByTestId("answer").nth(1).locator('a[href^="#source-"]').first().getAttribute("href");
  const secondCardId = await page.getByTestId("answer").nth(1).locator('[id^="source-"]').first().getAttribute("id");
  expect(secondHref).toBe(`#${secondCardId}`);
});

test("a response in flight when reset is clicked is discarded", async ({ page }) => {
  await page.route("**/api/chat", async (route: Route) => {
    await new Promise((r) => setTimeout(r, 800)); // slow response
    try {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answerWithCitation("מאוחר")) });
    } catch {
      // The client aborts on reset; fulfilling an already-cancelled request is expected to throw.
    }
  });
  await page.goto("/");
  await ask(page, "שאלה שתיזרק");
  await page.getByTestId("new-conversation").click(); // reset before the 800ms response lands
  await page.waitForTimeout(1200); // let the stale response resolve

  await expect(page.getByTestId("answer")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /על הפרק/ })).toBeVisible();
  await expect(page.getByTestId("preference-panel")).toBeHidden();
});
