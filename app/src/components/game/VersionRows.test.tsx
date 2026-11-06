import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { GameVersion, PlayerVersion } from "@/lib/queries/game-versions";
import { VersionRows } from "./VersionRows";

afterEach(cleanup);

const tiers = { platinum: 1, gold: 1, silver: 0, bronze: 1 };
const version = (key: string, label: string, platform: GameVersion["platform"], over: Partial<GameVersion> = {}): GameVersion => ({
  key,
  platform,
  label,
  total: 3,
  tiers,
  nativePlatinum: platform === "psn",
  lists: [{ id: `${key}-1`, label: null, trophyCount: 3 }],
  trophies: [],
  ...over,
});
const player = (v: GameVersion, over: Partial<PlayerVersion> = {}): PlayerVersion => ({
  key: v.key,
  label: v.label,
  platform: v.platform,
  nativePlatinum: v.nativePlatinum,
  unlocked: 1,
  total: v.total,
  pct: 33,
  platinum: false,
  lists: [],
  countedNote: null,
  earnedIn: {},
  bestListId: null,
  unlockedAt: {},
  tiersEarned: { platinum: 0, gold: 0, silver: 0, bronze: 1 },
  earnedAt: {},
  xp: {},
  ...over,
});

const PS5 = version("psn:PS5", "PS5", "psn", {
  total: 78,
  lists: [
    { id: "a", label: "Lista 1", trophyCount: 78 },
    { id: "b", label: "🇯🇵 Ásia", trophyCount: 78 },
  ],
});
const PS3 = version("psn:PS3", "PS3", "psn", { total: 59 });
const STEAM = version("steam", "PC · Steam", "steam", { total: 77, nativePlatinum: false, lists: [] });

describe("VersionRows", () => {
  it("VersionRows renders one row per version with PLATINA or %", () => {
    render(
      <VersionRows
        versions={[STEAM, PS5, PS3]}
        player={[
          player(STEAM, { unlocked: 49, pct: 64 }),
          player(PS5, { unlocked: 78, pct: 100, platinum: true }),
          player(PS3, { unlocked: 20, pct: 34 }),
        ]}
        label="Seu progresso por versão"
      />,
    );
    const rows = within(screen.getByRole("list", { name: "Seu progresso por versão" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("PC · Steam");
    expect(rows[0]).toHaveTextContent("49/77");
    expect(rows[0]).toHaveTextContent("64%");
    expect(rows[1]).toHaveTextContent(/platina/i);
    expect(rows[1]).not.toHaveTextContent("%");
    expect(rows[2]).toHaveTextContent("20/59");
    expect(rows[2]).toHaveTextContent("34%");
    expect(screen.getAllByRole("progressbar").map((b) => b.getAttribute("aria-valuenow"))).toEqual(["64", "100", "34"]);
  });

  it("region chips show ✓ for completed lists", () => {
    render(
      <VersionRows
        versions={[PS5]}
        player={[
          player(PS5, {
            unlocked: 78,
            pct: 100,
            platinum: true,
            countedNote: "2 listas · conta 1",
            lists: [
              { id: "a", label: "Lista 1", complete: true, unlocked: 78 },
              { id: "b", label: "🇯🇵 Ásia", complete: false, unlocked: 12 },
            ],
          }),
        ]}
        label="Seu progresso por versão"
      />,
    );
    const done = screen.getByText("Lista 1").closest("[data-chip]")!;
    const open = screen.getByText("🇯🇵 Ásia").closest("[data-chip]")!;
    expect(done).toHaveTextContent("✓");
    expect(done).toHaveTextContent("completa");
    expect(open).not.toHaveTextContent("✓");
    expect(screen.getByText("2 listas · conta 1")).toBeInTheDocument();
  });

  it("visitor rows have no marks", () => {
    render(<VersionRows versions={[STEAM, PS5, PS3]} label="Versões do jogo" />);
    const list = screen.getByRole("list", { name: "Versões do jogo" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[1]).toHaveTextContent("PS5");
    expect(rows[1]).toHaveTextContent("Lista 1");
    expect(rows[1]).toHaveTextContent("2 listas · conta 1");
    expect(rows[1]).toHaveTextContent("78");
    expect(rows[0]).toHaveTextContent("conquistas");
    expect(rows[2]).toHaveTextContent("troféus");
    expect(list).not.toHaveTextContent("✓");
    expect(list).not.toHaveTextContent("%");
    expect(list).not.toHaveTextContent(/platina/i);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
