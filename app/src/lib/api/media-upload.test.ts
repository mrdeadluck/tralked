import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const { prisma } = await import("@/lib/db");
const { createApiKey } = await import("@/lib/api/keys");
const { resetRateLimits } = await import("@/lib/api/rate-limit");
const media = await import("@/app/api/v1/media/route");

type Key = { id: string; secret: string };
let writer: Key;
let noScope: Key;
let png: Buffer;
let seq = 0;

function upload(key: Key | null, body: Uint8Array, { type = "image/png", idem }: { type?: string; idem?: string | null } = {}) {
  const headers: Record<string, string> = { "content-type": type };
  if (key) headers.authorization = `Bearer ${key.secret}`;
  if (idem !== null) headers["idempotency-key"] = idem ?? `t4-${Date.now()}-${seq++}`;
  return new Request("http://localhost:3000/api/v1/media", { method: "POST", headers, body: body as BodyInit });
}

const errorCode = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

beforeAll(async () => {
  writer = await createApiKey({ name: "t4 midia", scopes: ["media:write"] });
  noScope = await createApiKey({ name: "t4 sem escopo", scopes: ["articles:write"] });
  png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "#c6f432" } }).png().toBuffer();
});

afterAll(async () => {
  await prisma.ingestionLog.deleteMany({ where: { keyId: { in: [writer.id, noScope.id] } } });
  await prisma.apiKey.deleteMany({ where: { id: { in: [writer.id, noScope.id] } } });
  await rm(path.join(process.cwd(), "public", "uploads", "guias"), { recursive: true, force: true });
});

beforeEach(() => resetRateLimits());

describe("POST /api/v1/media", () => {
  it("a valid PNG returns 201 with a url under guias/ and the file exists", async () => {
    const response = await media.POST(upload(writer, png));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { url: string; width: number; height: number };
    expect(body.url).toMatch(/^\/uploads\/guias\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);
    expect(body).toMatchObject({ width: 40, height: 30 });
    expect(existsSync(path.join(process.cwd(), "public", body.url))).toBe(true);
  });

  it("403 without media:write", async () => {
    expect((await media.POST(upload(noScope, png))).status).toBe(403);
  });

  it("400 without Idempotency-Key", async () => {
    expect((await media.POST(upload(writer, png, { idem: null }))).status).toBe(400);
  });

  it("413 for 9 MiB", async () => {
    const response = await media.POST(upload(writer, new Uint8Array(9 * 1024 * 1024)));
    expect(response.status).toBe(413);
    expect(await errorCode(response)).toBe("payload_too_large");
  });

  it("415 for text/plain", async () => {
    const response = await media.POST(upload(writer, Buffer.from("oi"), { type: "text/plain" }));
    expect(response.status).toBe(415);
    expect(await errorCode(response)).toBe("unsupported_media_type");
  });

  it("415 when the bytes are not an image", async () => {
    expect((await media.POST(upload(writer, Buffer.from("not an image")))).status).toBe(415);
  });

  it("same Idempotency-Key and same body returns the same url; another body conflicts", async () => {
    const idem = `t4-same-${Date.now()}`;
    const first = await media.POST(upload(writer, png, { idem }));
    const again = await media.POST(upload(writer, png, { idem }));
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(((await again.json()) as { url: string }).url).toBe(((await first.json()) as { url: string }).url);

    const other = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).png().toBuffer();
    const conflict = await media.POST(upload(writer, other, { idem }));
    expect(conflict.status).toBe(409);
    expect(await errorCode(conflict)).toBe("idempotency_conflict");
  });
});
