import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createApiKey, hashSecret, listApiKeys, revokeApiKey, verifyApiKey } from "./keys";

const created: string[] = [];

afterAll(async () => {
  await prisma.apiKey.deleteMany({ where: { id: { in: created } } });
});

async function newKey(scopes: Parameters<typeof createApiKey>[0]["scopes"] = ["articles:write"]) {
  const key = await createApiKey({ name: `teste-chaves-${created.length}`, scopes });
  created.push(key.id);
  return key;
}

describe("API keys", () => {
  it("creates a tk_live_ key, stores only its SHA-256 and shows the prefix", async () => {
    const key = await newKey(["articles:write", "publish", "publish"]);
    expect(key.secret).toMatch(/^tk_live_[A-Za-z0-9_-]{43}$/);
    expect(key.prefix).toBe(key.secret.slice(0, 12));
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.hash).toBe(hashSecret(key.secret));
    expect(row.hash).not.toContain(key.secret);
    expect(row.scopes).toEqual(["articles:write", "publish"]);
  });

  it("verifies the bearer header and the bare key, and records lastUsedAt", async () => {
    const key = await newKey();
    const viaHeader = await verifyApiKey(`Bearer ${key.secret}`);
    expect(viaHeader).toMatchObject({ id: key.id, scopes: ["articles:write"], prefix: key.prefix });
    expect(await verifyApiKey(key.secret)).toMatchObject({ id: key.id });
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } });
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("refuses missing, malformed and unknown keys, including one that shares the prefix", async () => {
    const key = await newKey();
    expect(await verifyApiKey(null)).toBeNull();
    expect(await verifyApiKey("Bearer ")).toBeNull();
    expect(await verifyApiKey("Bearer tk_live_curta")).toBeNull();
    const last = key.secret.at(-1) === "A" ? "B" : "A";
    expect(await verifyApiKey(`Bearer ${key.secret.slice(0, -1)}${last}`)).toBeNull();
  });

  it("refuses a revoked key; revoking twice keeps the first time", async () => {
    const key = await newKey();
    await revokeApiKey(key.id);
    const first = (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt;
    await revokeApiKey(key.id);
    const second = (await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).revokedAt;
    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(await verifyApiKey(`Bearer ${key.secret}`)).toBeNull();
  });

  it("lists keys without hashes", async () => {
    const key = await newKey(["guides:write"]);
    const listed = (await listApiKeys()).find((k) => k.id === key.id);
    expect(listed).toMatchObject({ name: expect.stringMatching(/^teste-chaves-/), scopes: ["guides:write"], revokedAt: null });
    expect(listed).not.toHaveProperty("hash");
  });

  it("validates the name and the scopes", async () => {
    await expect(createApiKey({ name: " ", scopes: ["publish"] })).rejects.toThrow();
    await expect(createApiKey({ name: "x", scopes: [] })).rejects.toThrow();
  });
});
