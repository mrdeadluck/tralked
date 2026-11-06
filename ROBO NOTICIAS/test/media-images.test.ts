import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { SAME_IMAGE_MAX_DISTANCE, dHash, fetchImage, hamming } from "../src/media/images.js";

/** A picture with some structure: a diagonal gradient with a dark block, as raw RGB. */
async function scene(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const inBlock = x > width * 0.55 && x < width * 0.8 && y > height * 0.2 && y < height * 0.6;
      const v = inBlock ? 20 : Math.round((255 * (x / width + y / height)) / 2);
      raw[i] = v;
      raw[i + 1] = Math.round(v * 0.8);
      raw[i + 2] = 255 - v;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg().toBuffer();
}

async function gradient(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * width + x] = Math.round((255 * x) / width);
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

async function checker(width: number, height: number, cell = 40): Promise<Buffer> {
  const raw = Buffer.alloc(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) raw[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0;
  return sharp(raw, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

const ok = (bytes: Buffer, type = "image/jpeg", headers: Record<string, string> = {}) =>
  vi.fn(async () => new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": type, ...headers } }));

describe("dHash and hamming", () => {
  it("the same picture at two sizes is within SAME_IMAGE_MAX_DISTANCE", async () => {
    const big = await scene(1200, 675);
    const small = await sharp(big).resize(600, 338).jpeg({ quality: 70 }).toBuffer();
    expect(hamming(await dHash(big), await dHash(small))).toBeLessThanOrEqual(SAME_IMAGE_MAX_DISTANCE);
    expect(SAME_IMAGE_MAX_DISTANCE).toBe(6);
  });

  it("two different pictures are far apart", async () => {
    expect(hamming(await dHash(await gradient(800, 450)), await dHash(await checker(800, 450)))).toBeGreaterThan(20);
  });

  it("hamming counts differing bits", () => {
    expect(hamming(0b1011n, 0b0001n)).toBe(2);
    expect(hamming(0n, (1n << 64n) - 1n)).toBe(64);
  });
});

describe("fetchImage", () => {
  it("downloads an https image and measures it", async () => {
    const bytes = await scene(1200, 675);
    const img = await fetchImage("https://cdn.test/a.jpg", ok(bytes));
    expect(img).toMatchObject({ url: "https://cdn.test/a.jpg", contentType: "image/jpeg", width: 1200, height: 675 });
    expect(typeof img!.hash).toBe("bigint");
  });

  it("refuses http, oversized and non-image responses", async () => {
    const bytes = await scene(400, 300);
    const fetchFn = ok(bytes);
    expect(await fetchImage("http://cdn.test/a.jpg", fetchFn)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await fetchImage("https://cdn.test/big.jpg", ok(Buffer.alloc(9 * 1024 * 1024)))).toBeNull();
    expect(
      await fetchImage("https://cdn.test/big.jpg", ok(bytes, "image/jpeg", { "content-length": String(9 * 1024 * 1024) })),
    ).toBeNull();
    expect(await fetchImage("https://cdn.test/page", ok(Buffer.from("<html></html>"), "text/html"))).toBeNull();
  });

  it("returns null on HTTP errors, network errors and undecodable bytes", async () => {
    expect(await fetchImage("https://cdn.test/404.jpg", vi.fn(async () => new Response("no", { status: 404 })))).toBeNull();
    expect(await fetchImage("https://cdn.test/x.jpg", vi.fn(async () => Promise.reject(new Error("boom"))))).toBeNull();
    expect(await fetchImage("https://cdn.test/x.jpg", ok(Buffer.from("not an image")))).toBeNull();
  });

  it("re-encodes formats the site does not take (AVIF) as WebP", async () => {
    const avif = await sharp(await scene(640, 360)).avif().toBuffer();
    const img = await fetchImage("https://cdn.test/a.avif", ok(avif, "image/avif"));
    expect(img).toMatchObject({ contentType: "image/webp", width: 640, height: 360 });
  });
});
