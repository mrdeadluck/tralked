import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";

/**
 * Bot API keys: `tk_live_` + 43 base64url characters (32 random bytes). Only the SHA-256 of the
 * key is stored; the secret is returned once by `createApiKey` and cannot be recovered.
 */

export const API_SCOPES = ["articles:write", "guides:write", "publish", "media:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const KEY_PREFIX = "tk_live_";
/** Characters of the key kept in clear (`ApiKey.prefix`): `tk_live_` + 4, to tell keys apart. */
const PREFIX_LENGTH = KEY_PREFIX.length + 4;
const KEY_PATTERN = /^tk_live_[A-Za-z0-9_-]{43}$/;

export type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiScope[];
};

export type ApiKeySummary = ApiKeyRecord & {
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdById: string | null;
};

export const createApiKeyInput = z.strictObject({
  name: z.string().trim().min(1, "Dê um nome à chave").max(60),
  scopes: z.array(z.enum(API_SCOPES)).min(1, "Escolha ao menos um escopo"),
  createdById: z.string().min(1).nullable().optional(),
});

export const hashSecret = (secret: string) => createHash("sha256").update(secret).digest("hex");

const asScopes = (scopes: string[]) =>
  scopes.filter((s): s is ApiScope => (API_SCOPES as readonly string[]).includes(s));

/** Creates a key. `secret` is the full key: show it once, it is not stored. */
export async function createApiKey(input: {
  name: string;
  scopes: ApiScope[];
  createdById?: string | null;
}): Promise<{ id: string; secret: string; prefix: string }> {
  const { name, scopes, createdById } = createApiKeyInput.parse(input);
  const secret = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  const prefix = secret.slice(0, PREFIX_LENGTH);
  const key = await prisma.apiKey.create({
    data: {
      name,
      scopes: [...new Set(scopes)],
      prefix,
      hash: hashSecret(secret),
      createdById: createdById ?? null,
    },
    select: { id: true },
  });
  return { id: key.id, secret, prefix };
}

/** Revokes a key at once (idempotent: a revoked key keeps its first revocation time). */
export async function revokeApiKey(id: string): Promise<void> {
  await prisma.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
}

/** Every key, newest first, without hashes. */
export async function listApiKeys(): Promise<ApiKeySummary[]> {
  const keys = await prisma.apiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      revokedAt: true,
      createdById: true,
    },
  });
  return keys.map((k) => ({ ...k, scopes: asScopes(k.scopes) }));
}

/**
 * Resolves `Authorization: Bearer tk_live_…` (or the bare key) to an active key. Null for a
 * missing, malformed, unknown or revoked key. Candidates are found by their clear prefix and the
 * SHA-256 digests are compared in constant time.
 */
export async function verifyApiKey(bearer: string | null | undefined): Promise<ApiKeyRecord | null> {
  if (!bearer) return null;
  const secret = bearer.replace(/^Bearer\s+/i, "").trim();
  if (!KEY_PATTERN.test(secret)) return null;

  const digest = Buffer.from(hashSecret(secret), "hex");
  const candidates = await prisma.apiKey.findMany({
    where: { prefix: secret.slice(0, PREFIX_LENGTH) },
    select: { id: true, name: true, prefix: true, scopes: true, hash: true, revokedAt: true },
  });
  const match = candidates.find((k) => {
    const stored = Buffer.from(k.hash, "hex");
    return stored.length === digest.length && timingSafeEqual(stored, digest);
  });
  if (!match || match.revokedAt) return null;

  await prisma.apiKey.update({ where: { id: match.id }, data: { lastUsedAt: new Date() } });
  return { id: match.id, name: match.name, prefix: match.prefix, scopes: asScopes(match.scopes) };
}
