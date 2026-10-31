import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hasKey = vi.fn();
const findUnique = vi.fn();
const createSession = vi.fn();

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
vi.mock("@/lib/env", () => ({ env: { APP_URL: "http://localhost:3000" }, hasKey }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("@/lib/auth/session", () => ({ createSession }));

const { GET } = await import("./route");

beforeEach(() => {
  vi.clearAllMocks();
  hasKey.mockReturnValue(false);
  findUnique.mockResolvedValue({ id: "u1", handle: "lucas" });
});

afterEach(() => vi.unstubAllEnvs());

describe("demo login", () => {
  it("logs in as lucas outside production without a Steam key", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET();
    expect(createSession).toHaveBeenCalledWith("u1");
    expect(new URL(response.headers.get("location")!).pathname).toBe("/jogador/lucas");
  });

  it("is a 404 when a Steam key is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    hasKey.mockReturnValue(true);
    const response = await GET();
    expect(response.status).toBe(404);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("is a 404 in production even without a Steam key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET();
    expect(response.status).toBe(404);
    expect(createSession).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
