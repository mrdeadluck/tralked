import { describe, expect, it, vi } from "vitest";
import { fetchReleaseList, parseSearchResults } from "./releases";
import { fixtureReleaseList } from "./releases-fixture";

const CDN = "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps";

/** A row of the store search's `results_html`, as recorded in October 2026 (trimmed). */
function row(appIds: string, title: string, released: string, extra = "") {
  return `
    <a href="https://store.steampowered.com/app/${appIds}/x/?snr=1_7_7_popularnew_150_1"
       data-ds-appid="${appIds}" data-ds-itemkey="App_${appIds}" data-ds-tagids="[4231,6915]" ${extra}
       onmouseover="GameHover( this, event, 'global_hover', {&quot;type&quot;:&quot;app&quot;} );" class="search_result_row ds_collapse_flag ">
      <div class="search_capsule"><img src="${CDN}/${appIds}/abc/capsule_231x87.jpg?t=1793261976" ></div>
      <div class="responsive_search_name_combined">
        <div class="search_name ellipsis"><span class="title">${title}</span></div>
        <div class="search_platforms"><span class="platform_img win"></span></div>
        <div class="search_released responsive_secondrow">
                    ${released}                </div>
      </div>
    </a>`;
}

describe("parseSearchResults", () => {
  it("reads appid, name, day or text, capsule and position", () => {
    const html = [
      row("4115450", "Phantom Blade Zero", "28/out./2026"),
      row("5101960", "Dungeons &amp; Dynasties™", "3/nov./2026"),
      row("3517740", "Frostrail", "4º trimestre de 2026"),
      row("123,456", "Pacote", "1/nov./2026"),
      row("777", "Conteúdo adulto", "1/nov./2026", 'data-ds-descids="[1,3,5]"'),
      row("888", "Violento mas permitido", "2/nov./2026", 'data-ds-descids="[2,5]"'),
    ].join("\n");
    const items = parseSearchResults(html, 50);
    expect(items.map((i) => i.appId)).toEqual([4115450, 5101960, 3517740, 888]);
    expect(items[0]).toEqual({
      appId: 4115450,
      name: "Phantom Blade Zero",
      date: new Date(Date.UTC(2026, 9, 28)),
      imageUrl: `${CDN}/4115450/abc/capsule_231x87.jpg?t=1793261976`,
      position: 50,
    });
    expect(items[1].name).toBe("Dungeons & Dynasties");
    expect(items[2].date).toBeUndefined();
    expect(items[2].dateLabel).toBe("4º trimestre de 2026");
    // Positions follow the list (filtered rows keep their place).
    expect(items[3].position).toBe(55);
  });

  it("drops capsules outside Steam's CDN", () => {
    const html = row("1", "Jogo", "1/nov./2026").replace(CDN, "http://evil.example.com");
    expect(parseSearchResults(html)[0].imageUrl).toBeUndefined();
  });
});

describe("fetchReleaseList", () => {
  it("asks the store search for games of a list and parses results_html", async () => {
    const politeFetch = vi.fn(async (url: string) => {
      expect(url).toContain("/search/results/?");
      expect(url).toContain("filter=popularcomingsoon");
      expect(url).toContain("category1=998");
      expect(url).toContain("start=50");
      return new Response(JSON.stringify({ success: 1, results_html: row("10", "Jogo", "5/nov./2026"), total_count: 1 }));
    });
    const items = await fetchReleaseList(politeFetch, "popularcomingsoon", 50, 50);
    expect(items).toHaveLength(1);
    expect(items[0].position).toBe(50);
  });

  it("fails loudly on an error or an answer without results", async () => {
    await expect(fetchReleaseList(async () => new Response("", { status: 503 }), "popularnew")).rejects.toThrow(/HTTP 503/);
    await expect(fetchReleaseList(async () => new Response(JSON.stringify({ success: 2 })), "popularnew")).rejects.toThrow(/without results/);
  });
});

describe("fixtureReleaseList", () => {
  it("dates the recorded games around now", () => {
    const now = Date.UTC(2030, 0, 15, 12);
    const soon = fixtureReleaseList("popularcomingsoon", now);
    expect(soon[0].date?.toISOString()).toBe("2030-01-18T00:00:00.000Z");
    expect(soon.some((i) => !i.date && i.dateLabel)).toBe(true);
    expect(fixtureReleaseList("popularnew", now).every((i) => i.date!.getTime() <= now)).toBe(true);
  });
});
