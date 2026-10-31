import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { ImageRejectedError, MAX_UPLOAD_BYTES, processImage } from "./images";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } });

async function rejection(input: Buffer) {
  try {
    await processImage(input);
  } catch (error) {
    if (error instanceof ImageRejectedError) return error.reason;
    throw error;
  }
  return "accepted";
}

describe("processImage", () => {
  it("rejects files that only pretend to be images", async () => {
    // Text with a .jpg name / image/jpeg MIME: the type is checked by decoding, not by the label.
    expect(await rejection(Buffer.from("isto não é uma foto"))).toBe("invalid_type");
    // JPEG magic bytes followed by garbage.
    expect(await rejection(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]))).toBe(
      "invalid_type",
    );
    expect(await rejection(Buffer.alloc(0))).toBe("invalid_type");
  });

  it("rejects real images in formats the gallery does not accept (SVG, GIF)", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    expect(await rejection(svg)).toBe("invalid_type");
    const gif = await solid(10, 10).gif().toBuffer();
    expect(await rejection(gif)).toBe("invalid_type");
  });

  it("rejects files over 8 MB before decoding", async () => {
    expect(await rejection(Buffer.alloc(MAX_UPLOAD_BYTES + 1))).toBe("too_large");
  });

  it("re-encodes JPEG/PNG/WebP as WebP, at most 2048 px, without metadata", async () => {
    const jpeg = await solid(3000, 1500)
      .jpeg()
      .withExif({ IFD0: { Copyright: "segredo", Artist: "lucas" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const out = await processImage(jpeg);
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect([out.width, out.height]).toEqual([2048, 1024]);
    expect(meta.exif).toBeUndefined();

    const small = await processImage(await solid(400, 300).png().toBuffer());
    expect([small.width, small.height]).toEqual([400, 300]);
    const webp = await processImage(await solid(50, 80).webp().toBuffer());
    expect([webp.width, webp.height]).toEqual([50, 80]);
  });
});
