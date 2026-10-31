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

  it("refuses bodies over the limit without parsing them", async () => {
    const big = new Uint8Array(8 * 1024 * 1024 + 100 * 1024);
    const response = await POST(
      request({ body: big, headers: { "content-type": "multipart/form-data; boundary=x" } }),
    );
    expect(response.status).toBe(413);
    expect(uploadPhoto).not.toHaveBeenCalled();
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
