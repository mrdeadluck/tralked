import { describe, expect, it } from "vitest";
import { classifyHeadline, mentionsGaming, mentionsTech, toNewsFeedArea } from "./areas";

const hades = { gameId: "g-hades" };
const eldenRing = { gameId: "g-elden" };
const readyOrNot = { gameId: "g-ready-or-not" };

describe("mentionsGaming", () => {
  it("finds gaming terms and unambiguous franchises as whole words, without accents or case", () => {
    expect(mentionsGaming("Série de The Last of Us ganha data da 3ª temporada")).toBe(true);
    expect(mentionsGaming("Anime de Pokémon estreia nova fase")).toBe(true);
    expect(mentionsGaming("Filme do JOGO mais vendido de 2025 é anunciado")).toBe(true);
    expect(mentionsGaming("Five Nights at Freddy's 3 tem trailer")).toBe(true);
    expect(mentionsGaming("Assassin's Creed vira série")).toBe(true);
    expect(mentionsGaming("Steam Deck 2 aparece em vazamento")).toBe(true);
    expect(mentionsGaming("The Game Awards 2026: indicados")).toBe(true);
  });

  it("ignores words that only contain a term", () => {
    expect(mentionsGaming("Vingadores: Endgame volta aos cinemas")).toBe(false);
    expect(mentionsGaming("Jogador de futebol estrela documentário")).toBe(false);
  });

  it("does not count names that are also people or ordinary words", () => {
    expect(mentionsGaming("Vanessa Kirby entra para o elenco de Quarteto Fantástico")).toBe(false);
    expect(mentionsGaming("Jack Kirby: documentário sobre o criador dos X-Men")).toBe(false);
    expect(mentionsGaming("Netflix's new thriller picks up steam on the charts")).toBe(false);
    expect(mentionsGaming("The fallout from the strike hits Hollywood")).toBe(false);
    expect(mentionsGaming("Novo anime sobre a yakuza estreia na Crunchyroll")).toBe(false);
    expect(mentionsGaming("Série cyberpunk japonesa ganha trailer")).toBe(false);
    expect(mentionsGaming("Halo de luz: filme de terror estreia")).toBe(false);
    expect(mentionsGaming("Control: thriller com Liam Neeson estreia")).toBe(false);
    // With another gaming signal in the same title they count.
    expect(mentionsGaming("Fallout ganha jogo novo da Bethesda")).toBe(true);
    expect(mentionsGaming("Kirby Air Riders é o jogo mais vendido da semana")).toBe(true);
  });

  it("drops false friends (films, series and idioms) but still sees a real term next to them", () => {
    expect(mentionsGaming("Jogos Vorazes: novo filme ganha trailer")).toBe(false);
    expect(mentionsGaming("Jogos Mortais 11 ganha data de estreia")).toBe(false);
    expect(mentionsGaming("O Jogo da Imitação volta à Netflix")).toBe(false);
    expect(mentionsGaming("Jogo Perigoso: adaptação de Stephen King ganha remake")).toBe(false);
    expect(mentionsGaming("Game of Thrones: spin-off confirmado")).toBe(false);
    expect(mentionsGaming("Round 6 tem 3ª temporada")).toBe(false);
    expect(mentionsGaming("Squid Game: Netflix anuncia reality")).toBe(false);
    expect(mentionsGaming("Jogos Olímpicos de inverno na TV")).toBe(false);
    expect(mentionsGaming("O que está em jogo na nova temporada")).toBe(false);
    expect(mentionsGaming("Game of Thrones ganha jogo para PS5")).toBe(true);
  });
});

describe("mentionsTech", () => {
  it("finds hardware and AI terms", () => {
    expect(mentionsTech("Nova placa de vídeo da Nvidia chega ao Brasil")).toBe(true);
    expect(mentionsTech("OpenAI lança modelo novo")).toBe(true);
    expect(mentionsTech("Inteligência artificial nas escolas")).toBe(true);
    expect(mentionsTech("Ryzen 9 bate recorde em benchmark")).toBe(true);
  });

  it("matches short acronyms only in upper case", () => {
    expect(mentionsTech("Como a IA mudou o mercado")).toBe(true);
    expect(mentionsTech("AI agents are coming to Windows")).toBe(true);
    expect(mentionsTech("Ele ia ao cinema quando ai, a chuva começou")).toBe(false);
    expect(mentionsTech("Monte seu PC com R$ 3 mil")).toBe(true);
  });

  it("keeps unrelated technology out", () => {
    expect(mentionsTech("Chevrolet derruba preço do Spark")).toBe(false);
    expect(mentionsTech("Como cancelar o Kindle+")).toBe(false);
  });
});

describe("classifyHeadline", () => {
  it("GAMES keeps only catalog games, even one-word names (Plan 2 rule)", () => {
    expect(classifyHeadline("GAMES", "Hades II sai do acesso antecipado", hades)).toEqual({ gameId: "g-hades" });
    expect(classifyHeadline("GAMES", "Novo jogo anunciado", null)).toBeNull();
  });

  it("ENTRETENIMENTO keeps game-related headlines and links the game", () => {
    expect(classifyHeadline("ENTRETENIMENTO", "Anime de Elden Ring é anunciado pela Bandai", eldenRing)).toEqual({ gameId: "g-elden" });
    expect(classifyHeadline("ENTRETENIMENTO", "Anime do jogo Elden Ring é anunciado", eldenRing)).toEqual({ gameId: "g-elden" });
    expect(classifyHeadline("ENTRETENIMENTO", "Série de The Last of Us renovada", null)).toEqual({ gameId: null });
    expect(classifyHeadline("ENTRETENIMENTO", "Novo filme do jogo Hades", hades)).toEqual({ gameId: "g-hades" });
  });

  it("ENTRETENIMENTO never keeps or links on a catalog name alone", () => {
    // The film "Ready or Not 2" is not the game Ready or Not.
    expect(classifyHeadline("ENTRETENIMENTO", "Ready or Not 2 ganha primeiro trailer", readyOrNot)).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Hades: filme sobre mitologia grega estreia", hades)).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Série de Fallout renovada", null)).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Vanessa Kirby entra para o elenco", { gameId: "g-kirby" })).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Nova placa de vídeo da Nvidia", null)).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Jogos Mortais 11 ganha data de estreia", null)).toBeNull();
    expect(classifyHeadline("ENTRETENIMENTO", "Harry Potter: série ganha elenco", null)).toBeNull();
  });

  it("TECNOLOGIA keeps games, hardware and AI; hardware/AI alone links no game", () => {
    expect(classifyHeadline("TECNOLOGIA", "Nova placa de vídeo da Nvidia", null)).toEqual({ gameId: null });
    expect(classifyHeadline("TECNOLOGIA", "Como a IA está mudando os estúdios", null)).toEqual({ gameId: null });
    expect(classifyHeadline("TECNOLOGIA", "Ready or Not roda a 60 fps no novo PC portátil", readyOrNot)).toEqual({ gameId: null });
    expect(classifyHeadline("TECNOLOGIA", "Jogo Elden Ring roda a 60 fps no novo portátil", eldenRing)).toEqual({ gameId: "g-elden" });
    expect(classifyHeadline("TECNOLOGIA", "Nvidia Control Panel ganha atualização", { gameId: "g-control" })).toEqual({ gameId: null });
    expect(classifyHeadline("TECNOLOGIA", "Startup picks up steam with new funding", null)).toBeNull();
    expect(classifyHeadline("TECNOLOGIA", "Banco lança novo aplicativo", null)).toBeNull();
  });
});

describe("toNewsFeedArea", () => {
  it("reads unknown values as GAMES", () => {
    expect(toNewsFeedArea("TECNOLOGIA")).toBe("TECNOLOGIA");
    expect(toNewsFeedArea("MERCADO")).toBe("GAMES");
    expect(toNewsFeedArea(null)).toBe("GAMES");
  });
});
