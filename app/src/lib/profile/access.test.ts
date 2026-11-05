import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));
const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));

const { profileAccess } = await import("./access");

// The cached header (getPlayerHeaderCached) still says public.
const header = { id: "u1", handle: "fulano", displayName: "Fulano", profilePublic: true };

describe("profileAccess", () => {
  beforeEach(() => {
    getSessionUser.mockReset();
    findUnique.mockReset();
  });

  it("hides a profile the database says is private, though the cached header says public", async () => {
    // A sync outside Next (the GitHub import worker) found the Steam profile private.
    findUnique.mockResolvedValue({ profilePublic: false });
    getSessionUser.mockResolvedValue({ id: "someone-else", role: "member" });
    await expect(profileAccess(header)).resolves.toMatchObject({ isOwner: false, visible: false });
    getSessionUser.mockResolvedValue(null);
    await expect(profileAccess(header)).resolves.toMatchObject({ viewer: null, visible: false });
  });

  it("always shows the owner their profile, and gives back the viewer", async () => {
    findUnique.mockResolvedValue({ profilePublic: false });
    const owner = { id: "u1", role: "member" };
    getSessionUser.mockResolvedValue(owner);
    await expect(profileAccess(header)).resolves.toEqual({ viewer: owner, isOwner: true, visible: true });
  });

  it("shows a public profile to visitors", async () => {
    findUnique.mockResolvedValue({ profilePublic: true });
    getSessionUser.mockResolvedValue(null);
    await expect(profileAccess(header)).resolves.toMatchObject({ isOwner: false, visible: true });
  });
});
