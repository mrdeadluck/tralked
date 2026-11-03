import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractText } from "../../src/collect/index.js";
import { PAGE_TEXT_MAX, pageText } from "../../src/guias/page-text.js";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("pageText (texto de página de guia)", () => {
  it("allthings.how: a tabela das 66 conquistas sai inteira, uma linha por fileira, cabeçalho incluído", () => {
    const { text, truncated } = pageText(fx("allthings-pbz-achievements.html"));
    expect(truncated).toBe(false);
    expect(text).toContain("Achievement | Grade | Unlock condition | Steam %");
    expect(text).toContain("The Heart’s Journey | Bronze | Escape the Pursuers on the Main Road | 100%");
    for (const name of ["Blotting Out the Sky", "Who Can Judge?", "Collector’s Notes", "Listen to Every Flower", "Baishan Tempest", "Lightning Fast"]) {
      expect(text).toContain(name);
    }
    // How-to and location columns.
    expect(text).toContain("Collector’s Notes | Silver | Collect 30 Accessories | 37.5%");
    expect(text).toContain("The Rusted Blade (Bronze) | Inflict Blood Loss with Jagged Steel | Weeping Creek Valley (Rustblade Pavilion) | 100%");
    // The old extractor lost every one of these rows.
    expect(extractText(fx("allthings-pbz-achievements.html"), "https://allthings.how/x/")?.text).not.toContain("Rustblade Pavilion");
  });

  it("Fextralife: a coluna de como destravar fica", () => {
    const { text } = pageText(fx("fextralife-pbz-trophy-guide.html"));
    expect(text).toContain("Trophy/Achievement | How to Unlock | Rarity");
    expect(text).toContain("The Heart's Journey | Complete the Prologue | Bronze");
    expect(text).toContain("Listen to Every Flower | Collect 10 Memory Flowers | Bronze");
    expect(text).toContain("Baishan Tempest | Use Baishan Stormsword to unleash [Lightning Storm] | Bronze");
  });

  it("PowerPyx roadmap: a tabela traz os 36 troféus da PSN com nome, descrição e grau (a lista PSN do cruzamento)", () => {
    const { text } = pageText(fx("powerpyx-pbz-roadmap.html"));
    const trophies = text.split("\n").filter((l) => / \| (Platinum|Gold|Silver|Bronze)$/.test(l));
    expect(trophies).toHaveLength(36);
    expect(trophies).toContain(" | With Heart and Blood / All Comes to Light | Gold");
    expect(extractText(fx("powerpyx-pbz-roadmap.html"), "https://www.powerpyx.com/x/")?.text).not.toContain("All Comes to Light");
  });

  it("PowerPyx Pangzhen e o guia Steam 3829266508 não são cortados em 20.000 caracteres", () => {
    const pangzhen = pageText(fx("powerpyx-pbz-pangzhen.html")).text;
    expect(pangzhen.length).toBeGreaterThan(20_000);
    expect(pangzhen).toContain("#106 –");
    expect(pangzhen).toContain("This is covered in a separate page as the 8th Region: Mirage Estate.");

    const steam = pageText(fx("steam-guide-3829266508.html")).text;
    expect(steam.length).toBeGreaterThan(20_000);
    expect(steam).toContain("工作日晚上才能接着动工");
  });

  it("guia Steam: título, descrição do autor e tabelas [table] de divs em linhas", () => {
    const { text } = pageText(fx("steam-guide-3829258710.html"));
    expect(text).toContain("影之刃零全成就指南");
    expect(text).toContain("《影之刃零》66项成就指南");
    expect(text).toContain("### 禁法湖底沉");
    expect(text).toContain("区域 | 龙柱位置");
    expect(text).toContain("悲泣溪谷 | 溪谷深处");
    // Comments under the guide are not part of it.
    expect(text).not.toContain("一周目救死扶伤任务千万记得做完再进下个地区");
  });

  it("ordem do documento, texto de div sem duplicar o aninhado, chrome fora", () => {
    const html = `<html><head><title>Guia X</title><style>.a{}</style></head><body>
      <header><nav><a href="/">Home</a> <a href="/g">Guides</a></nav></header>
      <div id="cookie-banner">We use cookies</div>
      <main>
        <h2>Region 1</h2>
        <div class="entry">Intro text <span>inline <b>bold</b></span>
          <div>Nested block</div>
          tail text
        </div>
        <ul><li><p>Item in a paragraph</p></li><li>Second item</li></ul>
        <table><thead><tr><th>Name</th><th>How</th></tr></thead>
          <tbody><tr><td>Sword</td><td><p>Open the chest</p><p>near the tree</p></td></tr>
          <tr><td><img title="Gold" src="g.png"></td><td>Beat the boss</td></tr></tbody></table>
        <aside>Related posts</aside>
        <div class="entry-comments"><p>Great guide!</p></div>
        <script>var x = "do not read";</script>
      </main>
      <footer>Copyright</footer>
    </body></html>`;
    expect(pageText(html).text).toBe(
      [
        "# Guia X",
        "## Region 1",
        "Intro text inline bold",
        "Nested block",
        "tail text",
        "- Item in a paragraph",
        "- Second item",
        "Name | How",
        "Sword | Open the chest / near the tree",
        "Gold | Beat the boss",
      ].join("\n"),
    );
  });

  it("corta só acima do teto e avisa que cortou", () => {
    // Distinct lines of 99 chars (+ the line break): repeated identical lines are collapsed into one.
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `<p>${String(i).padStart(6, "0")}${"x".repeat(93)}</p>`).join("");
    const big = pageText(`<body>${lines(Math.ceil(PAGE_TEXT_MAX / 100) + 50)}</body>`);
    expect(big.truncated).toBe(true);
    expect(big.text.length).toBeLessThanOrEqual(PAGE_TEXT_MAX);
    const small = pageText(`<body>${lines(300)}</body>`);
    expect(small.truncated).toBe(false);
    expect(small.text.length).toBe(300 * 100 - 1);
  });
});
