import { describe, expect, it } from "vitest";
import { groupReleases, relativeDay, releaseDateText, topReleases, weekHighlights, type ReleaseView } from "./releases";

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
  game: { slug: gameId, name: gameId.toUpperCase(), coverUrl: null, stub: false, popularity: 0, steamReviewTotal: null, steamPlayers: null },
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

  it("groups a game's platforms into one entry, PC first, soonest day for Próximos (equal heat: date order)", () => {
    const rows = [
      row("a", "XBOX", "2026-11-20", { score: 5 }),
      row("a", "PC", "2026-11-10", { score: 10, imageUrl: "https://shared.fastly.steamstatic.com/x.jpg" }),
      row("b", "NINTENDO", "2026-11-05"),
      row("c", "PLAYSTATION", null, { dateLabel: "4º trimestre de 2026" }),
    ];
    const views = groupReleases(rows, "proximos", "2026-10-31");
    expect(views.map((v) => v.gameId)).toEqual(["b", "a", "c"]);
    const a = views[1];
    expect(a.platforms).toEqual(["PC", "XBOX"]);
    expect(a.day).toBe("2026-11-10");
    expect(a.score).toBe(10);
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

  it("big releases lead: hype and reviews beat a fresh Steam list entry", () => {
    const rows = [
      row("fresh", "PC", "2026-10-31", { score: 999 }),
      row("gta", "PLAYSTATION", "2026-10-20", { source: "igdb", score: 4_000 }),
      row("hit", "PC", "2026-10-25", {
        score: 900,
        game: { slug: "hit", name: "HIT", coverUrl: null, stub: false, popularity: 0, steamReviewTotal: 2_000, steamPlayers: { current: 3_000 } },
      }),
    ];
    expect(groupReleases(rows, "ultimos", "2026-10-31").map((v) => v.gameId)).toEqual(["gta", "hit", "fresh"]);
  });

  it("the card keeps the biggest releases, biggest first", () => {
    const list = [1, 2, 3, 4].map((i) => ({ gameId: `g${i}`, day: `2026-11-0${i}`, heat: [5, 50, 1, 40][i - 1] }) as ReleaseView);
    expect(topReleases(list, 2).map((r) => r.gameId)).toEqual(["g2", "g4"]);
  });

  it("week highlights: the biggest of the last 7 days, or of the whole list when the week is thin", () => {
    const v = (gameId: string, day: string, heat: number) => ({ gameId, day, heat }) as ReleaseView;
    const list = [v("old", "2026-10-10", 900), v("a", "2026-10-30", 300), v("b", "2026-10-28", 500), v("c", "2026-10-31", 100)];
    expect(weekHighlights(list, "ultimos", "2026-10-31")).toEqual({ picks: [list[2], list[1], list[3]], week: true });
    expect(weekHighlights(list.slice(0, 2), "ultimos", "2026-10-31").week).toBe(false);
    expect(weekHighlights(list.slice(0, 2), "ultimos", "2026-10-31").picks[0].gameId).toBe("old");
  });
});
