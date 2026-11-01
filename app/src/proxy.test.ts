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

  it.each(["/ADMIN", "/Admin/", "/%61dmin", "/%2561dmin", "//admin//noticias/", "/admin%2Fnoticias", "/admin;x", "/admin.json"])(
    "normalizes %s before the check (404 for a visitor)",
    async (path) => {
      expect((await request(path, null)).status).toBe(404);
    },
  );

  it("normalized admin-only variants stay closed to editors", async () => {
    for (const path of ["/ADMIN/ROBOS", "/admin/%72obos", "/admin//usuarios/", "/admin/Fraude"]) {
      expect((await request(path, "editor")).status).toBe(404);
    }
  });

  it("other paths pass without a lookup", async () => {
    for (const path of ["/", "/administracao", "/noticias/admin", "/api/v1/articles"]) {
      expect((await request(path, null)).status).toBe(200);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("maps paths to levels without prefix accidents", () => {
    expect(requiredLevel("/admin/robos")).toBe("admin");
    expect(requiredLevel("/admin/robos/x")).toBe("admin");
    expect(requiredLevel("/admin/robosx")).toBe("staff");
    expect(requiredLevel("/admin/revisao")).toBe("staff");
  });
});

describe("highscores legacy links", () => {
  it("redirects /highscores?skill=<id> to the genre board with a 308", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/highscores?skill=soulslike"));
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("http://localhost:3000/highscores/genero/soulslike");
  });

  it("leaves other highscores requests alone", async () => {
    for (const url of ["/highscores", "/highscores?skill=geral", "/highscores?skill=nope", "/highscores/horas?skill=rpg"]) {
      expect((await proxy(new NextRequest(`http://localhost:3000${url}`))).status, url).toBe(200);
    }
    expect(findUnique).not.toHaveBeenCalled();
  });
});
