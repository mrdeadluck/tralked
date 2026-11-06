import { describe, expect, it } from "vitest";
import { bandPlatforms, familyOfLabel, consolesOf, normalizeConsoleLabels } from "./platforms";

describe("familyOfLabel", () => {
  it("reads family keys and the labels the platform syncs write", () => {
    expect(familyOfLabel("PC")).toBe("PC");
    expect(familyOfLabel("PS5")).toBe("PLAYSTATION");
    expect(familyOfLabel("Xbox One")).toBe("XBOX");
    expect(familyOfLabel("SNES")).toBe("NINTENDO");
    expect(familyOfLabel("Mega Drive")).toBeNull();
  });
});

describe("bandPlatforms", () => {
  it("gives a lone platform its full name", () => {
    expect(bandPlatforms(["PC"])).toEqual([{ platform: "PC", label: "PC · Steam" }]);
    expect(bandPlatforms(["PS5", "PS4"])).toEqual([{ platform: "PLAYSTATION", label: "PlayStation" }]);
  });

  it("orders the families like the filters and shortens names when they would not fit", () => {
    expect(bandPlatforms(["XBOX", "PC"]).map((b) => b.label)).toEqual(["PC", "Xbox"]);
    expect(bandPlatforms(["PLAYSTATION", "PC"]).map((b) => b.label)).toEqual(["PC", "PS"]);
    expect(bandPlatforms(["NINTENDO", "XBOX"]).map((b) => b.label)).toEqual(["Xbox", "NIN"]);
    expect(bandPlatforms(["NINTENDO", "XBOX", "PLAYSTATION", "PC"]).map((b) => b.label)).toEqual([
      "PC",
      "PS",
      "Xbox",
      "NIN",
    ]);
  });

  it("counts consoles of no known family as Retrô, and nothing as no band", () => {
    expect(bandPlatforms(["Mega Drive"])).toEqual([{ platform: "RETRO", label: "Retrô" }]);
    expect(bandPlatforms(["Retro", "Mega Drive"])).toHaveLength(1);
    expect(bandPlatforms([])).toEqual([]);
  });
});

describe("console slugs", () => {
  it("maps IGDB platform ids to sorted console slugs, dropping unknown ids", () => {
    expect(consolesOf([167, 48, 6, 99999, 48])).toEqual(["pc", "ps4", "ps5"]);
    expect(consolesOf([169, 49, 12, 46])).toEqual(["psvita", "series-x-s", "xbox360", "xboxone"]);
  });

  it("normalizes console labels into families plus consoles", () => {
    expect(normalizeConsoleLabels(["PS4"])).toEqual({ platforms: ["PLAYSTATION"], consoles: ["ps4"] });
    expect(normalizeConsoleLabels(["PSVITA", "PC"])).toEqual({ platforms: ["PC", "PLAYSTATION"], consoles: ["psvita"] });
    expect(normalizeConsoleLabels(["Xbox"])).toEqual({ platforms: ["XBOX"], consoles: [] });
    expect(normalizeConsoleLabels(["Xbox 360"])).toEqual({ platforms: ["XBOX"], consoles: ["xbox360"] });
    // Already families, retro labels and unknown labels are left alone.
    expect(normalizeConsoleLabels(["PLAYSTATION", "PC"])).toBeNull();
    expect(normalizeConsoleLabels(["Mega Drive"])).toBeNull();
    expect(normalizeConsoleLabels(["Mega Drive", "PS5"])).toEqual({ platforms: ["Mega Drive", "PLAYSTATION"], consoles: ["ps5"] });
  });
});
