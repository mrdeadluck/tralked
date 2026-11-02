import { describe, expect, it } from "vitest";
import { canAccess, requiredLevel } from "@/lib/admin/access";
import {
  canEditArticles,
  canModerate,
  canSanction,
  interactionBlock,
  isBanned,
  isMuted,
  postingBlock,
} from "./permissions";

const NOW = new Date("2026-11-04T12:00:00Z");
const later = new Date("2026-11-10T02:59:59Z");
const earlier = new Date("2026-11-01T00:00:00Z");

describe("roles", () => {
  it("only admin and editor edit articles from the article page", () => {
    expect(["admin", "editor"].map(canEditArticles)).toEqual([true, true]);
    expect(["moderator", "author", "user", "Admin", "", null, undefined].map(canEditArticles)).toEqual(Array(7).fill(false));
  });

  it("admin, editor and moderator moderate the community", () => {
    expect(["admin", "editor", "moderator"].map(canModerate)).toEqual([true, true, true]);
    expect(["author", "user", "MODERATOR", null].map(canModerate)).toEqual([false, false, false, false]);
  });

  it("moderators reach /admin/moderacao and nothing else of /admin", () => {
    expect(requiredLevel("/admin/moderacao")).toBe("moderation");
    expect(requiredLevel("/ADMIN/Moderacao/")).toBe("moderation");
    expect(requiredLevel("/admin")).toBe("staff");
    expect(requiredLevel("/admin/noticias/x")).toBe("staff");
    expect(canAccess("moderator", "moderation")).toBe(true);
    expect(canAccess("moderator", "staff")).toBe(false);
    expect(canAccess("moderator", "admin")).toBe(false);
    expect(canAccess("editor", "moderation")).toBe(true);
    expect(canAccess("user", "moderation")).toBe(false);
    expect(canAccess("author", "moderation")).toBe(false);
  });
});

describe("canSanction", () => {
  const admin = { id: "a", role: "admin" };
  const editor = { id: "e", role: "editor" };
  const mod = { id: "m", role: "moderator" };
  const user = { id: "u", role: "user" };
  const author = { id: "w", role: "author" };

  it("moderators sanction players and authors", () => {
    for (const actor of [admin, editor, mod]) {
      expect(canSanction(actor, user)).toBe(true);
      expect(canSanction(actor, author)).toBe(true);
    }
  });

  it("nobody sanctions themselves or an admin; only admins sanction staff", () => {
    expect(canSanction(mod, mod)).toBe(false);
    expect(canSanction(admin, admin)).toBe(false);
    expect(canSanction(admin, { id: "a2", role: "admin" })).toBe(false);
    expect(canSanction(mod, editor)).toBe(false);
    expect(canSanction(editor, { id: "m2", role: "moderator" })).toBe(false);
    expect(canSanction(admin, editor)).toBe(true);
    expect(canSanction(admin, mod)).toBe(true);
  });

  it("players and authors sanction nobody", () => {
    expect(canSanction(user, { id: "x", role: "user" })).toBe(false);
    expect(canSanction(author, user)).toBe(false);
  });
});

describe("sanction checks", () => {
  it("a sanction counts only until its end date; missing fields mean none", () => {
    expect(isMuted({ mutedUntil: later }, NOW)).toBe(true);
    expect(isMuted({ mutedUntil: earlier }, NOW)).toBe(false);
    expect(isMuted({ mutedUntil: null }, NOW)).toBe(false);
    expect(isMuted({}, NOW)).toBe(false);
    expect(isBanned({ bannedUntil: later }, NOW)).toBe(true);
    expect(isBanned({ bannedUntil: earlier }, NOW)).toBe(false);
  });

  it("a mute blocks posting but not interacting; a ban blocks both", () => {
    expect(postingBlock({ mutedUntil: later, bannedUntil: null }, NOW)).toBe(
      "Você está silenciado até 09/11/2026, 23:59. Até lá, não pode comentar nem publicar.",
    );
    expect(interactionBlock({ mutedUntil: later, bannedUntil: null }, NOW)).toBeNull();
    expect(postingBlock({ bannedUntil: later }, NOW)).toMatch(/suspensa até 09\/11\/2026/);
    expect(interactionBlock({ bannedUntil: later }, NOW)).toMatch(/suspensa/);
    expect(postingBlock({ mutedUntil: earlier, bannedUntil: earlier }, NOW)).toBeNull();
  });
});
