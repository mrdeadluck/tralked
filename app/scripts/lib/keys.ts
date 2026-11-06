import { existsSync, readFileSync } from "node:fs";

/** Service-account keys of the platforms (PSN_NPSSO, XBOX_OPENXBL_KEY, RA_*), kept outside the repos. */
export const KEYS_FILE = "C:/projetos/Nova pasta/.env.chaves";

/** `KEY=value` lines (blank lines and `#` comments skipped; surrounding quotes removed). */
export function parseKeys(text: string): Map<string, string> {
  const keys = new Map<string, string>();
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const name = line.slice(0, at).replace(/^export\s+/, "").trim();
    let value = line.slice(at + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]) value = value.slice(1, -1);
    if (name && value) keys.set(name, value);
  }
  return keys;
}

/** The keys of KEYS_FILE (empty when the file is missing). Never print the values. */
export function readKeys(file = KEYS_FILE): Map<string, string> {
  return existsSync(file) ? parseKeys(readFileSync(file, "utf8")) : new Map();
}

/**
 * `name` from the first of `files` that has it (read-only; missing files and empty values are
 * skipped), with the file it came from; null when none has it. Never print the value.
 */
export function keyFromFiles(name: string, files: readonly string[]): { value: string; file: string } | null {
  for (const file of files) {
    const value = readKeys(file).get(name);
    if (value) return { value, file };
  }
  return null;
}

/**
 * Puts `names` from the keys file into process.env where they are not set already, before the app
 * modules read the env. Returns the names it set (never the values).
 */
export function loadKeysIntoEnv(names: readonly string[], file = KEYS_FILE): string[] {
  const keys = readKeys(file);
  const set: string[] = [];
  for (const name of names) {
    if (process.env[name]?.trim()) continue;
    const value = keys.get(name);
    if (value) {
      process.env[name] = value;
      set.push(name);
    }
  }
  return set;
}
