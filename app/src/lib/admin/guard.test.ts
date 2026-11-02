import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
const notFound = vi.fn(() => {
  throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
});
vi.mock("next/navigation", () => ({ notFound }));

const { requireStaffPage, canAccess } = await import("./guard");

const as = (role: string | null) =>
  getSessionUser.mockResolvedValue(role === null ? null : { id: "u1", handle: "eu", role });

beforeEach(() => vi.clearAllMocks());

describe("requireStaffPage (/admin pages)", () => {
  it.each([null, "user", "author"])("answers 404 to %s", async (role) => {
    as(role);
    await expect(requireStaffPage()).rejects.toThrow("404");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it.each(["editor", "admin"])("lets an %s in", async (role) => {
    as(role);
    await expect(requireStaffPage()).resolves.toMatchObject({ role });
    expect(notFound).not.toHaveBeenCalled();
  });

  it("lets moderators into moderation pages only", async () => {
    as("moderator");
    await expect(requireStaffPage("moderation")).resolves.toMatchObject({ role: "moderator" });
    await expect(requireStaffPage()).rejects.toThrow("404");
    as("user");
    await expect(requireStaffPage("moderation")).rejects.toThrow("404");
  });

  it("keeps editors out of admin-only pages", async () => {
    as("editor");
    await expect(requireStaffPage("admin")).rejects.toThrow("404");
    as("admin");
    await expect(requireStaffPage("admin")).resolves.toMatchObject({ role: "admin" });
  });
});

describe("canAccess", () => {
  it("maps roles to levels", () => {
    expect(canAccess("admin", "admin")).toBe(true);
    expect(canAccess("editor", "admin")).toBe(false);
    expect(canAccess("editor", "staff")).toBe(true);
    expect(canAccess("author", "staff")).toBe(false);
    expect(canAccess("Admin", "staff")).toBe(false);
    expect(canAccess(undefined, "staff")).toBe(false);
  });
});
