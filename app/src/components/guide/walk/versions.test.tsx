import "../../../../vitest.db-guard";
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gatedRef } from "@/lib/content/walk-refs";
import { walkthroughSchema, type WalkItem, type Walkthrough } from "@/lib/content/walkthrough-schema";
import type { GuideDetail } from "@/lib/queries/games";
import { WalkUserAnon, WalkUserSeed } from "./progress";
import { chosenVersion, hasVersions } from "./versions";
import { VERSION_KEY } from "./version-state";
import { ach, pbzGuide, shipped, walkthrough } from "./walk.test-util";
import { WalkthroughPage } from "./WalkthroughPage";

vi.mock("@/app/jogos/[slug]/guia/actions", () => ({ toggleItem: vi.fn(), checkGameAchievements: vi.fn() }));
vi.mock("@/components/fx/reward-bus", () => ({ announceReward: vi.fn(), announceToast: vi.fn() }));
vi.mock("@/components/guide/reveal-achievement", () => ({ revealAchievement: vi.fn(async () => null) }));
vi.mock("./reveal-spoilers", () => ({ revealWalkSpoilers: vi.fn(async () => null) }));
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn(async () => null) }));

/*
 * PBZ with both lists: Legado da Curandeira is on the PSN list; the boss (a hidden Steam achievement),
 * "Domínio Total" and the arena are Steam only. Three chapters:
 * 1. Weeping Creek Valley, the example's 9 steps plus 1.10, a step with nothing but the Steam-only
 *    missable "Domínio Total" and a warning (no story of its own). The amber fragment (1.6) only
 *    counts toward Domínio Total; Battle Wraps (1.5) counts toward it and toward Legado.
 * 2. Arena: one step with the Steam-only arena achievement and no text.
 * 3. Limpeza: a bell.
 * Steam: 11 + 1 + 1 = 13 items, 3 missables. PlayStation: 8 + 0 + 1 = 9 items, 2 missables.
 */

const SOURCES = [{ name: "PowerPyx", url: "https://www.powerpyx.com/" }];

function item(key: string, over: Partial<WalkItem>): WalkItem {
  return {
    key,
    kind: "achievement",
    name: key,
    missable: false,
    returnLater: false,
    spoiler: false,
    countsFor: [],
    alsoOn: [],
    sources: SOURCES,
    review: false,
    ...over,
  };
}

function psWalkthrough(): Walkthrough {
  const first = structuredClone(walkthrough.chapters[0]);
  for (const step of first.steps)
    for (const it of step.items) {
      if (it.achievement === "ACH_HEALER_LEGACY") it.alsoOn = ["psn"];
      if (it.key === "acessorio-battle-wraps") it.countsFor = ["ACH_TOTAL_DOMINION", "ACH_HEALER_LEGACY"];
    }
  first.key = "cap-1";
  first.steps.push({
    key: "r1-10",
    body: [{ type: "callout", tone: "aviso", text: "Salve antes de seguir." }],
    items: [item("conquista-dominio", { name: "Domínio Total", achievement: "ACH_TOTAL_DOMINION", missable: true })],
  });
  return walkthroughSchema.parse({
    ...walkthrough,
    chapters: [
      first,
      {
        ...first,
        key: "arena",
        title: "Arena",
        deadline: undefined,
        steps: [
          {
            key: "arena-1",
            body: [{ type: "achievement", apiName: "ACH_ARENA", platform: "steam" }],
            items: [item("conquista-arena", { name: "Mestre da Arena", achievement: "ACH_ARENA" })],
          },
        ],
      },
      {
        ...first,
        key: "limpeza",
        title: "Limpeza",
        deadline: undefined,
        steps: [
          {
            key: "limpeza-1",
            body: [{ type: "paragraph", text: "Volte pelo mapa e pegue o que faltou." }],
            items: [item("sino-final", { kind: "collectible", name: "Sino final" })],
          },
        ],
      },
    ],
  });
}

/** The guide written from the PSN list instead (scope psn). */
function scopePsn(guide: GuideDetail, total: number): GuideDetail {
  const names = Array.from({ length: total }, (_, i) => `Trophy ${i + 1}`);
  return { ...guide, walkthrough: { ...guide.walkthrough!, scope: "psn", psnList: { total, names }, steamOnly: [] } };
}

function psGuide(over: Partial<GuideDetail> = {}): GuideDetail {
  const base = pbzGuide();
  return pbzGuide({
    walkthrough: psWalkthrough(),
    walk: {
      ...base.walk!,
      achievements: {
        ...base.walk!.achievements,
        // Database ids never spell the apiName.
        ACH_SCARLET_SPECTRAL_BLADE: { ...base.walk!.achievements.ACH_SCARLET_SPECTRAL_BLADE, id: "cm-boss" },
        ACH_TOTAL_DOMINION: { ...ach("ACH_TOTAL_DOMINION", "Domínio Total", 9.1), id: "cm-dominio" },
        ACH_ARENA: { ...ach("ACH_ARENA", "Mestre da Arena", 2.3), id: "cm-arena" },
      },
    },
    facts: { ...base.facts, missables: 2 },
    ...over,
  });
}

const BOSS = gatedRef("boss-hua-noiva-mortal");
const root = () => document.querySelector<HTMLElement>(".wk")!;
const switchGroup = () => screen.queryByRole("group", { name: "Qual versão você joga?" });
const choose = (name: "Steam" | "PlayStation") => fireEvent.click(within(switchGroup()!).getByRole("button", { name }));
/** The value the chosen version shows of a number both versions count (the other one is hidden by CSS). */
const shown = (el: Element, version: "steam" | "playstation") => {
  const other = el.querySelector(version === "steam" ? ".wk-ps-only" : ".wk-steam-only");
  const own = el.querySelector(version === "steam" ? ".wk-steam-only" : ".wk-ps-only");
  return (own ?? (other ? null : el))?.textContent ?? null;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("quando o guia tem a troca Steam / PlayStation", () => {
  it("só num guia steam_only com o tamanho da lista da PSN", () => {
    expect(hasVersions(psGuide())).toBe(true);
    const base = psGuide();
    expect(hasVersions({ ...base, walk: { ...base.walk!, compatCounts: null } })).toBe(false);
    expect(hasVersions({ ...base, compat: "psn_xbox" })).toBe(false);
    expect(hasVersions(scopePsn(base, 36))).toBe(false);
  });

  it("guia com as duas listas: a troca fica no topo, ao lado do selo", () => {
    render(<WalkthroughPage guide={psGuide()} />);
    const group = switchGroup()!;
    expect(group.closest(".wk-hero")).not.toBeNull();
    expect(within(group).getByRole("button", { name: "Steam" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "PlayStation" })).toHaveAttribute("aria-pressed", "false");
    expect(root()).toHaveAttribute("data-versao", "steam");
  });

  it("sem a lista da PSN: nada de troca, e o selo segue APENAS STEAM", () => {
    const base = psGuide();
    render(<WalkthroughPage guide={{ ...base, walk: { ...base.walk!, compatCounts: null } }} />);
    expect(switchGroup()).toBeNull();
    expect(screen.getByText("APENAS STEAM")).toBeInTheDocument();
    expect(root()).not.toHaveAttribute("data-versao");
    expect(document.querySelector(".wk-steam-only, .wk-ps-only")).toBeNull();
  });

  it("guia escrito pela lista da PSN (scope psn): nada de troca", () => {
    render(<WalkthroughPage guide={scopePsn(psGuide(), 36)} />);
    expect(screen.getByText("GUIA PELA LISTA DA PSN (36 troféus)")).toBeInTheDocument();
    expect(switchGroup()).toBeNull();
    expect(document.querySelector(".wk-steam-only")).toBeNull();
  });
});

describe("selo", () => {
  it("STEAM E PLAYSTATION com as duas contagens no lugar de APENAS STEAM", () => {
    render(<WalkthroughPage guide={psGuide()} />);
    const seal = screen.getByText("STEAM E PLAYSTATION").closest(".wk-compat")!;
    expect(seal).toHaveTextContent("66 conquistas na Steam · 36 troféus no PlayStation");
    expect(seal).toHaveTextContent("Os passos marcam quais valem nas duas");
    expect(screen.queryByText("APENAS STEAM")).toBeNull();
  });
});

describe("versão PlayStation", () => {
  it("marca na hora de desenhar o que só existe na Steam: itens, passo sem história e capítulo vazio", () => {
    render(<WalkthroughPage guide={psGuide()} />);
    const row = (ref: string) => document.getElementById(`item-${ref}`)!;
    // Steam-only achievements (the hidden boss too) and what only counts toward one.
    for (const ref of [BOSS, "conquista-dominio", "fragmento-ambar-1", "conquista-arena"]) {
      expect(row(ref)).toHaveClass("wk-steam-only");
    }
    // On the PSN list, counting toward one on it, or toward nothing Steam-only.
    for (const ref of ["conquista-legado-curandeira", "acessorio-battle-wraps", "fragmento-pedra-negra-1", "sino-lady-rift", "sino-final"]) {
      expect(row(ref)).not.toHaveClass("wk-steam-only");
    }
    const step = (n: string) => screen.getByRole("article", { name: `Passo ${n}` });
    expect(step("1.10")).toHaveClass("wk-steam-only");
    // Its warning goes with it.
    expect(step("1.10").previousElementSibling).toHaveClass("wk-steam-only");
    // A story step keeps its text even when its only item goes.
    expect(step("1.6")).not.toHaveClass("wk-steam-only");
    expect(step("1.9")).not.toHaveClass("wk-steam-only");
    expect(document.getElementById("cap-arena")).toHaveClass("wk-steam-only");
    expect(document.getElementById("cap-cap-1")).not.toHaveClass("wk-steam-only");
    expect(document.getElementById("cap-limpeza")).not.toHaveClass("wk-steam-only");
  });

  it("escolher PlayStation esconde pela raiz e troca as contagens", async () => {
    render(<WalkthroughPage guide={psGuide()} user={<WalkUserAnon />} />);
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    const [one, arena, limpeza] = journey.querySelectorAll("li");
    expect(one).toHaveTextContent("11 itens · 3 ⚠");
    expect(arena).toBeVisible();
    expect(document.querySelector(".wk-pct")).toHaveTextContent("0 / 13");
    const box = screen.getByRole("complementary", { name: "Resumo de Weeping Creek Valley" });
    expect(within(box).getByText("0 / 11")).toBeInTheDocument();

    choose("PlayStation");
    expect(root()).toHaveAttribute("data-versao", "playstation");
    expect(within(switchGroup()!).getByRole("button", { name: "PlayStation" })).toHaveAttribute("aria-pressed", "true");
    // Journey, slim bar and the chapter box follow the version.
    expect(one).toHaveTextContent("8 itens · 2 ⚠");
    expect(journey.querySelectorAll("li")[1]).not.toBeVisible();
    expect(limpeza).toBeVisible();
    expect(document.querySelector(".wk-pct")).toHaveTextContent("0 / 9");
    expect(within(box).getByText("0 / 8")).toBeInTheDocument();

    // Numbers drawn on the server carry both values; the root's attribute picks one.
    const ficha = screen.getByRole("region", { name: "Ficha do guia" });
    const field = (label: string) => within(ficha).getByText(label).closest("div")!.querySelector(".v")!;
    expect(shown(field("Conquistas"), "steam")).toBe("66");
    expect(shown(field("Conquistas"), "playstation")).toBe("36");
    expect(shown(field("Perdíveis"), "steam")).toBe("2");
    expect(shown(field("Perdíveis"), "playstation")).toBe("1");
    const read = screen.getByRole("region", { name: "Leia isto para não perder nada" });
    expect(read).toHaveTextContent("Os 3 perdíveis");
    expect(read.querySelector(".wk-ps-only")).toHaveTextContent("Os 2 perdíveis");
    const scene = document.querySelector("#cap-cap-1 .wk-scene .meta")!;
    expect(shown(scene.querySelector("li")!, "steam")).toBe("11 itens");
    expect(shown(scene.querySelector("li")!, "playstation")).toBe("8 itens");

    choose("Steam");
    expect(root()).toHaveAttribute("data-versao", "steam");
    expect(one).toHaveTextContent("11 itens · 3 ⚠");
  });

  it("o ponto de retorno segue a versão escolhida", async () => {
    // Chapter 1 ticked up to 1.8, except the amber fragment (Steam only).
    const ch1 = [
      "sino-lady-rift",
      "missao-triple-threat",
      "acessorio-hunters-insight",
      "conquista-legado-curandeira",
      "arma-sanguine-twin",
      "acessorio-battle-wraps",
      "acessorio-boulderguard",
      "fragmento-pedra-negra-1",
    ];
    const seed = <WalkUserSeed doneRefs={ch1} unlockedIds={[]} unlockedCount={0} pendingXp={0} />;
    render(<WalkthroughPage guide={psGuide()} user={seed} />);
    const cover = screen.getByRole("region", { name: /Guia Tralked de/ });
    await within(cover).findByRole("button", { name: "Continuar de onde parou" });
    // Steam: the boss is next (1.9).
    expect(cover).toHaveTextContent("Weeping Creek Valley · passo 1.9");
    choose("PlayStation");
    // PlayStation: chapter 1 is done (the boss, the amber fragment and Domínio Total are not there) and
    // the arena is left out: next is the cleanup.
    await waitFor(() => expect(cover).toHaveTextContent("Limpeza · passo 3.1"));
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    expect(journey.querySelectorAll("li")[0]).toHaveClass("lit");
    expect(journey.querySelectorAll("li")[2]).toHaveClass("here");
    const here = screen.getByRole("complementary", { name: "Você está aqui" });
    expect(here.closest("article")).toHaveAttribute("aria-label", "Passo 3.1");
  });

  it("nenhum apiName nem nome escondido chega ao navegador", () => {
    const out = shipped(<WalkthroughPage guide={psGuide()} />).join(" ");
    expect(out).not.toContain("ACH_TOTAL_DOMINION");
    expect(out).not.toContain("ACH_ARENA");
    expect(out).not.toContain("ACH_SCARLET_SPECTRAL_BLADE");
    expect(out).not.toContain("boss-hua-noiva-mortal");
  });
});

describe("a escolha fica lembrada", () => {
  it("URL vence o armazenamento; sem nenhum, Steam", () => {
    expect(chosenVersion("", null)).toBe("steam");
    expect(chosenVersion("", "playstation")).toBe("playstation");
    expect(chosenVersion("?versao=playstation", "steam")).toBe("playstation");
    expect(chosenVersion("?versao=steam", "playstation")).toBe("steam");
    expect(chosenVersion("?versao=xbox", "playstation")).toBe("playstation");
    expect(chosenVersion("?a=1", "lixo")).toBe("steam");
  });

  it("escolher grava no navegador e na URL, sem navegar", () => {
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia?x=1");
    const replace = vi.spyOn(window.history, "replaceState");
    render(<WalkthroughPage guide={psGuide()} />);
    choose("PlayStation");
    expect(localStorage.getItem(VERSION_KEY)).toBe("playstation");
    expect(window.location.search).toBe("?x=1&versao=playstation");
    expect(replace).toHaveBeenCalled();
    choose("Steam");
    expect(localStorage.getItem(VERSION_KEY)).toBe("steam");
    expect(window.location.search).toBe("?x=1");
  });

  it("abre na versão da URL mesmo com outra guardada", () => {
    localStorage.setItem(VERSION_KEY, "steam");
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia?versao=playstation");
    render(<WalkthroughPage guide={psGuide()} />);
    expect(root()).toHaveAttribute("data-versao", "playstation");
    cleanup();
    localStorage.setItem(VERSION_KEY, "playstation");
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia?versao=steam");
    render(<WalkthroughPage guide={psGuide()} />);
    expect(root()).toHaveAttribute("data-versao", "steam");
  });

  it("abre na versão guardada e a põe na URL", async () => {
    localStorage.setItem(VERSION_KEY, "playstation");
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia");
    render(<WalkthroughPage guide={psGuide()} />);
    expect(root()).toHaveAttribute("data-versao", "playstation");
    await act(async () => {});
    expect(window.location.search).toBe("?versao=playstation");
  });

  it("sem acesso ao armazenamento: Steam, e escolher ainda funciona", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<WalkthroughPage guide={psGuide()} />);
    expect(root()).toHaveAttribute("data-versao", "steam");
    choose("PlayStation");
    expect(root()).toHaveAttribute("data-versao", "playstation");
  });

  it("o HTML do servidor vem em Steam e um script aplica a escolha antes da primeira pintura", () => {
    const html = renderToString(<WalkthroughPage guide={psGuide()} />);
    expect(html).toMatch(/<div[^>]*class="wk"[^>]*data-versao="steam"/);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Steam</);
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

    document.body.innerHTML = html;
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia?versao=playstation");
    new Function(script)();
    expect(root()).toHaveAttribute("data-versao", "playstation");

    document.body.innerHTML = html;
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia");
    localStorage.setItem(VERSION_KEY, "playstation");
    new Function(script)();
    expect(root()).toHaveAttribute("data-versao", "playstation");

    document.body.innerHTML = html;
    window.history.replaceState(null, "", "/jogos/phantom-blade-zero/guia?versao=steam");
    new Function(script)();
    expect(root()).toHaveAttribute("data-versao", "steam");
    document.body.innerHTML = "";
  });

  it("a hidratação mantém a escolha do script e as contagens seguem", async () => {
    const page = <WalkthroughPage guide={psGuide()} user={<WalkUserAnon />} />;
    const html = renderToString(page);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.appendChild(container);
    localStorage.setItem(VERSION_KEY, "playstation");
    new Function(/<script>([\s\S]*?)<\/script>/.exec(html)![1])();
    expect(root()).toHaveAttribute("data-versao", "playstation");

    const errors = vi.spyOn(console, "error");
    let app: Root | undefined;
    await act(async () => {
      app = hydrateRoot(container, page, { onRecoverableError: (e) => console.error(e) });
    });
    expect(errors).not.toHaveBeenCalled();
    expect(root()).toHaveAttribute("data-versao", "playstation");
    // The inline script is only in the server HTML.
    expect(container.querySelector("script")).toBeNull();
    const journey = within(container).getByRole("navigation", { name: "Capítulos do detonado" });
    expect(journey.querySelectorAll("li")[0]).toHaveTextContent("8 itens · 2 ⚠");
    act(() => app!.unmount());
    container.remove();
  });
});

describe("rodada 1 da revisão", () => {
  /** psGuide with its walkthrough edited. */
  function variant(edit: (w: Walkthrough) => void): GuideDetail {
    const w = structuredClone(psWalkthrough());
    edit(w);
    return psGuide({ walkthrough: walkthroughSchema.parse(w) });
  }
  const itemOf = (w: Walkthrough, key: string) => w.chapters.flatMap((c) => c.steps.flatMap((s) => s.items)).find((i) => i.key === key)!;

  it("um passo com só um item da Steam e uma dica (callout info) fica: a dica é texto dele", () => {
    const guide = variant((w) => {
      w.chapters[0].steps[9].body = [{ type: "callout", tone: "info", text: "Dica: vale a pena." }];
    });
    render(<WalkthroughPage guide={guide} />);
    expect(screen.getByRole("article", { name: "Passo 1.10" })).not.toHaveClass("wk-steam-only");
    expect(document.getElementById("item-conquista-dominio")).toHaveClass("wk-steam-only");
  });

  it("um título e um spoiler também são texto do passo; só o aviso, não", () => {
    const heading = variant((w) => {
      w.chapters[0].steps[9].body = [{ type: "heading", level: 3, text: "O baú" }];
    });
    render(<WalkthroughPage guide={heading} />);
    expect(screen.getByRole("article", { name: "Passo 1.10" })).not.toHaveClass("wk-steam-only");
    cleanup();
    const spoiler = variant((w) => {
      w.chapters[0].steps[9].body = [{ type: "callout", tone: "spoiler", text: "O chefe volta." }];
    });
    render(<WalkthroughPage guide={spoiler} />);
    expect(screen.getByRole("article", { name: "Passo 1.10" })).not.toHaveClass("wk-steam-only");
  });

  it("o capítulo fora da versão PlayStation já vem marcado na jornada e na barra fina", () => {
    render(<WalkthroughPage guide={psGuide()} />);
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    expect(journey.querySelectorAll("li")[1]).toHaveClass("wk-steam-only");
    expect(journey.querySelectorAll("li")[0]).not.toHaveClass("wk-steam-only");
    const segs = document.querySelectorAll(".wk-segs i");
    expect(segs[1]).toHaveClass("wk-steam-only");
    expect(segs[2]).not.toHaveClass("wk-steam-only");
  });

  it("caixa do capítulo: o nome do tipo segue a contagem da versão", () => {
    const guide = variant((w) => {
      itemOf(w, "acessorio-battle-wraps").countsFor = ["ACH_TOTAL_DOMINION"];
      itemOf(w, "acessorio-hunters-insight").countsFor = ["ACH_TOTAL_DOMINION"];
    });
    render(<WalkthroughPage guide={guide} />);
    const box = screen.getByRole("complementary", { name: "Resumo de Weeping Creek Valley" });
    const row = within(box).getByText((_, el) => el?.tagName === "P" && /^Acessór/.test(el.textContent ?? ""));
    const label = row.querySelector(":scope > span")!;
    expect(shown(label, "steam")).toBe("Acessórios");
    expect(shown(label, "playstation")).toBe("Acessório");
    expect(shown(row.querySelector("b")!, "steam")).toBe("3");
    expect(shown(row.querySelector("b")!, "playstation")).toBe("1");
  });

  it("a mesma conquista: se um item dela está na lista da PSN, nenhum item dela some", () => {
    const guide = variant((w) => {
      w.chapters[2].steps[0].items.push(item("legado-de-novo", { name: "Legado de novo", achievement: "ACH_HEALER_LEGACY" }));
    });
    render(<WalkthroughPage guide={guide} />);
    expect(document.getElementById("item-legado-de-novo")).not.toHaveClass("wk-steam-only");
  });

  it("Mais difícil na versão PlayStation: a mais rara das que existem nas duas listas", () => {
    render(<WalkthroughPage guide={psGuide()} />);
    const field = screen.getByText("Mais difícil").closest("div")!;
    expect(field).not.toHaveClass("wk-steam-only");
    // Steam: the robot's pick (only on Steam); PlayStation: the rarest one shared with PSN.
    const ps = field.querySelector(".v .wk-ps-only")!;
    expect(ps.querySelector('[data-spoiler="hidden"]')).not.toBeNull();
    expect(shown(field.querySelector(".d")!, "steam")).toBe("4,7% dos jogadores na Steam");
    expect(shown(field.querySelector(".d")!, "playstation")).toBe("13,9% dos jogadores na Steam");
    fireEvent.click(within(ps as HTMLElement).getByRole("button", { name: /mostrar/i }));
    expect(within(ps as HTMLElement).getByText("Legado da Curandeira")).toBeInTheDocument();
  });

  it("Mais difícil: a mesma nas duas quando ela está na PSN; some quando nenhuma conquista é das duas", () => {
    const base = psGuide();
    const legado = base.walk!.achievements.ACH_HEALER_LEGACY;
    render(<WalkthroughPage guide={{ ...base, walk: { ...base.walk!, hardest: legado } }} />);
    const field = screen.getByText("Mais difícil").closest("div")!;
    expect(field.querySelector(".wk-ps-only")).toBeNull();
    cleanup();
    const none = variant((w) => {
      itemOf(w, "conquista-legado-curandeira").alsoOn = [];
    });
    render(<WalkthroughPage guide={none} />);
    expect(screen.getByText("Mais difícil").closest("div")).toHaveClass("wk-steam-only");
  });

  it("jornada: sem capítulo na linha de leitura, o atual é o primeiro que a versão mostra", () => {
    const guide = variant((w) => {
      w.chapters = [w.chapters[1], w.chapters[0], w.chapters[2]];
    });
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5000 } as DOMRect);
    render(<WalkthroughPage guide={guide} />);
    choose("PlayStation");
    const journey = screen.getByRole("navigation", { name: "Capítulos do detonado" });
    expect(journey.querySelectorAll("li")[1]).toHaveClass("c");
    expect(journey.querySelectorAll("li")[0]).not.toHaveClass("c");
  });

  it("índice e Capítulo X de N contam os capítulos que a versão mostra", () => {
    const guide = variant((w) => {
      for (const c of w.chapters) delete c.region;
    });
    render(<WalkthroughPage guide={guide} />);
    const toc = screen.getByRole("button", { name: /Detonado/ });
    expect(shown(toc.querySelector("small")!, "steam")).toBe("3 cap.");
    expect(shown(toc.querySelector("small")!, "playstation")).toBe("2 cap.");
    const where = document.querySelector("#cap-limpeza .wk-scene .wk-lbl")!;
    expect(shown(where, "steam")).toBe("Etapa 1 · Capítulo 3 de 3");
    expect(shown(where, "playstation")).toBe("Etapa 1 · Capítulo 2 de 2");
  });
});
