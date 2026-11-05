import { describe, expect, it } from "vitest";
import {
  canonicalList,
  noteTargetIds,
  psnConsoleCode,
  regionLabels,
  regionOf,
  versionKey,
  versionLabel,
  xboxConsoleOf,
} from "./lists";

const at = (s: string) => new Date(`2026-01-0${s}T00:00:00Z`);

describe("psnConsoleCode", () => {
  it("joins in a fixed order", () => {
    expect(psnConsoleCode("PS3,PSVITA")).toBe("PS3+PSVITA");
    expect(psnConsoleCode("PS5,PS4")).toBe("PS4+PS5");
    expect(psnConsoleCode("PS5")).toBe("PS5");
    expect(psnConsoleCode("")).toBeNull();
  });
});

describe("xboxConsoleOf", () => {
  it("maps devices", () => {
    expect(xboxConsoleOf(["Xbox360"])).toBe("360");
    expect(xboxConsoleOf(["XboxSeries", "PC"])).toBe("ONE");
    expect(xboxConsoleOf(["XboxOne"])).toBe("ONE");
    expect(xboxConsoleOf(["Win32"])).toBe("PC");
    expect(xboxConsoleOf(["PC"])).toBe("PC");
    expect(xboxConsoleOf(["Mobile"])).toBeNull();
  });
});

describe("regionOf", () => {
  it("detects scripts", () => {
    expect(regionOf("グランド・セフト・オートV")).toBe("jp");
    expect(regionOf("그랜드 테프트 오토 V")).toBe("kr");
    expect(regionOf("Grand Theft Auto V")).toBeNull();
    expect(regionOf("三國志 한글")).toBe("kr");
    expect(regionOf("真・三國無双")).toBe("jp");
  });
});

describe("versionKey / versionLabel", () => {
  it("builds keys", () => {
    expect(versionKey({ platform: "psn", console: "PS5", externalId: "NPWR1" })).toBe("psn:PS5");
    expect(versionKey({ platform: "psn", console: null, externalId: "NPWR1" })).toBe("psn:NPWR1");
    expect(versionKey({ platform: "steam", console: "PC", externalId: "10" })).toBe("steam");
    expect(versionKey({ platform: "xbox", console: "ONE", externalId: "123" })).toBe("xbox:123");
    expect(versionKey({ platform: "retro", console: "SNES", externalId: "9" })).toBe("retro:9");
  });
  it("builds labels", () => {
    expect(versionLabel({ platform: "psn", console: "PS3+PSVITA" })).toBe("PS3 · Vita");
    expect(versionLabel({ platform: "psn", console: "PS4+PS5+PSPC" })).toBe("PS4 · PS5 · PC");
    expect(versionLabel({ platform: "psn", console: null })).toBe("PlayStation");
    expect(versionLabel({ platform: "steam", console: "PC" })).toBe("PC · Steam");
    expect(versionLabel({ platform: "xbox", console: "360" })).toBe("Xbox 360");
    expect(versionLabel({ platform: "xbox", console: "ONE" })).toBe("Xbox One/Series");
    expect(versionLabel({ platform: "xbox", console: "PC" })).toBe("Xbox PC");
    expect(versionLabel({ platform: "xbox", console: null })).toBe("Xbox");
    expect(versionLabel({ platform: "retro", console: "SNES" })).toBe("SNES");
    expect(versionLabel({ platform: "retro", console: null })).toBe("Retro");
  });
});

describe("regionLabels", () => {
  it("numbers lists without region by creation", () => {
    const m = regionLabels([
      { id: "b", region: null, createdAt: at("2"), externalId: "B" },
      { id: "a", region: null, createdAt: at("1"), externalId: "A" },
    ]);
    expect(m.get("a")).toBe("Lista 1");
    expect(m.get("b")).toBe("Lista 2");
  });
  it("ties break by externalId", () => {
    const m = regionLabels([
      { id: "b", region: null, createdAt: at("1"), externalId: "B" },
      { id: "a", region: null, createdAt: at("1"), externalId: "A" },
    ]);
    expect(m.get("a")).toBe("Lista 1");
  });
  it("a single list has no label", () => {
    expect(regionLabels([{ id: "a", region: null, createdAt: at("1"), externalId: "A" }]).get("a")).toBeNull();
    expect(regionLabels([{ id: "a", region: "jp", createdAt: at("1"), externalId: "A" }]).get("a")).toBeNull();
  });
  it("mixes Asian and unlabeled", () => {
    const m = regionLabels([
      { id: "a", region: null, createdAt: at("1"), externalId: "A" },
      { id: "j", region: "jp", createdAt: at("2"), externalId: "J" },
      { id: "k", region: "kr", createdAt: at("3"), externalId: "K" },
    ]);
    expect(m.get("a")).toBe("Lista 1");
    expect(m.get("j")).toBe("🇯🇵 Ásia");
    expect(m.get("k")).toBe("🇰🇷 Ásia");
  });
});

describe("canonicalList", () => {
  it("picks the oldest, ties by externalId", () => {
    const l = [
      { createdAt: at("2"), externalId: "A" },
      { createdAt: at("1"), externalId: "C" },
      { createdAt: at("1"), externalId: "B" },
    ];
    expect(canonicalList(l).externalId).toBe("B");
  });
  it("throws on an empty version", () => {
    expect(() => canonicalList([])).toThrow(/at least one list/);
  });
});

describe("noteTargetIds", () => {
  it("prefers the canonical list's row of each trophy; list-less rows last", () => {
    const rows = [
      { id: "steam-1", platform: "steam", apiName: "1", list: null },
      { id: "ps5-1", platform: "psn", apiName: "1", list: { createdAt: at("2"), externalId: "A" } },
      { id: "ps4-1", platform: "psn", apiName: "1", list: { createdAt: at("1"), externalId: "C" } },
      { id: "nolist-1", platform: "psn", apiName: "1", list: null },
      { id: "jp-1", platform: "psn", apiName: "1", list: { createdAt: at("1"), externalId: "B" } },
      // Only in a newer list, then only list-less.
      { id: "nolist-2", platform: "psn", apiName: "2", list: null },
      { id: "ps5-2", platform: "psn", apiName: "2", list: { createdAt: at("2"), externalId: "A" } },
      { id: "nolist-3", platform: "psn", apiName: "3", list: null },
    ];
    expect(Object.fromEntries(noteTargetIds(rows))).toEqual({
      "steam:1": "steam-1",
      "psn:1": "jp-1",
      "psn:2": "ps5-2",
      "psn:3": "nolist-3",
    });
  });
});
