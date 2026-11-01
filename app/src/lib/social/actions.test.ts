import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The social Server Actions run for real; only the session and cache invalidation are faked.
const session = vi.hoisted(() => ({ user: null as { id: string; handle: string } | null }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: async () => session.user }));
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  updateTag: () => {},
  refresh: () => {},
}));

const PREFIX = "test_social_actions_";

describe("social Server Actions", () => {
  let a: { id: string; handle: string };
  let b: { id: string; handle: string };

  beforeAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
    a = await prisma.user.create({ data: { handle: `${PREFIX}a`, displayName: "A" } });
    b = await prisma.user.create({ data: { handle: `${PREFIX}b`, displayName: "B" } });
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.conversation.deleteMany({ where: { OR: [{ userLowId: { in: [a.id, b.id] } }, { userHighId: { in: [a.id, b.id] } }] } });
    await prisma.user.deleteMany({ where: { handle: { startsWith: PREFIX } } });
  });

  it("refuse visitors", async () => {
    const actions = await import("./actions");
    session.user = null;
    const login = { status: "error", message: "Entre na sua conta para continuar." };
    expect(await actions.reactAction({ kind: "comment", id: "x", value: 1 })).toEqual(login);
    expect(await actions.followAction({ userId: b.id, follow: true })).toEqual(login);
    expect(await actions.sendMessageAction({ to: b.id, body: "oi" })).toEqual(login);
    expect(await actions.setDmPolicyAction({ policy: "friends" })).toEqual(login);
  });

  it("validate their input: HTML messages and unknown values are refused", async () => {
    const actions = await import("./actions");
    session.user = a;
    expect(await actions.sendMessageAction({ to: b.id, body: "<script>alert(1)</script>" })).toEqual({
      status: "error",
      message: "HTML não é permitido. Escreva só o texto.",
    });
    expect(await actions.sendMessageAction({ to: b.id, body: "   " })).toMatchObject({ status: "error" });
    expect(await actions.reactAction({ kind: "comment", id: "x", value: 2 })).toMatchObject({ status: "error" });
    expect(await actions.setDmPolicyAction({ policy: "todos" })).toMatchObject({ status: "error" });
    expect(await actions.sendMessageAction({ to: b.id, body: "oi, tudo bem?" })).toMatchObject({
      status: "ok",
      message: { body: "oi, tudo bem?", mine: true },
    });
    session.user = null;
  });
});
