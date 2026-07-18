// Loads the shared, language-agnostic catalogs committed under repo-root `data/`.
// These are the single source of truth for deterministic vehicle/aspect resolution
// (spec §11.2 vehicle catalog, §11.5 aspect vocabulary) and are shared with the Python
// offline pipeline.
import aspectData from "../../../data/aspect_lexicon.json";
import vehicleData from "../../../data/vehicle_catalog.json";
import type { Aspect } from "./types";

export interface Vehicle {
  vehicleId: string;
  canonicalName: string;
  aliases: string[];
}

export function loadVehicleCatalog(): Vehicle[] {
  return vehicleData.vehicles.map((v) => ({
    vehicleId: v.vehicle_id,
    canonicalName: v.canonical_name,
    aliases: v.aliases,
  }));
}

export function loadAspectLexicon(): Record<Aspect, string[]> {
  return aspectData.aspects as Record<Aspect, string[]>;
}
