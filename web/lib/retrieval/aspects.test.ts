import { describe, expect, it } from "vitest";
import { resolveAspects } from "./aspects";

describe("resolveAspects", () => {
  it("maps Hebrew keywords to aspects", () => {
    expect(resolveAspects("מה הטווח והטעינה?")).toEqual(["efficiency_range"]);
    expect(resolveAspects("כמה זה עולה? מה התמורה למחיר?")).toEqual(["value_for_money"]);
  });

  it("maps English keywords too", () => {
    expect(resolveAspects("what is the range and charging?")).toEqual(["efficiency_range"]);
  });

  it("returns empty when no aspect keyword is present", () => {
    expect(resolveAspects("ספר לי על הרכב")).toEqual([]);
  });

  it("keeps the user's stated order and caps at the first three", () => {
    const many = "מחיר, ביצועים, טווח, בטיחות, עיצוב, נוחות";
    expect(resolveAspects(many)).toEqual([
      "value_for_money",
      "performance",
      "efficiency_range",
    ]);
  });
});
