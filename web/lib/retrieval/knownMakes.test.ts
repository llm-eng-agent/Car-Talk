import { describe, expect, it } from "vitest";
import { detectOutOfCorpusMake } from "./knownMakes";

describe("detectOutOfCorpusMake", () => {
  it("detects an out-of-corpus make named in Hebrew", () => {
    expect(detectOutOfCorpusMake("האם כדאי לקנות טויוטה קורולה 2026?")).toBe("Toyota");
  });

  it("detects an out-of-corpus make named in English", () => {
    expect(detectOutOfCorpusMake("is the BMW worth it?")).toBe("BMW");
  });

  it("tolerates an attached Hebrew prefix", () => {
    expect(detectOutOfCorpusMake("מה דעתך על המרצדס?")).toBe("Mercedes-Benz");
  });

  it("returns null for a genuine open recommendation with no make", () => {
    expect(detectOutOfCorpusMake("אני מחפש SUV חשמלי משפחתי עם טווח טוב. מה מומלץ?")).toBeNull();
  });

  it("returns null for an in-corpus make (it resolves via the catalog instead)", () => {
    expect(detectOutOfCorpusMake("ספר לי על סיטרואן C3")).toBeNull();
    expect(detectOutOfCorpusMake("מה עם יונדאי אלנטרה?")).toBeNull();
  });
});
