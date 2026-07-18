import { describe, expect, it } from "vitest";
import { normalize } from "./normalize";

describe("normalize", () => {
  it("lowercases Latin and collapses whitespace", () => {
    expect(normalize("  MG   S6  ")).toBe("mg s6");
  });

  it("turns punctuation and symbols into token boundaries", () => {
    expect(normalize("Lynk & Co 01")).toBe("lynk co 01");
    expect(normalize("ג'נסיס GV80")).toBe("ג נסיס gv80");
    expect(normalize("הוט-האצ'")).toBe("הוט האצ");
  });

  it("is idempotent and stable under NFKC", () => {
    const once = normalize("אאודי RS3");
    expect(normalize(once)).toBe(once);
  });
});
