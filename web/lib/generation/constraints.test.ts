import { describe, expect, it } from "vitest";
import { parseConstraints } from "./constraints";

describe("parseConstraints", () => {
  it("parses an explicit seat count (digit)", () => {
    expect(parseConstraints("אני צריך רכב עם 7 מקומות")).toEqual({ minimumSeats: 7 });
  });

  it("parses a Hebrew number word for seats", () => {
    expect(parseConstraints("שבעה מושבים בבקשה")).toEqual({ minimumSeats: 7 });
  });

  it("treats three rows as a seven-seat requirement", () => {
    expect(parseConstraints("SUV עם שלוש שורות ישיבה")).toEqual({ minimumSeats: 7 });
  });

  it("parses powertrains (in the canonical order)", () => {
    expect(parseConstraints("היברידי או בנזין")).toEqual({ allowedPowertrains: ["hybrid", "gasoline"] });
    expect(parseConstraints("רכב חשמלי")).toEqual({ allowedPowertrains: ["electric"] });
  });

  it("parses transmission", () => {
    expect(parseConstraints("עם תיבה ידנית")).toEqual({ transmission: "manual" });
    expect(parseConstraints("automatic please")).toEqual({ transmission: "automatic" });
  });

  it("combines multiple explicit constraints", () => {
    expect(parseConstraints("SUV חשמלי עם 7 מקומות ותיבה אוטומטית")).toEqual({
      minimumSeats: 7,
      allowedPowertrains: ["electric"],
      transmission: "automatic",
    });
  });

  it("returns nothing when no constraint is explicitly stated (never inferred)", () => {
    expect(parseConstraints("אני מחפש רכב משפחתי נחמד")).toEqual({});
  });
});
