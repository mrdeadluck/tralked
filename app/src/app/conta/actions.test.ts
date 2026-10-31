import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const destroySession = vi.fn();
const updateTag = vi.fn();
const redirect = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});
const deleteAccount = vi.fn();
const updateProfileSettings = vi.fn();
const visibilityTags = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getSessionUser, destroySession }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag,
}));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/accounts/delete", () => ({ deleteAccount }));
vi.mock("@/lib/accounts/privacy", () => ({ visibilityTags }));
vi.mock("@/lib/accounts/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/accounts/settings")>()),
  updateProfileSettings,
}));

const { deleteAccountAction, updateProfileAction } = await import("./actions");

beforeEach(() => {
  vi.clearAllMocks();
  getSessionUser.mockResolvedValue({ id: "u1", handle: "eu" });
  updateProfileSettings.mockResolvedValue({ visibilityChanged: false });
  visibilityTags.mockResolvedValue(["gallery", "forum", "photo:p1", "player:eu"]);
});

describe("updateProfileAction", () => {
  it("needs a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await updateProfileAction({ bio: "oi", profilePublic: true })).toMatchObject({ ok: false });
    expect(updateProfileSettings).not.toHaveBeenCalled();
  });

  it("saves a trimmed plain-text bio and the visibility", async () => {
    expect(await updateProfileAction({ bio: "  Caçador de platinas \r\n", profilePublic: false })).toEqual({ ok: true });
    expect(updateProfileSettings).toHaveBeenCalledWith("u1", { bio: "Caçador de platinas", profilePublic: false });
    expect(updateTag).not.toHaveBeenCalled(); // visibility did not change
  });

  it("going private (or public) refreshes the gallery, photo, forum and profile caches at once", async () => {
    updateProfileSettings.mockResolvedValue({ visibilityChanged: true });
    expect(await updateProfileAction({ bio: "", profilePublic: false })).toEqual({ ok: true });
    expect(visibilityTags).toHaveBeenCalledWith("u1");
    for (const tag of ["gallery", "forum", "photo:p1", "player:eu"]) expect(updateTag).toHaveBeenCalledWith(tag);
  });

  it("refuses HTML, bios over 280 characters and malformed input", async () => {
    const results = await Promise.all([
      updateProfileAction({ bio: "<script>alert(1)</script>", profilePublic: true }),
      updateProfileAction({ bio: "a".repeat(281), profilePublic: true }),
      updateProfileAction({ bio: "ok", profilePublic: "sim" }),
      updateProfileAction("nope"),
    ]);
    for (const result of results) expect(result.ok).toBe(false);
    expect(results[0]).toMatchObject({ error: expect.stringMatching(/HTML/) });
    expect(results[1]).toMatchObject({ error: expect.stringMatching(/280/) });
    expect(updateProfileSettings).not.toHaveBeenCalled();
  });
});

describe("deleteAccountAction", () => {
  it("needs a session and the typed confirmation", async () => {
    getSessionUser.mockResolvedValueOnce(null);
    expect(await deleteAccountAction({ confirmation: "EXCLUIR" })).toMatchObject({ ok: false });
    expect(await deleteAccountAction({ confirmation: "excluir" })).toMatchObject({ ok: false });
    expect(await deleteAccountAction({})).toMatchObject({ ok: false });
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
  });

  it("deletes only the logged-in user, logs out, refreshes their public pages and goes home", async () => {
    deleteAccount.mockResolvedValue({ photoIds: ["p1"], threadIds: ["t1"], guideGameSlugs: ["hollow-knight"] });

    await expect(deleteAccountAction({ confirmation: "EXCLUIR", userId: "someone-else" })).rejects.toThrow("NEXT_REDIRECT");

    expect(deleteAccount).toHaveBeenCalledWith("u1");
    expect(destroySession).toHaveBeenCalled();
    expect(updateTag).toHaveBeenCalledWith("photo:p1");
    expect(updateTag).toHaveBeenCalledWith("thread:t1");
    expect(updateTag).toHaveBeenCalledWith("game:hollow-knight");
    expect(updateTag).toHaveBeenCalledWith("player:eu");
    expect(redirect).toHaveBeenCalledWith("/?conta=excluida");
  });

  it("keeps the session when the deletion fails", async () => {
    deleteAccount.mockRejectedValue(new Error("db down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await deleteAccountAction({ confirmation: "EXCLUIR" })).toMatchObject({ ok: false });
    expect(destroySession).not.toHaveBeenCalled();
    error.mockRestore();
  });
});
