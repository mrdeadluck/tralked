import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const uploadPhoto = vi.fn();
const revalidateTag = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/community/upload", () => ({ uploadPhoto }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidateTag,
}));

const { POST } = await import("./route");

function form() {
  const data = new FormData();
  data.set("foto", new File([new Uint8Array([1, 2, 3])], "f.png", { type: "image/png" }));
  data.set("jogo", "hades");
  data.set("legenda", "Oi");
  return data;
}

const request = (init: RequestInit & { headers?: Record<string, string> } = {}) =>
  new Request("http://localhost:3000/galeria/enviar", {
    method: "POST",
    body: form(),
    ...init,
    headers: { host: "localhost:3000", ...init.headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: "u1" });
  uploadPhoto.mockResolvedValue({ status: "ok", photoId: "p1", xpAwarded: true });
});

describe("POST /galeria/enviar", () => {
  it("refuses a muted user with 403 before reading the photo", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", mutedUntil: new Date(Date.now() + 86_400_000) });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ status: "forbidden", message: expect.stringMatching(/silenciado/) });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("answers 503 with a clear message when image storage is not configured (production without Blob)", async () => {
    const { StorageNotConfiguredError } = await import("@/lib/storage");
    uploadPhoto.mockRejectedValue(new StorageNotConfiguredError());
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "unavailable",
      message: "O envio de fotos está indisponível no momento. Tente de novo mais tarde.",
    });
    expect(revalidateTag).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("refuses uploads without login", async () => {
    getSessionUser.mockResolvedValue(null);
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("refuses cross-site requests", async () => {
    const response = await POST(request({ headers: { origin: "https://evil.example" } }));
    expect(response.status).toBe(403);
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("refuses bodies over 4 MB (+ multipart overhead) without parsing them", async () => {
    // Just over the cap, and still under Vercel's 4.5 MB request limit.
    const big = new Uint8Array(4 * 1024 * 1024 + 65 * 1024);
    const response = await POST(
      request({ body: big, headers: { "content-type": "multipart/form-data; boundary=x" } }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      status: "too_large",
      message: "A foto passou de 4 MB mesmo depois de comprimida. Tente uma imagem menor.",
    });
    expect(uploadPhoto).not.toHaveBeenCalled();
  });

  it("accepts a photo of exactly 4 MB and passes it on", async () => {
    const data = new FormData();
    data.set("foto", new File([new Uint8Array(4 * 1024 * 1024)], "f.webp", { type: "image/webp" }));
    data.set("jogo", "hades");
    const response = await POST(request({ body: data }));
    expect(response.status).toBe(201);
    expect((uploadPhoto.mock.calls[0][0].file as File).size).toBe(4 * 1024 * 1024);
  });

  it("passes the form fields on and answers 201 with the photo link", async () => {
    const response = await POST(request({ headers: { origin: "http://localhost:3000" } }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ status: "ok", photoId: "p1", xpAwarded: true, href: "/galeria/p1" });
    const input = uploadPhoto.mock.calls[0][0];
    expect(input).toMatchObject({ userId: "u1", gameSlug: "hades", caption: "Oi" });
    expect(input.file).toBeInstanceOf(File);
    expect(revalidateTag).toHaveBeenCalledWith("gallery", { expire: 0 });
  });

  it("maps upload refusals to status codes", async () => {
    uploadPhoto.mockResolvedValue({ status: "invalid", field: "foto", message: "x" });
    expect((await POST(request())).status).toBe(422);
    uploadPhoto.mockResolvedValue({ status: "rate_limited", message: "x" });
    expect((await POST(request())).status).toBe(429);
  });
});
