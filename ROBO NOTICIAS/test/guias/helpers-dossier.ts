import type { SteamAchievement } from "../../src/guias/dossier.js";
import type { ExtractedFacts } from "../../src/guias/facts.js";
import type { SourceRole } from "../../src/guias/sources.js";

type Item = ExtractedFacts["chapters"][number]["items"][number];

export const steamAch = (apiName: string, name: string, description: string | null, hidden = false): SteamAchievement => ({
  platform: "steam",
  apiName,
  name,
  description,
  globalPct: 10,
  hidden,
  namePt: null,
  descriptionPt: null,
});

export const item = (name: string, extra: Partial<Item> = {}): Item => ({
  kind: "collectible",
  name,
  location: "perto da entrada",
  missable: false,
  returnLater: false,
  countsForEn: [],
  ...extra,
});

export function fact(
  name: string,
  role: SourceRole,
  extra: Partial<Omit<ExtractedFacts, "source">> = {},
  url = `https://example.com/${name.toLowerCase()}`,
): ExtractedFacts {
  return {
    chapters: [],
    achievements: [],
    platform: role === "roteiro_steam" ? "steam" : role === "roteiro_psn" ? "psn" : "unknown",
    complete: true,
    ...extra,
    source: { name, url, role },
  };
}

export const ach = (nameEn: string, extra: Partial<ExtractedFacts["achievements"][number]> = {}) => ({
  nameEn,
  howTo: `Como conseguir ${nameEn}.`,
  missable: false,
  bugged: false,
  online: false,
  ...extra,
});

export const chapter = (title: string, items: Item[], order = 1) => ({ title, order, items });
