import { describe, expect, it } from "vitest";
import { bandPlatforms, familyOfLabel } from "./platforms";

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

  it("orders the families like the filters and shortens names as more share the band", () => {
    expect(bandPlatforms(["XBOX", "PC"]).map((b) => b.label)).toEqual(["PC", "Xbox"]);
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
