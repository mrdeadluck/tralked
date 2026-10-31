import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * Tralked passwords: scrypt (node:crypto) with a random 16-byte salt per hash, compared in
 * constant time. Stored as `scrypt$N$r$p$<salt base64>$<key base64>`, so the work factor can be
 * raised later without breaking existing hashes.
 */

export { PASSWORD_MAX, PASSWORD_MIN } from "./limits";

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Upper bounds accepted from a stored hash (a corrupted row must not exhaust CPU or memory). */
const MAX_N = 2 ** 17;
const MAX_R = 16;
const MAX_P = 4;

function derive(password: string, salt: Buffer, options: { N: number; r: number; p: number }): Promise<Buffer> {
  const scryptOptions: ScryptOptions = {
    ...options,
    // scrypt needs 128 * N * r bytes; the default 32 MiB cap is exactly N=2^15, r=8.
    maxmem: 256 * options.N * options.r,
  };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const int = (value: string | undefined) => (value && /^\d+$/.test(value) ? Number(value) : NaN);

/** True only when `stored` is a well-formed hash of `password`. Never throws. */
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, keyB64, ...rest] = stored.split("$");
  if (scheme !== "scrypt" || rest.length > 0 || !saltB64 || !keyB64) return false;
  const params = { N: int(n), r: int(r), p: int(p) };
  const powerOfTwo = params.N > 1 && (params.N & (params.N - 1)) === 0;
  if (!powerOfTwo || params.N > MAX_N || !(params.r >= 1 && params.r <= MAX_R) || !(params.p >= 1 && params.p <= MAX_P)) {
    return false;
  }
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(keyB64, "base64");
  if (salt.length === 0 || expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, salt, params);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time as a real check when there is no account (or no password) to compare
 * with, so the response time does not reveal whether an e-mail is registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword("tralked-dummy-password");
  await verifyPassword(password, await dummyHash);
  return false;
}
