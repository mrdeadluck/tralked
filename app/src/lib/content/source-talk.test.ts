import { describe, expect, it } from "vitest";
import { quietSources, quietSourcesText } from "./source-talk";

describe("quietSources: o texto antigo do robô não fala de fontes ao leitor", () => {
  it("tira a frase de dúvida e reescreve a que traz um fato", () => {
    expect(
      quietSourcesText(
        "Essa erva conta para a conquista The Healer’s Legacy. Só uma fonte cita este ponto; confira no jogo.",
      ),
    ).toBe("Essa erva conta para a conquista The Healer’s Legacy.");
    expect(quietSourcesText("Segundo a fonte, entregar o pente ao Old Man Gen destrava Together Till the End.")).toBe(
      "Entregar o pente ao Old Man Gen destrava Together Till the End.",
    );
  });

  it("mantém os spans de spoiler no lugar", () => {
    const text =
      "Perdível: as fontes ligam a conquista oculta ||The White Shadow|| a este capítulo; fique atento a partir daqui.";
    const out = quietSourcesText(text);
    expect(out).toBe("Perdível neste capítulo: a conquista oculta ||The White Shadow||. Fique atento a partir daqui.");
    expect(out.match(/\|\|/g)).toHaveLength(2);
  });

  it("um texto da voz nova passa intacto, e a troca alcança todo texto do guia", () => {
    const fresh = "Pegue a Congealeaf antes de vencer o chefe: depois a porta fecha.";
    expect(quietSourcesText(fresh)).toBe(fresh);
    const guide = {
      readFirst: [{ title: "A", text: "Evite “Believe”. Algumas fontes não veem perda; faça mesmo assim.", spoiler: false }],
      chapters: [{ steps: [{ items: [{ location: "No baú. A fonte marca o item como bugado.", review: true }] }] }],
      n: 3,
    };
    expect(quietSources(guide)).toEqual({
      readFirst: [{ title: "A", text: "Evite “Believe”.", spoiler: false }],
      chapters: [{ steps: [{ items: [{ location: "No baú. O item pode bugar.", review: true }] }] }],
      n: 3,
    });
  });
});
