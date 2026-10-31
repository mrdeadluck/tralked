import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

const { signSessionToken, SESSION_COOKIE } = await import("@/lib/auth/session");
const { proxy } = await import("./proxy");
const { requiredLevel } = await import("@/lib/admin/access");

async function request(path: string, role: string | null) {
  const req = new NextRequest(`http://localhost:3000${path}`);
  if (role !== null) {
    findUnique.mockResolvedValue({ role });
    req.cookies.set(SESSION_COOKIE, await signSessionToken("u1"));
  }
  return proxy(req);
}

beforeEach(() => findUnique.mockReset());

describe("admin proxy", () => {
  it.each([null, "user", "author"])("answers 404 to %s on every admin path", async (role) => {
    for (const path of ["/admin", "/admin/noticias/nova", "/admin/robos"]) {
      expect((await request(path, role)).status).toBe(404);
    }
  });

  it("a forged or expired cookie counts as a visitor", async () => {
    const req = new NextRequest("http://localhost:3000/admin");
    req.cookies.set(SESSION_COOKIE, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.forged");
    expect((await proxy(req)).status).toBe(404);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("lets editors into content and moderation, but not admin-only sections", async () => {
    expect((await request("/admin/moderacao", "editor")).status).toBe(200);
    expect((await request("/admin/noticias/abc", "editor")).status).toBe(200);
    for (const path of ["/admin/robos", "/admin/fraude", "/admin/feeds", "/admin/usuarios", "/admin/jogos/x"]) {
      expect((await request(path, "editor")).status).toBe(404);
    }
  });

  it("lets admins in everywhere", async () => {
    for (const path of ["/admin", "/admin/robos", "/admin/usuarios"]) {
      expect((await request(path, "admin")).status).toBe(200);
    }
  });

  it("maps paths to levels without prefix accidents", () => {
    expect(requiredLevel("/admin/robos")).toBe("admin");
    expect(requiredLevel("/admin/robos/x")).toBe("admin");
    expect(requiredLevel("/admin/robosx")).toBe("staff");
    expect(requiredLevel("/admin/revisao")).toBe("staff");
  });
});
