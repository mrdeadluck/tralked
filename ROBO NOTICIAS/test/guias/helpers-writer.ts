import { vi } from "vitest";
import type { Ai, StructuredOpts } from "../../src/ai/client.js";

/** A fake guide writer and checker (no model): the frame and chapter answers echo the ready-made keys of the prompt. */

export const keysIn = (prompt: string, tag: string) => [...prompt.matchAll(new RegExp(`<${tag} key="([^"]+)"`, "g"))].map((m) => m[1]!);

/** A writer that answers in the shape asked for, echoing the ready-made keys of the prompt (and inventing one). */
export function goodFrame(prompt: string, variant = 0) {
  return {
    capa: {
      chamadas: [
        { valor: "1", rotulo: "Perdível" },
        { valor: "0", rotulo: "Online" },
        { valor: "3", rotulo: "Capítulos" },
      ],
      manchete: `O caminho até o Tralked ${variant}`,
      linhaFina: "Todos os sinos e as 4 conquistas, na ordem do jogo.",
    },
    ficha: {
      dificuldade: 4,
      justificativaDificuldade: "Nenhuma conquista pede dificuldade alta.",
      notaZeradas: "Uma zerada basta.",
      maisDificil: "ACH_SECRET",
    },
    visaoGeral: ["Um jogo de ação curto.", "O Tralked sai numa zerada."],
    leiaAntes: [{ titulo: "Lanterna", texto: "Pegue a lanterna antes da floresta.", tom: "aviso" as const, spoiler: false }],
    etapas: keysIn(prompt, "etapa").map((key) => ({ key, titulo: `Etapa ${key}`, blocos: [{ tipo: "paragrafo" as const, texto: "Siga a história." }] })),
    capitulos: [
      ...keysIn(prompt, "capitulo").map((key) => ({ key, fase: "inventada", titulo: `Capítulo ${key}`, prazo: "Antes da floresta" as string | null })),
      { key: "capitulo-inventado", fase: "x", titulo: "Inventado", prazo: null },
    ],
  };
}

export function goodChapter(prompt: string, variant = 0) {
  return {
    passos: [
      ...keysIn(prompt, "passo").map((key) => ({
        key,
        blocos: [{ tipo: "paragrafo" as const, texto: `Texto próprio do passo ${variant}.` }],
        conquistas: [] as string[],
      })),
      { key: "passo-inventado", blocos: [{ tipo: "paragrafo" as const, texto: "x" }], conquistas: [] as string[] },
    ],
    itens: [
      ...keysIn(prompt, "item").map((key) => ({ key, nome: `Nome ${key}`, local: "Perto da entrada.", spoiler: false })),
      { key: "item-inventado", nome: "Inventado", local: "Lugar", spoiler: false },
    ],
    depois: "Dá para voltar depois e pegar o que faltou." as string | null,
  };
}

export type Verdict = { ok: boolean; problems: string[] };
export const OK: Verdict = { ok: true, problems: [] };

export type Fake = {
  /** The checker's answer to each call (the check prompt and the call's number). */
  verdict?: (user: string, n: number) => Verdict;
  variant?: number;
  frame?: (out: ReturnType<typeof goodFrame>) => void;
  chapter?: (out: ReturnType<typeof goodChapter>, prompt: string, n: number) => void | Promise<void>;
};

export function fakeAi(fake: Fake = {}) {
  const calls: StructuredOpts<unknown>[] = [];
  let checks = 0;
  let chapters = 0;
  const structured = vi.fn(async (opts: StructuredOpts<unknown>) => {
    calls.push(opts);
    if (opts.purpose.startsWith("guide-write-frame")) {
      const out = goodFrame(opts.user, fake.variant);
      fake.frame?.(out);
      return out;
    }
    if (opts.purpose.startsWith("guide-write-chapter")) {
      const out = goodChapter(opts.user, fake.variant);
      await fake.chapter?.(out, opts.user, chapters++);
      return out;
    }
    return (fake.verdict ?? (() => OK))(opts.user, checks++);
  });
  const ai = { structured, batchRequest: vi.fn(), recordBatchUsage: vi.fn(), assertBudget: vi.fn() } as unknown as Ai;
  const of = (prefix: string) => calls.filter((o) => o.purpose.startsWith(prefix));
  return { ai, calls, of };
}

