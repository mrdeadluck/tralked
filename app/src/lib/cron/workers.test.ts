import { describe, expect, it, vi } from "vitest";
import { dispatchWorkers, dueWorkers } from "./workers";

const at = (iso: string) => new Date(iso);

describe("GitHub workers started by the Vercel Cron", () => {
  it("knows which workers are due each hour", () => {
    expect(dueWorkers(at("2026-11-03T01:28:00Z"))).toEqual(["platform-import.yml", "steam-players.yml"]);
    expect(dueWorkers(at("2026-11-03T02:28:00Z"))).toEqual(["steam-details.yml"]);
    expect(dueWorkers(at("2026-11-03T04:28:00Z"))).toEqual(["catalog-enrich.yml"]);
    expect(dueWorkers(at("2026-11-03T03:28:00Z"))).toEqual(["platform-import.yml", "steam-players.yml"]);
    // 2026-11-08 is a Sunday.
    expect(dueWorkers(at("2026-11-08T03:28:00Z"))).toEqual(["platform-import.yml", "steam-players.yml", "retro-catalog.yml"]);
    expect(dueWorkers(at("2026-11-03T06:28:00Z"))).toEqual([]);
  });

  it("does nothing without a token", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      dispatchWorkers(at("2026-11-03T01:28:00Z"), { token: undefined, fetcher: fetcher as unknown as typeof fetch }),
    ).resolves.toEqual({ processed: 0, status: "disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("dispatches each due workflow on main and counts refusals", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes("steam-players") ? new Response("Bad credentials", { status: 401 }) : new Response(null, { status: 204 }),
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await dispatchWorkers(at("2026-11-03T01:28:00Z"), { token: "t", fetcher: fetcher as unknown as typeof fetch });
      expect(result).toEqual({ processed: 1, failed: 1, started: ["platform-import.yml"] });
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("steam-players.yml: HTTP 401"));
    } finally {
      logged.mockRestore();
    }
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/mrdeadluck/tralked/actions/workflows/platform-import.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });
});
