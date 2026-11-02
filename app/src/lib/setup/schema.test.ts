import { describe, expect, it } from "vitest";
import {
  groupPlatforms,
  orderPlatformIds,
  PC_FIELDS,
  platformMatches,
  SETUP_FAMILIES,
  SETUP_PLATFORMS,
  setupPlatform,
  SPEC_MAX,
} from "./catalog";
import { cleanSpecText, playerSetupSchema, readPcSpecs } from "./schema";

const emptyPc = () => Object.fromEntries(PC_FIELDS.map(({ key }) => [key, ""]));

describe("setup catalog", () => {
  it("has unique, storage-safe ids and only known families", () => {
    const ids = SETUP_PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{2,20}$/);
    const families = new Set(SETUP_FAMILIES.map((f) => f.id));
    for (const p of SETUP_PLATFORMS) expect(families.has(p.family)).toBe(true);
    // Every family has platforms, and the list is grouped (a family's platforms are contiguous).
    expect(groupPlatforms(SETUP_PLATFORMS).flatMap((g) => g.platforms)).toEqual(SETUP_PLATFORMS);
    expect(groupPlatforms(SETUP_PLATFORMS)).toHaveLength(SETUP_FAMILIES.length);
  });

  it("covers the platforms asked for", () => {
    for (const id of ["ps1", "ps5", "ps5pro", "psp", "psvita", "psportal", "xbox", "xboxseriesx", "nes", "switch2", "gba", "pc", "steamdeck", "rogally", "legiongo", "ios", "android", "megadrive", "atari2600", "anbernic"]) {
      expect(setupPlatform(id), id).toBeDefined();
    }
  });

  it("orders ids by the catalog, without repeats or unknown ids", () => {
    expect(orderPlatformIds(["switch", "ps5", "nada", "ps1", "ps5"])).toEqual(["ps1", "ps5", "switch"]);
  });

  it("search ignores case, accents and punctuation and looks at codes, aliases and family", () => {
    const find = (q: string) => SETUP_PLATFORMS.filter((p) => platformMatches(p, q)).map((p) => p.id);
    expect(find("nintendinho")).toEqual(["nes"]);
    expect(find("MEGADRIVE")).toEqual(["megadrive"]);
    expect(find("genesis")).toEqual(["megadrive"]);
    expect(find("series x")).toContain("xboxseriesx");
    expect(find("Retrô")).toContain("anbernic");
    expect(find("")).toHaveLength(SETUP_PLATFORMS.length);
    expect(find("zzzz")).toEqual([]);
  });
});

describe("cleanSpecText", () => {
  it("makes one trimmed line without control or invisible characters", () => {
    expect(cleanSpecText("  RTX\t4070\n\nSuper  ")).toBe("RTX 4070 Super");
    expect(cleanSpecText("Ryzen​ 7‮ 7800X3D\u0000")).toBe("Ryzen 7 7800X3D");
  });
});

describe("playerSetupSchema", () => {
  it("accepts known platforms (ordered, deduplicated) and keeps only filled spec fields", () => {
    const parsed = playerSetupSchema.parse({
      platforms: ["switch", "ps5", "switch"],
      pc: { ...emptyPc(), gpu: "  RTX 4070  ", ram: "32 GB\nDDR5", mouse: "   " },
    });
    expect(parsed).toEqual({ platforms: ["ps5", "switch"], pc: { gpu: "RTX 4070", ram: "32 GB DDR5" } });
  });

  it("an empty form is an empty setup", () => {
    expect(playerSetupSchema.parse({ platforms: [], pc: emptyPc() })).toEqual({ platforms: [], pc: null });
    expect(playerSetupSchema.parse({ platforms: [], pc: null })).toEqual({ platforms: [], pc: null });
    expect(playerSetupSchema.parse({ platforms: [], pc: {} })).toEqual({ platforms: [], pc: null });
  });

  it("refuses unknown platforms, unknown spec fields and extra keys", () => {
    expect(playerSetupSchema.safeParse({ platforms: ["ps9"], pc: null }).success).toBe(false);
    expect(playerSetupSchema.safeParse({ platforms: ["ps5"], pc: { cpu: "x", chair: "DXRacer" } }).success).toBe(false);
    expect(playerSetupSchema.safeParse({ platforms: [], pc: null, userId: "u2" }).success).toBe(false);
    expect(playerSetupSchema.safeParse({ platforms: "ps5", pc: null }).success).toBe(false);
    expect(playerSetupSchema.safeParse({ platforms: [], pc: { cpu: 7800 } }).success).toBe(false);
    expect(playerSetupSchema.safeParse(null).success).toBe(false);
  });

  it("refuses HTML and values over the limit, naming the field", () => {
    const html = playerSetupSchema.safeParse({ platforms: [], pc: { gpu: "<img src=x onerror=alert(1)>" } });
    expect(html.success).toBe(false);
    expect(html.error?.issues[0]).toMatchObject({ path: ["pc", "gpu"], message: expect.stringMatching(/^Placa de vídeo: HTML/) });

    const long = playerSetupSchema.safeParse({ platforms: [], pc: { cpu: "a".repeat(SPEC_MAX + 1) } });
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]).toMatchObject({ path: ["pc", "cpu"], message: `Processador: no máximo ${SPEC_MAX} caracteres.` });

    // Exactly the limit is fine, and so is a lone "<" (e.g. "< 5 W").
    expect(playerSetupSchema.safeParse({ platforms: [], pc: { cpu: "a".repeat(SPEC_MAX), psu: "ruído < 20 dB" } }).success).toBe(true);
    // A huge payload is refused before cleanup.
    expect(playerSetupSchema.safeParse({ platforms: [], pc: { cpu: " ".repeat(10_000) } }).success).toBe(false);
  });

  it("refuses more ids than the catalog has", () => {
    const tooMany = Array.from({ length: SETUP_PLATFORMS.length + 1 }, () => "ps5");
    expect(playerSetupSchema.safeParse({ platforms: tooMany, pc: null }).success).toBe(false);
  });
});

describe("readPcSpecs", () => {
  it("keeps valid known fields and drops everything else", () => {
    expect(readPcSpecs({ cpu: " Ryzen 5 ", chair: "x", gpu: 3, ram: "<b>32</b>", mouse: "" })).toEqual({ cpu: "Ryzen 5" });
    expect(readPcSpecs({})).toBeNull();
    expect(readPcSpecs(null)).toBeNull();
    expect(readPcSpecs(["cpu"])).toBeNull();
    expect(readPcSpecs("cpu")).toBeNull();
  });
});
