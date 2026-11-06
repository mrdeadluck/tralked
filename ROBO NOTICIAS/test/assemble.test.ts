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
      case "post":
        return "post";
      case "gallery":
        return "gallery";
      default:
        return b.type;
    }
  });
}

describe("assemble: media", () => {
  const cover = { url: "https://blob.test/cover.webp", alt: "Logotipo de Hollow Knight", credit: "Divulgação/Team Cherry" };
  const bodyImage = { url: "https://blob.test/scene.webp", alt: "Cena de Hollow Knight", credit: "Divulgação/Team Cherry" };
  const trailer = { youtubeId: "TTTTTTTTTTT", title: "Vídeo de Hollow Knight" };
  const video = { youtubeId: "AAAAAAAAAAA", title: "Hollow Knight 1.6 - Official Trailer" };

  it("lede, cover, the story's video, the body with the body image after its 3rd block, then the trailer", () => {
    const payload = assemble(draft(), story, { ...opts(), media: { cover, video, bodyImage } });
    expect(outline(payload.blocks).slice(0, 7)).toEqual([
      "p:A Team Cherry lançou nesta sexta a versão 1.6 de Hollow Knight.",
      "image",
      "video",
      "h2:O que muda",
      "list:Modo de desafio | Correções",
      "image",
      "quote:Queríamos agradecer a comunidade — Team Cherry",
    ]);
    expect(payload.blocks[1]).toEqual({ type: "image", ...cover });
    expect(payload.blocks[5]).toEqual({ type: "image", ...bodyImage });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("the cover is the first image block, and the trailer closes the body when there is no video", () => {
    const payload = assemble(draft(), story, { ...opts(), media: { cover, bodyImage, trailer } });
    expect(payload.blocks.find((b) => b.type === "image")).toEqual({ type: "image", ...cover });
    const trailerAt = payload.blocks.findIndex((b) => b.type === "video");
    expect(payload.blocks[trailerAt - 1]!.type).toBe("table");
    expect(payload.blocks[trailerAt + 1]).toEqual({ type: "heading", level: 2, text: "No Tralked" });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("the story's own video replaces the catalog trailer", () => {
    const payload = assemble(draft(), story, { ...opts(), media: { video, trailer } });
    expect(payload.blocks[1]).toEqual({ type: "video", ...video });
    expect(payload.blocks.filter((b) => b.type === "video")).toHaveLength(1);
  });

  it("a body image equal to the cover is not repeated", () => {
    const payload = assemble(draft(), story, { ...opts(), media: { cover, bodyImage: { ...cover } } });
    expect(payload.blocks.filter((b) => b.type === "image")).toHaveLength(1);
  });

  it("keeps an https creditUrl and drops any other", () => {
    const linked = assemble(draft(), story, { ...opts(), media: { cover: { ...cover, creditUrl: "https://news.xbox.com/a" } } });
    expect(linked.blocks[1]).toEqual({ type: "image", ...cover, creditUrl: "https://news.xbox.com/a" });
    expect(articlePayloadSchema.safeParse(linked).success).toBe(true);
    const insecure = assemble(draft(), story, { ...opts(), media: { cover: { ...cover, creditUrl: "http://news.xbox.com/a" } } });
    expect(insecure.blocks[1]).toEqual({ type: "image", ...cover });
    const script = assemble(draft(), story, { ...opts(), media: { cover: { ...cover, creditUrl: "javascript:alert(1)" } } });
    expect(script.blocks[1]).toEqual({ type: "image", ...cover });
  });

  const post = {
    url: "https://x.com/ToddHoward/status/1850000000000000002",
    authorName: "Todd Howard",
    authorHandle: "ToddHoward",
    text: "Sentinel is the next chapter.",
    postedAt: "2026-11-03T12:00:00.000Z",
  };
  const quoting = (over: Partial<Draft> = {}) =>
    draft({
      corpo: [
        { p: "A Bethesda revelou o nome." },
        { p: "Detalhes do anúncio." },
        { p: "Todd Howard comentou o nome no X." },
        { p: "Mais contexto." },
      ],
      ...over,
    });

  it("a post goes after the first body paragraph that quotes its author, and the site accepts it", () => {
    const payload = assemble(quoting(), story, { ...opts(), media: { cover, video, posts: [post] } });
    expect(outline(payload.blocks).slice(0, 7)).toEqual([
      "p:A Bethesda revelou o nome.",
      "image",
      "video",
      "p:Detalhes do anúncio.",
      "p:Todd Howard comentou o nome no X.",
      "post",
      "p:Mais contexto.",
    ]);
    expect(payload.blocks[5]).toEqual({ type: "post", network: "x", ...post });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("a post nobody quotes goes after the video (or the cover, or the lede)", () => {
    const anon = { ...post, authorName: "Bethesda", authorHandle: "bethesda", url: "https://x.com/bethesda/status/1" };
    expect(outline(assemble(quoting(), story, { ...opts(), media: { cover, video, posts: [anon] } }).blocks).slice(0, 4)).toEqual([
      "p:A Bethesda revelou o nome.",
      "image",
      "video",
      "post",
    ]);
    expect(outline(assemble(quoting(), story, { ...opts(), media: { posts: [anon] } }).blocks).slice(0, 2)).toEqual([
      "p:A Bethesda revelou o nome.",
      "post",
    ]);
  });

  it("drops a post with an unsafe url or handle, and cleans its text for the site", () => {
    const bad = assemble(quoting(), story, { ...opts(), media: { posts: [{ ...post, url: "https://evil.com/x/status/1" }] } });
    expect(bad.blocks.some((b) => b.type === "post")).toBe(false);
    const html = assemble(quoting(), story, { ...opts(), media: { posts: [{ ...post, text: "<b>Sentinel</b> chega" }] } });
    expect(html.blocks.find((b) => b.type === "post")).toMatchObject({ text: "Sentinel chega" });
    expect(articlePayloadSchema.safeParse(html).success).toBe(true);
  });

  it("the model's text never links to X: the post is embedded instead", () => {
    const payload = assemble(
      quoting({ corpo: [{ p: "Veja [o post](https://x.com/bethesda/status/1) e https://twitter.com/bethesda/status/2 também." }] }),
      story,
      opts(),
    );
    expect(JSON.stringify(payload.blocks)).not.toMatch(/x\.com\/|twitter\.com\//);
    expect(payload.blocks[0]).toEqual({ type: "paragraph", text: "Veja o post e também." });
  });

  const shots = [1, 2, 3, 4].map((n) => ({ url: `https://blob.test/s${n}.webp`, alt: `Captura ${n}`, credit: "Divulgação/Team Cherry", creditUrl: "https://teamcherry.com.au/a" }));

  it("a gallery goes after the lede and the cover, before the video, and replaces the body image", () => {
    const payload = assemble(draft(), story, { ...opts(), media: { cover, video, bodyImage, gallery: shots } });
    expect(outline(payload.blocks).slice(0, 4)).toEqual(["p:A Team Cherry lançou nesta sexta a versão 1.6 de Hollow Knight.", "image", "gallery", "video"]);
    expect(payload.blocks.filter((b) => b.type === "image")).toHaveLength(1);
    expect(payload.blocks[2]).toEqual({ type: "gallery", images: shots });
    expect(articlePayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("a gallery with fewer than 3 safe images is dropped, and the body image comes back", () => {
    const unsafe = [shots[0]!, shots[1]!, { ...shots[2]!, url: "http://x.test/a.jpg" }];
    const payload = assemble(draft(), story, { ...opts(), media: { cover, bodyImage, gallery: unsafe } });
    expect(payload.blocks.some((b) => b.type === "gallery")).toBe(false);
    expect(payload.blocks.filter((b) => b.type === "image")).toHaveLength(2);
  });

  it("drops unsafe media: bad video ids, non-https images, HTML in titles", () => {
    const payload = assemble(draft(), story, {
      ...opts(),
      media: { cover: { ...cover, url: "http://x.test/a.jpg" }, trailer: { youtubeId: "short", title: "x" } },
    });
    expect(payload.blocks.some((b) => b.type === "image" || b.type === "video")).toBe(false);
    const titled = assemble(draft(), story, { ...opts(), media: { video: { ...video, title: "<b>Trailer</b>" } } });
    expect(titled.blocks[1]).toEqual({ type: "video", youtubeId: "AAAAAAAAAAA", title: "Trailer" });
  });
});

describe("assemble: sources", () => {
  it("cites each outlet once, with the link of its best-ranked item", () => {
    const sources = [
      ...Array.from({ length: 7 }, (_, i) => ({ name: "Steam News", url: `https://store.steampowered.com/news/app/1/view/${i}` })),
      { name: "Xbox Wire", url: "https://news.xbox.com/en-us/tes-vi" },
      { name: "steam  news", url: "https://store.steampowered.com/news/app/1/view/99" },
    ];
    const payload = assemble(draft(), { sources, candidates: story.candidates }, opts());
    const fontes = payload.blocks.at(-1)!;
    expect(fontes).toEqual({
      type: "list",
      ordered: false,
      items: ["[Steam News](https://store.steampowered.com/news/app/1/view/0)", "[Xbox Wire](https://news.xbox.com/en-us/tes-vi)"],
    });
  });
});

describe("assemble", () => {
  it("lays the blocks out in the fixed order", () => {
    const payload = assemble(draft(), story, { ...opts(), updatedAt: new Date("2026-10-31T17:05:00Z") });
    expect(outline(payload.blocks)).toEqual([
      "p:*Atualizado às 14:05*",
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
    expect(outline(payload.blocks)[0]).toBe("p:A Team Cherry lançou nesta sexta a versão 1.6 de Hollow Knight.");
  });

  it("writes the update note in São Paulo time", () => {
    const payload = assemble(draft(), story, { ...opts(), updatedAt: new Date("2026-10-31T17:05:00Z") });
    expect(payload.blocks[0]).toEqual({ type: "paragraph", text: "*Atualizado às 14:05*" });
  });

  it("links a follow-up's earlier article before the body", () => {
    const parent = { title: "Hollow Knight [1.5] **sai** hoje", url: "https://tralked.com/noticias/hollow-knight-1-5" };
    const payload = assemble(draft(), story, { ...opts(), parent });
    expect(payload.blocks[0]).toEqual({
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
