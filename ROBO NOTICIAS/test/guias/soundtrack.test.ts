import { describe, expect, it, vi } from "vitest";
import type { Ai } from "../../src/ai/client.js";
import { findSoundtrack, youtubeOembed } from "../../src/guias/soundtrack.js";
import type { FetchPage } from "../../src/guias/sources.js";

const game = { name: "Phantom Blade Zero", developer: "S-GAME", publisher: "S-GAME" };
const hits = [{ title: "Phantom Blade Zero OST", url: "https://www.youtube.com/watch?v=abc123DEF45" }];

/** The channel's page: its handle by default (oEmbed's author_url). */
const handleOf = (channel: string) => `https://www.youtube.com/@${channel.replace(/[^A-Za-z0-9-]/g, "")}`;

function deps(
  channel: string,
  judge: { official: boolean; relation: string } = { official: false, relation: "none" },
  channelUrl: string | null = handleOf(channel),
) {
  const structured = vi.fn(async (_opts: unknown) => judge);
  return {
    ai: { structured } as unknown as Ai,
    structured,
    search: vi.fn(async (_q: string) => hits),
    oembed: vi.fn(async (_url: string) => ({ title: "Phantom Blade Zero OST", channel, ...(channelUrl ? { channelUrl } : {}) })),
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

  it("nome de exibição igual ao da publicadora não basta: o endereço do canal tem que ser dela", async () => {
    // Anyone can call a channel "S-GAME": the handle is unique.
    expect(await findSoundtrack(deps("S-GAME").ai, game, deps("S-GAME", undefined, "https://www.youtube.com/@sgamefanuploads"))).toBeNull();
    // Only a channel id: nothing to check the name against.
    expect(await findSoundtrack(deps("S-GAME").ai, game, deps("S-GAME", undefined, "https://www.youtube.com/channel/UC1234567890abcdefghij"))).toBeNull();
    expect(await findSoundtrack(deps("S-GAME").ai, game, deps("S-GAME", undefined, null))).toBeNull();
    expect(await findSoundtrack(deps("S-GAME").ai, game, deps("S-GAME", undefined, "https://www.youtube.com/@SGAMEOfficial"))).not.toBeNull();
  });

  it("título sem o nome do jogo é descartado sem consultar o canal", async () => {
    const d = deps("S-GAME Official");
    d.search.mockResolvedValue([{ title: "Some other game OST", url: "https://youtu.be/abc123DEF45" }]);
    expect(await findSoundtrack(d.ai, game, d)).toBeNull();
    expect(d.oembed).not.toHaveBeenCalled();
  });
});

describe("youtubeOembed", () => {
  it("lê o oEmbed pela leitura educada (robots.txt e intervalo por host) e devolve o endereço do canal", async () => {
    const urls: string[] = [];
    const fetchPage: FetchPage = async (url) => {
      urls.push(url);
      return {
        status: "ok",
        finalUrl: url,
        html: JSON.stringify({ title: "Phantom Blade Zero OST", author_name: "S-GAME", author_url: "https://www.youtube.com/@SGAMEOfficial" }),
        text: "",
      };
    };
    expect(await youtubeOembed("https://www.youtube.com/watch?v=abc123DEF45", fetchPage)).toEqual({
      title: "Phantom Blade Zero OST",
      channel: "S-GAME",
      channelUrl: "https://www.youtube.com/@SGAMEOfficial",
    });
    expect(urls).toEqual(["https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabc123DEF45"]);
  });

  it("bloqueado, erro ou resposta que não é JSON → null", async () => {
    const blocked: FetchPage = async (url) => ({ status: "blocked", finalUrl: url, reason: "robots.txt" });
    const garbage: FetchPage = async (url) => ({ status: "ok", finalUrl: url, html: "<html>no</html>", text: "no" });
    expect(await youtubeOembed("https://youtu.be/abc123DEF45", blocked)).toBeNull();
    expect(await youtubeOembed("https://youtu.be/abc123DEF45", garbage)).toBeNull();
  });
});
