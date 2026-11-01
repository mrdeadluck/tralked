import { beforeAll, describe, expect, it } from "vitest";
import { assemble } from "../src/assemble.js";
import type { Draft } from "../src/ai/writer.js";
import type { ContentBlock, Insights } from "../src/tralked.js";

/** The site's own payload schema, loaded through the vitest "@" alias (../app/src). */
type SafeParse = { safeParse(value: unknown): { success: boolean; error?: { issues: unknown[] } } };
let articlePayloadSchema: SafeParse;
beforeAll(async () => {
  // A variable specifier keeps tsc from resolving the site's files with the robot's tsconfig.
  const specifier = "@/lib/api/article-schema";
  ({ articlePayloadSchema } = (await import(/* @vite-ignore */ specifier)) as { articlePayloadSchema: SafeParse });
});

const insights: Insights = {
  game: {
    slug: "hollow-knight",
    name: "Hollow Knight",
    releaseDate: "2017-02-24",
    platforms: ["PC", "NINTENDO"],
    achievementCount: 63,
    timeToBeatCompleteMin: 3600,
  },
  tralked: { players: 120, avgPlaytimeMin: 2400 },
  rarest: [
    { platform: "steam", apiName: "PANTHEON_5", name: "Fim do Panteão", globalPct: 0.9 },
    { platform: "steam", apiName: "STEEL_SOUL", name: "Alma de Aço", globalPct: 1.2 },
    { platform: "steam", apiName: "SPEEDRUN_1", name: "Speedrun", globalPct: 2.1 },
    { platform: "steam", apiName: "GRIMM", name: "Ritual", globalPct: 4.5 },
  ],
};

function draft(over: Partial<Draft> = {}): Draft {
  return {
    title: "Hollow Knight ganha atualização com novo modo",
    subtitle: "A Team Cherry lançou a versão 1.6 com um modo de desafio.",
    excerpt: "Atualização 1.6 chega ao PC e ao Switch com um modo de desafio novo.",
    pontos: ["A versão 1.6 saiu hoje.", "Tem um modo de desafio.", "É grátis para quem tem o jogo."],
    corpo: [
      { p: "A Team Cherry lançou nesta sexta a versão 1.6 de Hollow Knight." },
      { h: "O que muda" },
      { lista: ["Modo de desafio", "Correções"] },
      { citacao: "Queríamos agradecer a comunidade", autor: "Team Cherry" },
      { tabela: { cabecalho: ["Plataforma", "Data"], linhas: [["PC", "31/10"], ["Switch", "31/10"]] } },
    ],
    noTralked: {
      casual: "Leva umas 30 horas para terminar a história.",
      cacador: "Nenhuma conquista nova; as mais raras continuam as mesmas.",
      conquistas: ["PANTHEON_5", "NAO_EXISTE", "STEEL_SOUL", "SPEEDRUN_1", "GRIMM"],
    },
    pergunta: "Vai voltar para Hallownest?",
    category: "GAMES",
    platforms: ["PC", "NINTENDO"],
    games: ["hollow-knight", "silksong-inventado"],
    imageLabel: "hollow knight 1.6",
    rumor: false,
    ...over,
  };
}

const story = {
  sources: [
    { name: "Team Cherry", url: "https://teamcherry.com.au/blog/1-6" },
    { name: "PC Gamer", url: "https://www.pcgamer.com/hk-16/" },
    { name: "PC Gamer (de novo)", url: "https://www.pcgamer.com/hk-16" },
    { name: "Inseguro", url: "http://example.com/hk" },
  ],
  candidates: [{ slug: "hollow-knight" }],
};

const opts = () => ({ insights: new Map([["hollow-knight", insights]]) });

/** One line per block, to compare the whole layout at a glance. */
function outline(blocks: ContentBlock[]): string[] {
  return blocks.map((b) => {
    switch (b.type) {
      case "heading":
        return `h${b.level}:${b.text}`;
      case "paragraph":
        return `p:${b.text}`;
      case "list":
        return `list:${b.items.join(" | ")}`;
      case "quote":
        return `quote:${b.text} — ${b.author ?? ""}`;
      case "callout":
        return `callout(${b.tone}):${b.text}`;
      case "table":
        return `table:${b.header.join(",")}/${b.rows.length}`;
      case "achievement":
        return `achievement:${b.apiName}`;
      default:
        return b.type;
    }
  });
}

describe("assemble", () => {
  it("lays the blocks out in the fixed order", () => {
    const payload = assemble(draft(), story, { ...opts(), updatedAt: new Date("2026-10-31T17:05:00Z") });
    expect(outline(payload.blocks)).toEqual([
      "p:*Atualizado às 14:05*",
      "h2:Em 3 pontos",
      "list:A versão 1.6 saiu hoje. | Tem um modo de desafio. | É grátis para quem tem o jogo.",
      "p:A Team Cherry lançou nesta sexta a versão 1.6 de Hollow Knight.",
      "h2:O que muda",
      "list:Modo de desafio | Correções",
      "quote:Queríamos agradecer a comunidade — Team Cherry",
      "table:Plataforma,Data/2",
      "h2:No Tralked",
      "callout(info):**Pra quem joga de boa:** Leva umas 30 horas para terminar a história.",
      "callout(info):**Pra quem caça 100%:** Nenhuma conquista nova; as mais raras continuam as mesmas.",
      "achievement:PANTHEON_5",
      "achievement:STEEL_SOUL",
      "achievement:SPEEDRUN_1",
      "p:*Vai voltar para Hallownest?*",
      "h2:Fontes",
      "list:[Team Cherry](https://teamcherry.com.au/blog/1-6) | [PC Gamer](https://www.pcgamer.com/hk-16/)",
    ]);
    expect(payload.status).toBe("published");
    expect(payload.category).toBe("GAMES");
    expect(payload.games).toEqual([{ slug: "hollow-knight" }]);
  });

  it("has no update note without updatedAt", () => {
    const payload = assemble(draft(), story, opts());
    expect(outline(payload.blocks)[0]).toBe("h2:Em 3 pontos");
  });

  it("writes the update note in São Paulo time", () => {
    const payload = assemble(draft(), story, { ...opts(), updatedAt: new Date("2026-10-31T17:05:00Z") });
    expect(payload.blocks[0]).toEqual({ type: "paragraph", text: "*Atualizado às 14:05*" });
  });

  it("links a follow-up's earlier article right after Em 3 pontos", () => {
    const parent = { title: "Hollow Knight [1.5] **sai** hoje", url: "https://tralked.com/noticias/hollow-knight-1-5" };
    const payload = assemble(draft(), story, { ...opts(), parent });
    expect(outline(payload.blocks)[0]).toBe("h2:Em 3 pontos");
    expect(payload.blocks[1]?.type).toBe("list");
    expect(payload.blocks[2]).toEqual({
      type: "paragraph",
      text: "Entenda o caso: [Hollow Knight 1.5 sai hoje](https://tralked.com/noticias/hollow-knight-1-5)",
    });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("leaves the follow-up link out when the URL is not https", () => {
    const payload = assemble(draft(), story, { ...opts(), parent: { title: "Antes", url: "http://localhost:3000/noticias/x" } });
    expect(JSON.stringify(payload.blocks)).not.toContain("Entenda o caso");
  });

  it("leaves out the No Tralked section when noTralked is null", () => {
    const payload = assemble(draft({ noTralked: null }), story, opts());
    const lines = outline(payload.blocks);
    expect(lines).not.toContain("h2:No Tralked");
    expect(lines.some((l) => l.startsWith("callout") || l.startsWith("achievement"))).toBe(false);
  });

  it("keeps only one audience callout when the other is null", () => {
    const payload = assemble(
      draft({ noTralked: { casual: null, cacador: "Platina ficou mais fácil.", conquistas: [] } }),
      story,
      opts(),
    );
    const lines = outline(payload.blocks);
    expect(lines.filter((l) => l.startsWith("callout"))).toEqual(["callout(info):**Pra quem caça 100%:** Platina ficou mais fácil."]);
  });

  it("drops achievements that are not among the rarest in the insights", () => {
    const payload = assemble(
      draft({ noTralked: { casual: null, cacador: null, conquistas: ["NAO_EXISTE", "GRIMM"] } }),
      story,
      opts(),
    );
    const achievements = payload.blocks.filter((b) => b.type === "achievement");
    expect(achievements).toEqual([{ type: "achievement", apiName: "GRIMM", platform: "steam" }]);
  });

  it("drops the No Tralked heading when nothing in it survives", () => {
    const payload = assemble(
      draft({ noTralked: { casual: null, cacador: "  ", conquistas: ["NAO_EXISTE"] } }),
      story,
      { insights: new Map() },
    );
    expect(outline(payload.blocks)).not.toContain("h2:No Tralked");
  });

  it("strips HTML and links that are not https", () => {
    const payload = assemble(
      draft({
        title: "Título <b>com</b> tag",
        corpo: [
          { p: "Antes <script>alert(1)</script> depois, veja [x](http://a) e [site](https://ok.com)." },
          { lista: ["item <img src=x onerror=alert(1)> limpo", "[link](javascript:alert(1))"] },
        ],
      }),
      story,
      opts(),
    );
    const json = JSON.stringify(payload);
    expect(json).not.toMatch(/<[a-zA-Z!/?]/);
    expect(json).not.toContain("http://a");
    expect(json).not.toMatch(/javascript\s*:/i);
    expect(payload.title).toBe("Título com tag");
    const paragraph = payload.blocks.find((b) => b.type === "paragraph" && b.text.startsWith("Antes"));
    expect(paragraph).toEqual({ type: "paragraph", text: "Antes alert(1) depois, veja x e [site](https://ok.com)." });
  });

  it("lists sources once per URL, https only", () => {
    const payload = assemble(draft(), story, opts());
    const fontes = payload.blocks.at(-1);
    expect(fontes).toEqual({
      type: "list",
      ordered: false,
      items: ["[Team Cherry](https://teamcherry.com.au/blog/1-6)", "[PC Gamer](https://www.pcgamer.com/hk-16/)"],
    });
  });

  it("leaves out a source whose link would not fit in a list item", () => {
    const longUrl = `https://example.com/${"a".repeat(1000)}`;
    const payload = assemble(draft(), { ...story, sources: [{ name: "Longa", url: longUrl }, ...story.sources] }, opts());
    const fontes = payload.blocks.at(-1);
    expect(fontes).toEqual({
      type: "list",
      ordered: false,
      items: ["[Team Cherry](https://teamcherry.com.au/blog/1-6)", "[PC Gamer](https://www.pcgamer.com/hk-16/)"],
    });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("drops games that are not candidates", () => {
    const payload = assemble(draft({ games: ["inventado", "hollow-knight", "hollow-knight"] }), story, opts());
    expect(payload.games).toEqual([{ slug: "hollow-knight" }]);
  });

  it("truncates text to the API limits", () => {
    const long = (n: number) => "palavra ".repeat(n).trim();
    const payload = assemble(
      draft({
        title: long(60),
        subtitle: long(80),
        excerpt: long(80),
        corpo: [{ p: long(1000) }, { lista: [long(200)] }, { tabela: { cabecalho: ["A"], linhas: [[long(100)]] } }],
        noTralked: { casual: long(400), cacador: null, conquistas: [] },
        imageLabel: long(20),
      }),
      story,
      opts(),
    );
    expect(payload.title.length).toBeLessThanOrEqual(200);
    expect(payload.subtitle!.length).toBeLessThanOrEqual(300);
    expect(payload.excerpt!.length).toBeLessThanOrEqual(300);
    expect(payload.imageLabel!.length).toBeLessThanOrEqual(60);
    for (const block of payload.blocks) {
      if (block.type === "paragraph") expect(block.text.length).toBeLessThanOrEqual(5000);
      if (block.type === "list") for (const item of block.items) expect(item.length).toBeLessThanOrEqual(1000);
      if (block.type === "callout") expect(block.text.length).toBeLessThanOrEqual(2000);
      if (block.type === "table") for (const row of block.rows) for (const c of row) expect(c.length).toBeLessThanOrEqual(500);
    }
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("evens out table rows to the header width", () => {
    const payload = assemble(
      draft({ corpo: [{ tabela: { cabecalho: ["A", "B"], linhas: [["1"], ["1", "2", "3"], ["", "x"]] } }] }),
      story,
      opts(),
    );
    const table = payload.blocks.find((b) => b.type === "table");
    expect(table).toEqual({ type: "table", header: ["A", "B"], rows: [["1", "—"], ["1", "2"], ["—", "x"]] });
  });

  it("produces a payload the site's article schema accepts", () => {
    const payloads = [
      assemble(draft(), story, { ...opts(), updatedAt: new Date("2026-10-31T17:05:00Z") }),
      assemble(draft({ noTralked: null, subtitle: "", excerpt: "  ", imageLabel: "" }), story, opts()),
      assemble(
        draft({ corpo: [{ p: "<script>x</script>" }, { p: "ok <i>itálico</i>" }, { lista: ["", "<br>"] }, { h: "" }] }),
        story,
        opts(),
      ),
    ];
    for (const payload of payloads) {
      const result = articlePayloadSchema.safeParse(payload);
      expect(result.error?.issues ?? []).toEqual([]);
      expect(result.success).toBe(true);
    }
  });
});
