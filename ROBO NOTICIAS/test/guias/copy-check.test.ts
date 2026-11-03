import { describe, expect, it } from "vitest";
import { DOUBT_PHRASES, doubtPhrases } from "../../src/guias/copy-check.js";

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
  ])("pega \"%s\"", (phrase, text) => {
    expect(doubtPhrases(text)).toEqual([phrase]);
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
