import { describe, expect, it } from "vitest";
import { CORES, EMULATOR_VERSION, pickCore } from "./cores";

describe("pickCore", () => {
  it("runs PS1 on Beetle PSX HW when the user has a valid BIOS", () => {
    expect(pickCore("psx", true)).toBe("mednafen_psx_hw");
  });

  it("falls back to PCSX ReARMed for PS1 without a valid BIOS", () => {
    expect(pickCore("psx", false)).toBe("pcsx_rearmed");
  });

  it("runs SNES on bsnes, which needs no BIOS", () => {
    expect(pickCore("snes", false)).toBe("bsnes");
    expect(pickCore("snes", true)).toBe("bsnes");
  });
});

describe("CORES", () => {
  it("never accepts archives as SNES images", () => {
    expect(CORES.snes.extensions).toEqual(["sfc", "smc"]);
    expect(CORES.snes.extensions).not.toContain("zip");
  });

  it("lists the PS1 disc formats and requires a BIOS for the primary core", () => {
    expect(CORES.psx).toEqual({
      primary: "mednafen_psx_hw",
      fallback: "pcsx_rearmed",
      extensions: ["cue", "bin", "iso", "chd", "pbp"],
      needsBios: true,
    });
  });
});

describe("EMULATOR_VERSION", () => {
  it("names the pinned EmulatorJS release folder", () => {
    expect(EMULATOR_VERSION).toBe("4.3.0-pre");
  });
});
