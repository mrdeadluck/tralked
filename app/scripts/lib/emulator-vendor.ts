/**
 * Vendors the pinned EmulatorJS release into `public/emulator/<version>/` so the engine and its
 * cores are served from our own origin (no third-party CDN at runtime).
 *
 * The release is the official GitHub asset, checked against a pinned SHA-256 before anything is
 * extracted. Only the runtime (`data/` without the core collection), the GPL LICENSE and the cores
 * listed in `CORES` are copied; `LICENSES.json` records each component's upstream license.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { path7za } from "7zip-bin";
import { CORES, EMULATOR_VERSION } from "../../src/lib/emulator/cores";

export const EMULATOR_RELEASE = {
  version: EMULATOR_VERSION,
  url: "https://github.com/EmulatorJS/EmulatorJS/releases/download/v4.3.0-pre/4.3.0-pre.7z",
  sha256: "0949d75fa5cff05c47e0431443dad6b65e2ebc5f1517cbb09f3d671236d3effd",
  publishedAt: "2026-05-17",
} as const;

if (!EMULATOR_RELEASE.url.includes(`/v${EMULATOR_RELEASE.version}/`)) {
  throw new Error(`EMULATOR_RELEASE.url does not point at EmulatorJS v${EMULATOR_RELEASE.version}.`);
}

const RELEASE_PAGE = `https://github.com/EmulatorJS/EmulatorJS/releases/tag/v${EMULATOR_RELEASE.version}`;
const CORE_INFO = (core: string) =>
  `https://github.com/libretro/libretro-core-info/blob/master/${core}_libretro.info`;

export type LicenseEntry = {
  component: string;
  upstreamName: string;
  authors: string;
  license: string;
  /** Source repository of the code built into the vendored files. */
  sourceUrl: string;
  /** Release that distributes the exact vendored binaries. */
  release: string;
  /** Where the license was read from, for cores: libretro's core info file. */
  licenseInfoUrl?: string;
};

/** Licenses from upstream: EmulatorJS's package.json/LICENSE and libretro-core-info. */
export const LICENSES: LicenseEntry[] = [
  {
    component: "EmulatorJS",
    upstreamName: "EmulatorJS",
    authors: "EmulatorJS contributors",
    license: "GPL-3.0",
    sourceUrl: `https://github.com/EmulatorJS/EmulatorJS/tree/v${EMULATOR_RELEASE.version}`,
    release: RELEASE_PAGE,
  },
  {
    component: "bsnes",
    upstreamName: "Nintendo - SNES / SFC (bsnes)",
    authors: "Near",
    license: "GPLv3",
    sourceUrl: "https://github.com/EmulatorJS/bsnes-libretro",
    release: RELEASE_PAGE,
    licenseInfoUrl: CORE_INFO("bsnes"),
  },
  {
    component: "mednafen_psx_hw",
    upstreamName: "Sony - PlayStation (Beetle PSX HW)",
    authors: "Mednafen Team",
    license: "GPLv2",
    sourceUrl: "https://github.com/EmulatorJS/beetle-psx-libretro",
    release: RELEASE_PAGE,
    licenseInfoUrl: CORE_INFO("mednafen_psx_hw"),
  },
  {
    component: "pcsx_rearmed",
    upstreamName: "Sony - PlayStation (PCSX ReARMed)",
    authors: "PCSX Team, notaz, Exophase",
    license: "GPLv2",
    sourceUrl: "https://github.com/EmulatorJS/pcsx_rearmed",
    release: RELEASE_PAGE,
    licenseInfoUrl: CORE_INFO("pcsx_rearmed"),
  },
];

/** Every core named in `CORES` (primary and fallback). */
export const VENDORED_CORES = [
  ...new Set(Object.values(CORES).flatMap((c) => (c.fallback ? [c.primary, c.fallback] : [c.primary]))),
];

type FetchLike = (url: string) => Promise<Response>;

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

/**
 * Returns the path of the release archive in `cacheDir`, downloading it when absent or corrupted.
 * A download whose SHA-256 differs from `sha256` is deleted and rejected.
 */
export async function ensureArchive(opts: {
  url: string;
  sha256: string;
  cacheDir: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const { url, sha256, cacheDir, fetchImpl = fetch } = opts;
  const path = join(cacheDir, basename(new URL(url).pathname));
  if (existsSync(path)) {
    if ((await hashFile(path)) === sha256) return path;
    rmSync(path);
  }

  mkdirSync(cacheDir, { recursive: true });
  const part = `${path}.part`;
  const hash = createHash("sha256");
  try {
    const res = await fetchImpl(url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        done(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as WebReadableStream), tap, createWriteStream(part));
  } catch (e) {
    rmSync(part, { force: true });
    throw new Error(
      `Could not download ${url} (${(e as Error).message}). ` +
        "The emulator is vendored from that release once; connect to the internet and run `pnpm emulator:vendor`.",
    );
  }

  const actual = hash.digest("hex");
  if (actual !== sha256) {
    rmSync(part, { force: true });
    throw new Error(
      `SHA-256 mismatch for ${url}: expected ${sha256}, got ${actual}. ` +
        "The download was discarded and nothing was extracted.",
    );
  }
  renameSync(part, path);
  return path;
}

/** Extracts the whole archive into `outDir` with the pinned 7-Zip binary from `7zip-bin`. */
export async function extractArchive(archive: string, outDir: string): Promise<void> {
  // npm tarballs do not always keep the executable bit of the bundled binary.
  if (process.platform !== "win32") chmodSync(path7za, 0o755);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path7za, ["x", archive, `-o${outDir}`, "-y", "-bso0", "-bsp0"], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`7za exited with code ${code}: ${stderr.trim()}`)),
    );
  });
}

function walk(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const abs = join(dir, entry.name);
    return entry.isDirectory() ? walk(root, abs) : [relative(root, abs).split(sep).join("/")];
  });
}

/**
 * Files to vendor from an extracted release: the runtime under `data/` (without the core
 * collection), the GPL `LICENSE`, and each wanted core's builds plus its report.
 */
export function selectFiles(stageDir: string, cores: readonly string[]): { rel: string; abs: string }[] {
  const wanted = (rel: string) => {
    if (!rel.startsWith("data/cores/")) return !rel.endsWith("Zone.Identifier");
    return cores.some(
      (core) =>
        new RegExp(`^data/cores/${core}-[a-z-]*wasm\\.data$`).test(rel) ||
        rel === `data/cores/reports/${core}.json`,
    );
  };
  const rels = walk(stageDir, join(stageDir, "data")).filter(wanted);

  for (const core of cores) {
    if (!rels.some((rel) => rel.startsWith(`data/cores/${core}-`))) {
      throw new Error(`The EmulatorJS release has no build of core "${core}".`);
    }
  }
  if (existsSync(join(stageDir, "LICENSE"))) rels.push("LICENSE");
  else throw new Error("The EmulatorJS release has no LICENSE file.");

  return rels.map((rel) => ({ rel, abs: join(stageDir, ...rel.split("/")) }));
}

const MARKER = ".vendored.json";

type Marker = { sha256: string; files: Record<string, number> };

/** Records which release produced `targetDir` and the size of every file in it. */
export function writeMarker(targetDir: string, sha256: string, rels: string[]): void {
  const files = Object.fromEntries(rels.map((rel) => [rel, statSync(join(targetDir, rel)).size]));
  writeFileSync(join(targetDir, MARKER), JSON.stringify({ sha256, files } satisfies Marker, null, 2));
}

/** True when `targetDir` was vendored from `sha256` and none of its files is missing or changed. */
export function isVendored(targetDir: string, sha256: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(targetDir, MARKER), "utf8")) as Marker;
    if (marker.sha256 !== sha256) return false;
    return Object.entries(marker.files).every(([rel, size]) => statSync(join(targetDir, rel)).size === size);
  } catch {
    return false;
  }
}

/**
 * Makes `<appDir>/public/emulator/<version>/` match the pinned release. Does nothing (and needs no
 * network) when it already does; the archive is cached under `node_modules/.cache/`.
 */
export async function vendorEmulator(opts: { appDir: string; fetchImpl?: FetchLike; log?: (m: string) => void }) {
  const { appDir, fetchImpl, log = console.log } = opts;
  const { version, url, sha256, publishedAt } = EMULATOR_RELEASE;
  const publicRoot = join(appDir, "public", "emulator");
  const target = join(publicRoot, version);

  if (isVendored(target, sha256)) {
    log(`EmulatorJS ${version} is already vendored in ${relative(appDir, target)}.`);
    return;
  }

  const cacheDir = join(appDir, "node_modules", ".cache", "tralked-emulator");
  log(`Getting EmulatorJS ${version} from the cache or ${url} ...`);
  const archive = await ensureArchive({ url, sha256, cacheDir, fetchImpl });
  log(`SHA-256 verified (${sha256}). Extracting ...`);

  const stage = join(cacheDir, `stage-${version}`);
  rmSync(stage, { recursive: true, force: true });
  await extractArchive(archive, stage);
  const files = selectFiles(stage, VENDORED_CORES);

  const partial = `${target}.partial`;
  rmSync(partial, { recursive: true, force: true });
  for (const { rel, abs } of files) {
    const to = join(partial, ...rel.split("/"));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(abs, to);
  }
  const licenses = { release: { version, url, sha256, publishedAt, page: RELEASE_PAGE }, components: LICENSES };
  writeFileSync(join(partial, "LICENSES.json"), JSON.stringify(licenses, null, 2));
  writeMarker(partial, sha256, [...files.map((f) => f.rel), "LICENSES.json"]);

  rmSync(target, { recursive: true, force: true });
  renameSync(partial, target);
  rmSync(stage, { recursive: true, force: true });

  // Drop folders of previously vendored versions (only ones this script created).
  for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
    const dir = join(publicRoot, entry.name);
    if (entry.isDirectory() && entry.name !== version && existsSync(join(dir, MARKER))) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  log(`Vendored ${files.length} files (cores: ${VENDORED_CORES.join(", ")}) into ${relative(appDir, target)}.`);
}
