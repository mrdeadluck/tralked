import { describe, expect, it, vi } from "vitest";
import type { Ai } from "../../src/ai/client.js";
import { findSoundtrack } from "../../src/guias/soundtrack.js";

const game = { name: "Phantom Blade Zero", developer: "S-GAME", publisher: "S-GAME" };
const hits = [{ title: "Phantom Blade Zero OST", url: "https://www.youtube.com/watch?v=abc123DEF45" }];

function deps(channel: string, judge: { official: boolean; relation: string } = { official: false, relation: "none" }) {
  const structured = vi.fn(async (_opts: unknown) => judge);
  return {
    ai: { structured } as unknown as Ai,
    structured,
    search: vi.fn(async (_q: string) => hits),
    oembed: vi.fn(async (_url: string) => ({ title: "Phantom Blade Zero OST", channel })),
  };
}

describe("findSoundtrack", () => {
  it("trilha de canal não oficial → null", async () => {
    const d = deps("Random Music Uploads");
    expect(await findSoundtrack(d.ai, game, d)).toBeNull();
  });

  it("trilha do canal da publicadora → youtubeId", async () => {
    const d = deps("S-GAME Official");
    expect(await findSoundtrack(d.ai, game, d)).toEqual({
      youtubeId: "abc123DEF45",
      title: "Phantom Blade Zero OST",
      channel: "S-GAME Official",
    });
    expect(d.structured).not.toHaveBeenCalled();
  });

  it("gravadora ou compositor só valem com evidência dos créditos; playlist vira playlistId", async () => {
    const d = deps("Sumthing Else Records");
    d.search.mockResolvedValue([{ title: "Phantom Blade Zero OST", url: "https://www.youtube.com/playlist?list=PLxyz" }]);
    expect(await findSoundtrack(d.ai, { ...game, label: "Sumthing Else" }, d)).toMatchObject({
      playlistId: "PLxyz",
      channel: "Sumthing Else Records",
    });
    expect(await findSoundtrack(d.ai, { ...game, composer: "Sumthing Else" }, d)).not.toBeNull();
  });

  it("juiz de IA não basta: sem evidência de gravadora/compositor → null", async () => {
    const d = deps("Sumthing Else Records", { official: true, relation: "label" });
    expect(await findSoundtrack(d.ai, game, d)).toBeNull();
    expect(d.structured).not.toHaveBeenCalled();
  });

  it("canal de fã que contém o nome da produtora → null", async () => {
    for (const channel of ["S-GAME Music Archive", "Fan Tracks - S-GAME OST", "S"]) {
      const d = deps(channel);
      expect(await findSoundtrack(d.ai, game, d)).toBeNull();
    }
  });

  it("canal automático '- Topic' do artista oficial casa", async () => {
    const d = deps("Hiroki Kikuta - Topic");
    expect(await findSoundtrack(d.ai, { ...game, composer: "Hiroki Kikuta" }, d)).not.toBeNull();
  });

  it("título sem o nome do jogo é descartado sem consultar o canal", async () => {
    const d = deps("S-GAME Official");
    d.search.mockResolvedValue([{ title: "Some other game OST", url: "https://youtu.be/abc123DEF45" }]);
    expect(await findSoundtrack(d.ai, game, d)).toBeNull();
    expect(d.oembed).not.toHaveBeenCalled();
  });
});
