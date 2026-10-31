import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Test database only (vitest.db-guard.ts). The admin session is mocked; keys, articles and the
// bot API route handler are real.

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

const { prisma } = await import("@/lib/db");
const { createKeyAction, revokeKeyAction } = await import("./actions");
const articles = await import("@/app/api/v1/articles/route");

const NAME = "t7 robô de teste";
let adminId: string;

async function cleanup() {
  const keys = await prisma.apiKey.findMany({ where: { name: NAME }, select: { id: true } });
  const ids = keys.map((k) => k.id);
  await prisma.article.deleteMany({ where: { botKeyId: { in: ids } } });
  await prisma.author.deleteMany({ where: { handle: `Robô ${NAME}` } });
  await prisma.apiKey.deleteMany({ where: { id: { in: ids } } });
}

let seq = 0;
const post = (secret: string) =>
  articles.POST(
    new Request("http://localhost:3000/api/v1/articles", {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
        "idempotency-key": `t7-${Date.now()}-${seq++}`,
      },
      body: JSON.stringify({
        title: `Notícia do robô de teste ${seq}`,
        category: "GAMES",
        blocks: [{ type: "paragraph", text: "Texto." }],
      }),
    }),
  );

beforeAll(async () => {
  await cleanup();
  const admin = await prisma.user.findFirstOrThrow({ where: { role: "admin" } });
  adminId = admin.id;
  getSessionUser.mockResolvedValue(admin);
});

afterAll(cleanup);

describe("bot keys from the admin", () => {
  let secret: string;
  let keyId: string;

  it("creating a key returns the secret once and stores only its SHA-256", async () => {
    const result = await createKeyAction({ name: NAME, scopes: ["articles:write"] });
    expect(result).toMatchObject({ ok: true, secret: expect.stringMatching(/^tk_live_[A-Za-z0-9_-]{43}$/) });
    if (!result.ok) return;
    secret = result.secret;

    const row = await prisma.apiKey.findFirstOrThrow({ where: { name: NAME } });
    keyId = row.id;
    expect(row.hash).toBe(createHash("sha256").update(secret).digest("hex"));
    expect(row.prefix).toBe(secret.slice(0, 12));
    expect(row).toMatchObject({ scopes: ["articles:write"], createdById: adminId, revokedAt: null });
    // The secret itself is nowhere in the row.
    expect(JSON.stringify(row)).not.toContain(secret.slice(12));
  });

  it("the key works against the bot API until it is revoked, then gets 401", async () => {
    expect((await post(secret)).status).toBe(201);

    expect(await revokeKeyAction({ id: keyId })).toEqual({ ok: true });
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: keyId } })).revokedAt).not.toBeNull();
    expect((await post(secret)).status).toBe(401);
  });

  it("revoking an unknown key is reported", async () => {
    expect(await revokeKeyAction({ id: "nao-existe" })).toMatchObject({ ok: false });
  });
});
