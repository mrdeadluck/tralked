import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const TEXT_EXTENSIONS = /\.(tsx?|css|json|md|svg)$/;

// The local Postgres role/database is still called "gamelog"; that is infrastructure, not branding.
const DB_URL = /postgresql:\/\/gamelog:gamelog@localhost:5433\/gamelog\w*/g;

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "generated") continue;
      yield* walk(path);
    } else if (TEXT_EXTENSIONS.test(name) && path !== SELF) {
      yield path;
    }
  }
}

describe("branding", () => {
  it("leaves no GAMELOG or PXN references in app/src", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8").replace(DB_URL, "");
      if (/gamelog|pxn/i.test(text)) offenders.push(relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
