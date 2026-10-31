import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();
const getPlayerSummary = vi.fn();

vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique, create, update } } }));
vi.mock("@/lib/integrations", () => ({ getSteam: () => ({ getPlayerSummary }) }));

const { generateHandle, slugifyPersonaName, upsertUserFromSteam } = await import("./upsert-user");

const STEAM_ID = "76561198000001234";

beforeEach(() => {
  vi.clearAllMocks();
  getPlayerSummary.mockResolvedValue({
    steamId: STEAM_ID,
    personaName: "Lucas Épico!",
    avatarUrl: "https://img/a.jpg",
    profilePublic: true,
  });
});

describe("slugifyPersonaName", () => {
  it("lowercases, strips accents and non [a-z0-9_] and caps at 20", () => {
    expect(slugifyPersonaName("Lucas Épico!")).toBe("lucas_epico");
    expect(slugifyPersonaName("A".repeat(40))).toBe("a".repeat(20));
    expect(slugifyPersonaName("  --Foo__Bar--  ")).toBe("foo_bar");
  });

  it("falls back when nothing usable remains", () => {
    expect(slugifyPersonaName("日本語")).toBe("jogador");
    expect(slugifyPersonaName("")).toBe("jogador");
  });
});

describe("generateHandle", () => {
  const taken = (...handles: string[]) => async (handle: string) => handles.includes(handle);

  it("uses the slug when free", async () => {
    await expect(generateHandle("Lucas", STEAM_ID, taken())).resolves.toBe("lucas");
  });

  it("appends the last 4 digits of the steamId on collision", async () => {
    await expect(generateHandle("Lucas", STEAM_ID, taken("lucas"))).resolves.toBe("lucas1234");
  });

  it("then appends a counter", async () => {
    await expect(generateHandle("Lucas", STEAM_ID, taken("lucas", "lucas1234"))).resolves.toBe(
      "lucas12342",
    );
    await expect(
      generateHandle("Lucas", STEAM_ID, taken("lucas", "lucas1234", "lucas12342")),
    ).resolves.toBe("lucas12343");
  });

  it("never exceeds 20 chars", async () => {
    const long = "a".repeat(20);
    const handle = await generateHandle(long, STEAM_ID, taken(long));
    expect(handle).toBe("a".repeat(16) + "1234");
    const counter = await generateHandle(long, STEAM_ID, taken(long, handle));
    expect(counter.length).toBeLessThanOrEqual(20);
    expect(counter).not.toBe(handle);
  });

  it("treats the reserved handle 'me' as taken", async () => {
    await expect(generateHandle("me", STEAM_ID, taken())).resolves.toBe("me1234");
  });
});

describe("upsertUserFromSteam", () => {
  it("creates a new user with a generated handle", async () => {
    findUnique.mockResolvedValue(null);
    create.mockImplementation(async ({ data }) => ({ id: "u1", ...data }));

    const user = await upsertUserFromSteam(STEAM_ID);

    expect(getPlayerSummary).toHaveBeenCalledWith(STEAM_ID);
    expect(create).toHaveBeenCalledWith({
      data: {
        steamId: STEAM_ID,
        handle: "lucas_epico",
        displayName: "Lucas Épico!",
        avatarUrl: "https://img/a.jpg",
        profilePublic: true,
      },
    });
    expect(user.handle).toBe("lucas_epico");
  });

  it("updates profile fields for an existing user but never the handle", async () => {
    findUnique.mockResolvedValue({ id: "u1", steamId: STEAM_ID, handle: "old_handle" });
    update.mockImplementation(async ({ data }) => ({ id: "u1", handle: "old_handle", ...data }));

    await upsertUserFromSteam(STEAM_ID);

    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({
      where: { steamId: STEAM_ID },
      data: { displayName: "Lucas Épico!", avatarUrl: "https://img/a.jpg", profilePublic: true },
    });
  });
});
