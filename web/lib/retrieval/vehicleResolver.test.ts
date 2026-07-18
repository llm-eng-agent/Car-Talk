import { describe, expect, it } from "vitest";
import { resolveVehicles } from "./vehicleResolver";

describe("resolveVehicles", () => {
  it("resolves a Hebrew single-vehicle mention", () => {
    expect(resolveVehicles("מה הטווח של איון HT?")).toEqual(["aion_ht"]);
    expect(resolveVehicles("כמה עולה ג'נסיס GV80?")).toEqual(["genesis_gv80"]);
  });

  it("resolves multi-word Hebrew aliases", () => {
    expect(resolveVehicles("למה המחיר של לינק אנד קו 01 ירד?")).toEqual(["lynk_co_01"]);
    expect(resolveVehicles("יונדאי אלנטרה N עם תיבה ידנית")).toEqual(["hyundai_elantra_n_manual"]);
  });

  it("resolves both vehicles in a comparison", () => {
    expect(new Set(resolveVehicles("מה עדיף, MG S6 או איון HT?"))).toEqual(
      new Set(["mg_s6", "aion_ht"]),
    );
    expect(new Set(resolveVehicles("אאודי RS3 או יונדאי אלנטרה N?"))).toEqual(
      new Set(["audi_rs3", "hyundai_elantra_n_manual"]),
    );
  });

  it("returns no vehicle for an un-named recommendation query", () => {
    expect(resolveVehicles("אני מחפש רכב עירוני קטן וזול. מה מומלץ?")).toEqual([]);
  });

  it("returns no vehicle for an out-of-corpus mention", () => {
    expect(resolveVehicles("האם כדאי לקנות טויוטה קורולה 2026?")).toEqual([]);
  });

  it("does not false-match an alias inside another word", () => {
    // "מגניב" contains the letters of "MG" transliterations but is not the token "mg".
    expect(resolveVehicles("זה רכב מגניב")).toEqual([]);
  });
});
