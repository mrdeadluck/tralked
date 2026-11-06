import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMULATOR_RELEASE,
  LICENSES,
  ensureArchive,
  isVendored,
  selectFiles,
  writeMarker,
} from "./emulator-vendor";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "emulator-vendor-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const respond = (bytes: Uint8Array) => vi.fn(async () => new Response(bytes));

function touch(root: string, rel: string, content = "x") {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe("EMULATOR_RELEASE", () => {
  it("pins the official v4.3.0-pre asset by URL and SHA-256", () => {
    expect(EMULATOR_RELEASE).toEqual({
      version: "4.3.0-pre",
      url: "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.3.0-pre/4.3.0-pre.7z",
      sha256: "0949d75fa5cff05c47e0431443dad6b65e2ebc5f1517cbb09f3d671236d3effd",
      publishedAt: "2026-05-17",
    });
  });
});

describe("ensureArchive", () => {
  const bytes = new TextEncoder().encode("release bytes");

  it("refuses a download whose SHA-256 differs from the pin and keeps nothing", async () => {
    const fetchImpl = respond(bytes);
    await expect(
      ensureArchive({ url: "https://example.test/a.7z", sha256: "0".repeat(64), cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/SHA-256 mismatch/);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("keeps a verified download in the cache and reuses it without the network", async () => {
    const opts = { url: "https://example.test/a.7z", sha256: sha256(bytes), cacheDir: dir };
    const first = respond(bytes);
    const path = await ensureArchive({ ...opts, fetchImpl: first });
    expect(existsSync(path)).toBe(true);

    const offline = vi.fn(async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    expect(await ensureArchive({ ...opts, fetchImpl: offline })).toBe(path);
    expect(offline).not.toHaveBeenCalled();
  });

  it("replaces a corrupted cached archive", async () => {
    const opts = { url: "https://example.test/a.7z", sha256: sha256(bytes), cacheDir: dir };
    writeFileSync(join(dir, "a.7z"), "corrupted");
    const fetchImpl = respond(bytes);
    await ensureArchive({ ...opts, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("explains that the network is needed when the download fails", async () => {
    const fetchImpl = vi.fn(async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    await expect(
      ensureArchive({ url: "https://example.test/a.7z", sha256: sha256(bytes), cacheDir: dir, fetchImpl }),
    ).rejects.toThrow(/Could not download .*a\.7z/);
  });
});

describe("selectFiles", () => {
  it("copies the runtime and only the chosen cores", () => {
    for (const rel of [
      "LICENSE",
      "data/loader.js",
      "data/emulator.min.js",
      "data/src/GameManager.js",
      "data/compression/extract7z.js",
      "data/localization/pt.json",
      "data/cores/bsnes-wasm.data",
      "data/cores/bsnes-thread-wasm.data",
      "data/cores/reports/bsnes.json",
      "data/cores/reports/bsnes.json_Zone.Identifier",
      "data/src/emulator.js_Zone.Identifier",
      "data/cores/snes9x-wasm.data",
      "data/cores/reports/snes9x.json",
      "data/cores/cores.json",
      "data/cores/.npmignore",
    ]) {
      touch(dir, rel);
    }

    const picked = selectFiles(dir, ["bsnes"]).map((f) => f.rel).sort();

    expect(picked).toEqual([
      "LICENSE",
      "data/compression/extract7z.js",
      "data/cores/bsnes-thread-wasm.data",
      "data/cores/bsnes-wasm.data",
      "data/cores/reports/bsnes.json",
      "data/emulator.min.js",
      "data/loader.js",
      "data/localization/pt.json",
      "data/src/GameManager.js",
    ]);
  });

  it("fails clearly when a core is missing from the release", () => {
    touch(dir, "data/loader.js");
    touch(dir, "data/cores/reports/bsnes.json");
    expect(() => selectFiles(dir, ["bsnes"])).toThrow(/core "bsnes"/);
  });
});

describe("isVendored", () => {
  it("is true only while every file listed in the marker is present with its size", () => {
    touch(dir, "data/loader.js", "loader");
    touch(dir, "LICENSES.json", "[]");
    expect(isVendored(dir, "abc")).toBe(false);

    writeMarker(dir, "abc", ["data/loader.js", "LICENSES.json"]);
    expect(isVendored(dir, "abc")).toBe(true);
    expect(isVendored(dir, "another-release")).toBe(false);

    writeFileSync(join(dir, "data/loader.js"), "truncated?");
    expect(isVendored(dir, "abc")).toBe(false);
  });
});

describe("LICENSES", () => {
  it("lists the engine and the three cores with upstream licenses and pinned sources", () => {
    expect(LICENSES.map((l) => [l.component, l.license])).toEqual([
      ["EmulatorJS", "GPL-3.0"],
      ["bsnes", "GPLv3"],
      ["mednafen_psx_hw", "GPLv2"],
      ["pcsx_rearmed", "GPLv2"],
    ]);
    for (const entry of LICENSES) {
      expect(entry.sourceUrl).toMatch(/^https:\/\/github\.com\//);
      expect(entry.release).toBe("https://github.com/EmulatorJS/EmulatorJS/releases/tag/v4.3.0-pre");
    }
  });
});
