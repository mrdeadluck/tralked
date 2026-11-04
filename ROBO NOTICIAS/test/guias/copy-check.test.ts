import { describe, expect, it } from "vitest";
import { bannedExpressions, bannedInCode, DOUBT_PHRASES, doubtPhrases, sourceSites } from "../../src/guias/copy-check.js";
import type { GuideDossier } from "../../src/guias/dossier.js";

describe("voz v2: a dúvida nunca vai para o leitor (lista de frases proibidas)", () => {
  it("a lista tem as frases do manual", () => {
    expect(DOUBT_PHRASES).toEqual([
      "confira no jogo",
      "confirme no jogo",
      "as fontes divergem",
      "só uma fonte",
      "uma fonte diz",
      "não há certeza",
      "segundo as fontes",
      "em revisão",
      "as fontes",
    ]);
  });

  it.each([
    ["confira no jogo", "A erva fica perto da ponte; confira no jogo."],
    ["confirme no jogo", "Confirme no jogo antes de seguir."],
    ["as fontes divergem", "As fontes divergem sobre o total."],
    ["só uma fonte", "Só uma fonte cita este ponto."],
    ["uma fonte diz", "Uma fonte diz que o baú some depois do chefe."],
    ["não há certeza", "Não há certeza sobre o prazo."],
    ["segundo as fontes", "Segundo as fontes, são 3 ervas."],
    ["em revisão", "Este trecho está em revisão."],
    ["as fontes", "Todas as fontes concordam: são 3 ervas."],
  ])("pega \"%s\"", (phrase, text) => {
    expect(doubtPhrases(text)).toEqual([phrase]);
  });

  it("uma frase que contém outra da lista conta uma vez só (\"segundo as fontes\" não vira também \"as fontes\")", () => {
    expect(doubtPhrases("As fontes divergem sobre o total.")).toEqual(["as fontes divergem"]);
    expect(doubtPhrases("Segundo as fontes, são 3. As fontes não falam do baú.")).toEqual(["segundo as fontes", "as fontes"]);
  });

  it("sem caixa, sem acento e com marcação no meio também pega", () => {
    expect(doubtPhrases("SO UMA FONTE cita isso.")).toEqual(["só uma fonte"]);
    expect(doubtPhrases("nao ha certeza do prazo")).toEqual(["não há certeza"]);
    expect(doubtPhrases("Depois, **confira** no *jogo*.")).toEqual(["confira no jogo"]);
    expect(doubtPhrases("Segundo as fontes, confira no jogo.")).toEqual(["confira no jogo", "segundo as fontes"]);
  });

  it("uma frase normal não é pega, nem uma palavra que só contém a frase", () => {
    expect(doubtPhrases("Desça para o riacho embaixo da ponte: a erva está na água, no canto oeste.")).toEqual([]);
    expect(doubtPhrases("Nenhuma fonte diz o contrário: são 3 ervas.")).toEqual([]);
    expect(doubtPhrases("Confira o mapa do sino Outpost antes de seguir.")).toEqual([]);
    expect(doubtPhrases("")).toEqual([]);
  });
});

describe("voz v2, revisão 2: o texto do guia nunca fala de fontes, sites consultados ou revisão", () => {
  it.each([
    ["Uma fonte cita o baú atrás da cabana.", ["fonte"]],
    ["Algumas fontes falam de 3 ervas.", ["fontes"]],
    ["O trecho foi revisado pelo editor.", ["revisado"]],
    ["Este ponto está em revisão.", ["em revisão"]],
    ["Revisaremos o mapa depois.", ["revisaremos"]],
    ["Verifique no jogo o total de sinos.", ["verifique no jogo"]],
    ["Confere no jogo se o baú abriu.", ["confere no jogo"]],
    ["Confirmem no jogo antes de seguir.", ["confirmem no jogo"]],
    ["Confira no jogo; uma fonte diz outra coisa.", ["confira no jogo", "uma fonte diz"]],
  ])("pega %j", (text, expected) => {
    expect(bannedExpressions(text)).toEqual(expected);
  });

  it.each([
    "Mergulhe na fonte termal atrás do templo.",
    "As fontes termais ficam no fim da trilha.",
    "Beba da fonte de água no pátio.",
    "A Fonte de Luz fica no altar.",
    "Ative a fonte de energia e a fonte de poder da torre.",
    "Na revisita à Crimson Forest, volte à ponte.",
    "Reviste o corpo do guarda.",
    "Confira o mapa do sino Outpost antes de seguir.",
  ])("o sentido de jogo não é pego: %j", (text) => {
    expect(bannedExpressions(text)).toEqual([]);
  });

  it("o nome de um site consultado é pego quando a execução o informa", () => {
    expect(bannedExpressions("Como mostra o PowerPyx, o baú fica à esquerda.", ["powerpyx"])).toEqual(["PowerPyx"]);
    expect(bannedExpressions("Como mostra o PowerPyx, o baú fica à esquerda.")).toEqual([]);
  });

  it("os sites vêm dos hosts dos links do dossiê (nunca o nome da fonte, nunca a Steam)", () => {
    const link = (name: string, url: string) => ({ name, url });
    const dossier = {
      chapters: [{ items: [{ sourceLinks: [link("PowerPyx", "https://www.powerpyx.com/pbz-walkthrough/")] }] }],
      achievements: [
        {
          sourceLinks: [
            link("Phantom Blade Zero 100% Guide", "https://steamcommunity.com/sharedfiles/filedetails/?id=1"),
            link("Fextralife", "https://phantombladezero.wiki.fextralife.com/Bells"),
            link("SteamGuide", "https://steamcommunity.com/sharedfiles/filedetails/?id=2"),
            // A one-word name that is a common word never becomes a banned site; a .com.br host gives its own label.
            link("Guia", "https://www.tecmundo.com.br/phantom-blade-zero"),
          ],
        },
      ],
    } as unknown as GuideDossier;
    expect(sourceSites(dossier)).toEqual(["powerpyx", "fextralife", "tecmundo"]);
  });
});

describe("revisão final: a lista de expressões proibidas nunca deixa uma parte sem conserto", () => {
  it("as palavras de um nome conhecido do dossiê não contam", () => {
    expect(bannedExpressions("Pegue a Fonte da Juventude no altar.")).toEqual(["fonte"]);
    expect(bannedExpressions("Pegue a Fonte da Juventude no altar.", [], { names: ["Fonte da Juventude"] })).toEqual([]);
    expect(bannedExpressions("Ganhe Em Revisão depois do chefe.", [], { names: ["Em Revisão"] })).toEqual([]);
    // Only the name's own words: the rest of the text is still read.
    expect(bannedExpressions("A Fonte da Juventude, segundo as fontes, fica ali.", [], { names: ["Fonte da Juventude"] })).toEqual(["segundo as fontes"]);
  });

  it("com o sentido de fonte d'água (o dossiê cita uma fonte), \"fonte\" e \"as fontes\" passam; as frases de dúvida não", () => {
    expect(bannedExpressions("Beba da fonte no pátio; as fontes do jardim também.", [], { fountain: true })).toEqual([]);
    expect(bannedExpressions("Beba da fonte no pátio; as fontes do jardim também.")).toEqual(["as fontes", "fonte"]);
    expect(bannedExpressions("Segundo as fontes, a fonte fica no pátio.", [], { fountain: true })).toEqual(["segundo as fontes"]);
  });

  it("os sites genéricos (plataformas, wikis, vídeo, palavras comuns) nunca viram nome banido; os distintos sim", () => {
    const link = (url: string) => ({ name: "x", url });
    const dossier = {
      chapters: [
        {
          items: [
            {
              sourceLinks: [
                "https://phantom-blade-zero.fandom.com/wiki/Bells",
                "https://www.youtube.com/watch?v=1",
                "https://www.playstation.com/pt-br/games/x/",
                "https://www.xbox.com/x",
                "https://www.reddit.com/r/x",
                "https://games.example.org/x",
                "https://www.guias.com.br/x",
                "https://allthings.how/x",
                "https://www.thegamer.com/x",
              ].map(link),
            },
          ],
        },
      ],
      achievements: [],
    } as unknown as GuideDossier;
    expect(sourceSites(dossier)).toEqual(["example", "allthings", "thegamer"]);
  });

  it("uma expressão proibida num texto do código vira erro interno, com o texto", () => {
    expect(bannedInCode(["**X** — Este guia mapeia 2 de 3 Fontes Antigas; o que falta ainda não tem local conhecido.", "Siga em frente."])).toEqual([
      'texto do código com expressão proibida "fontes": "**X** — Este guia mapeia 2 de 3 Fontes Antigas; o que falta ainda não tem local conhecido."',
    ]);
  });
});
