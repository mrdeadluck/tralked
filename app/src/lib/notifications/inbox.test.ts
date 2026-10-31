import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSessionUser }));

const { prisma } = await import("@/lib/db");
const { getBell, getInbox, markAllRead, BELL_LIMIT } = await import("./inbox");
const { markAllReadAction, markReadAction } = await import("./actions");

const MARK = "t11-inbox";
let me: { id: string };
let other: { id: string };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
  me = await prisma.user.create({ data: { handle: `${MARK}-eu`, displayName: "Eu" } });
  other = await prisma.user.create({ data: { handle: `${MARK}-outro`, displayName: "Outro" } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { handle: { startsWith: MARK } } });
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [me.id, other.id] } } });
  getSessionUser.mockResolvedValue(me);
  const base = Date.now() - 60 * 60_000;
  await prisma.notification.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({
      userId: me.id,
      kind: "system",
      title: `aviso ${i}`,
      href: i === 0 ? "javascript:alert(1)" : i === 1 ? "//evil.example.com" : `/noticias/n${i}`,
      createdAt: new Date(base + i * 60_000),
      readAt: i < 3 ? new Date() : null,
    })),
  });
  await prisma.notification.create({ data: { userId: other.id, kind: "system", title: "de outra pessoa" } });
});

describe("notification inbox", () => {
  it("bell: unread count and the latest 8, newest first, only the user's own", async () => {
    const bell = await getBell(me.id);
    expect(bell.unread).toBe(7);
    expect(bell.items).toHaveLength(BELL_LIMIT);
    expect(bell.items[0].title).toBe("aviso 9");
    expect(bell.items.every((n) => n.title.startsWith("aviso"))).toBe(true);
  });

  it("never returns an external or script href", async () => {
    const { items } = await getInbox(me.id, 1);
    const byTitle = new Map(items.map((n) => [n.title, n.href]));
    expect(byTitle.get("aviso 0")).toBeNull();
    expect(byTitle.get("aviso 1")).toBeNull();
    expect(byTitle.get("aviso 2")).toBe("/noticias/n2");
  });

  it("paginates and clamps out-of-range pages", async () => {
    const page = await getInbox(me.id, 99, 4);
    expect(page).toMatchObject({ page: 3, pageCount: 3, total: 10, unread: 7 });
    expect(page.items).toHaveLength(2);
  });

  it("markAllRead touches only the user's unread notifications", async () => {
    expect(await markAllRead(me.id)).toBe(7);
    expect((await getBell(me.id)).unread).toBe(0);
    expect(await prisma.notification.count({ where: { userId: other.id, readAt: null } })).toBe(1);
  });
});

describe("notification actions", () => {
  it("need a session", async () => {
    getSessionUser.mockResolvedValue(null);
    expect(await markAllReadAction()).toMatchObject({ ok: false });
    expect(await markReadAction("x")).toMatchObject({ ok: false });
    expect((await getBell(me.id)).unread).toBe(7);
  });

  it("mark all read", async () => {
    expect(await markAllReadAction()).toEqual({ ok: true });
    expect((await getBell(me.id)).unread).toBe(0);
  });

  it("mark one read, refusing someone else's notification and malformed ids", async () => {
    const mine = await prisma.notification.findFirstOrThrow({ where: { userId: me.id, readAt: null } });
    const theirs = await prisma.notification.findFirstOrThrow({ where: { userId: other.id } });
    expect(await markReadAction(mine.id)).toEqual({ ok: true });
    expect(await markReadAction(theirs.id)).toMatchObject({ ok: false });
    expect(await markReadAction({ id: mine.id })).toMatchObject({ ok: false });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect((await getBell(me.id)).unread).toBe(6);
  });
});
