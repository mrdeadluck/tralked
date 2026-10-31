import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const exportUserData = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/accounts/export", () => ({ exportUserData }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /conta/exportar", () => {
  it("refuses visitors without a session", async () => {
    getSessionUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(exportUserData).not.toHaveBeenCalled();
  });

  it("downloads the logged-in user's own export as a JSON attachment", async () => {
    getSessionUser.mockResolvedValue({ id: "u1", handle: "lucas" });
    exportUserData.mockResolvedValue({ exportedAt: "2026-10-31T12:00:00.000Z", user: { id: "u1" } });

    const response = await GET();

    expect(exportUserData).toHaveBeenCalledWith("u1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="tralked-lucas-2026-10-31.json"');
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ exportedAt: "2026-10-31T12:00:00.000Z", user: { id: "u1" } });
  });
});
