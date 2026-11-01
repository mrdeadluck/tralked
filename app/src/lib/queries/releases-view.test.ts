import { describe, expect, it } from "vitest";
import { groupReleases, relativeDay, releaseDateText, topReleases, type ReleaseView } from "./releases";

type Row = Parameters<typeof groupReleases>[0][number];

const row = (gameId: string, platform: string, date: string | null, extra: Partial<Row> = {}): Row => ({
  gameId,
  platform,
  date: date ? new Date(`${date}T00:00:00Z`) : null,
  dateLabel: null,
  source: "steam",
  score: 10,
  imageUrl: null,
  seenAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  game: { slug: gameId, name: gameId.toUpperCase(), coverUrl: null, stub: false },
  ...extra,
});

describe("release views", () => {
  it("writes dates and relative days in Portuguese", () => {
    expect(releaseDateText("2026-11-14", "2026-10-31")).toBe("14 de nov.");
    expect(releaseDateText("2027-01-02", "2026-10-31")).toBe("2 de jan. de 2027");
    expect(releaseDateText("2026-05-02", "2026-10-31")).toBe("2 de maio");
    expect(relativeDay("2026-10-31", "2026-10-31")).toBe("hoje");
    expect(relativeDay("2026-11-01", "2026-10-31")).toBe("amanhã");
    expect(relativeDay("2026-10-30", "2026-10-31")).toBe("ontem");
    expect(relativeDay("2026-11-10", "2026-10-31")).toBe("em 10 dias");
    expect(relativeDay("2026-10-21", "2026-10-31")).toBe("há 10 dias");
  });

  it("groups a game's platforms into one entry, PC first, soonest day for Próximos", () => {
    const rows = [
      row("a", "XBOX", "2026-11-20", { score: 5 }),
      row("a", "PC", "2026-11-10", { score: 30, imageUrl: "https://shared.fastly.steamstatic.com/x.jpg" }),
      row("b", "NINTENDO", "2026-11-05"),
      row("c", "PLAYSTATION", null, { dateLabel: "4º trimestre de 2026" }),
    ];
    const views = groupReleases(rows, "proximos", "2026-10-31");
    expect(views.map((v) => v.gameId)).toEqual(["b", "a", "c"]);
    const a = views[1];
    expect(a.platforms).toEqual(["PC", "XBOX"]);
    expect(a.day).toBe("2026-11-10");
    expect(a.score).toBe(30);
    expect(a.capsuleUrl).toContain("steamstatic");
    expect(views[2]).toMatchObject({ day: null, dateText: "4º trimestre de 2026", relative: null });
    // Últimos: most recent first, and a game's latest day in the window.
    const past = groupReleases([row("x", "PC", "2026-10-01"), row("x", "PLAYSTATION", "2026-10-20"), row("y", "PC", "2026-10-10")], "ultimos", "2026-10-31");
    expect(past.map((v) => [v.gameId, v.day])).toEqual([
      ["x", "2026-10-20"],
      ["y", "2026-10-10"],
    ]);
  });

  it("an undated release without a label is 'a definir'", () => {
    expect(groupReleases([row("z", "PC", null)], "proximos", "2026-10-31")[0].dateText).toBe("a definir");
  });

  it("the card keeps the most popular, shown in date order", () => {
    const list = [1, 2, 3, 4].map((i) => ({ gameId: `g${i}`, day: `2026-11-0${i}`, score: [5, 50, 1, 40][i - 1] }) as ReleaseView);
    expect(topReleases(list, 2).map((r) => r.gameId)).toEqual(["g2", "g4"]);
  });
});
