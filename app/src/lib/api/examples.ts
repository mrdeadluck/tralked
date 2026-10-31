import type { GuidePayloadInput } from "@/lib/content/guide-schema";
import type { ArticlePayloadInput } from "./article-schema";

/**
 * Complete example payloads shown on /desenvolvedores and in docs/robos.md. Tests check that both
 * validate and that the Markdown copy matches these objects, so the docs cannot drift.
 */

export const EXAMPLE_ARTICLE = {
  title: "Hades recebe atualização com novo modo de desafio",
  subtitle: "O pacote traz um modo de provações semanais e ajustes de equilíbrio em três armas.",
  excerpt: "Novo modo de provações semanais chega com recompensas exclusivas e mudanças no Escudo do Caos.",
  category: "GAMES",
  platforms: ["PC", "PLAYSTATION", "XBOX", "NINTENDO"],
  games: [{ slug: "hades" }],
  imageLabel: "hades",
  blocks: [
    {
      type: "paragraph",
      text: "A Supergiant liberou nesta terça a atualização **1.4** de Hades. O destaque é um modo de *provações semanais*, com regras novas a cada segunda-feira. As notas completas estão no [site oficial](https://www.supergiantgames.com/).",
    },
    { type: "heading", level: 2, text: "O que muda" },
    {
      type: "list",
      ordered: false,
      items: [
        "Provações semanais com placar entre amigos",
        "Escudo do Caos: o golpe carregado ficou **15% mais rápido**",
        "Correções de desempenho no Switch",
      ],
    },
    { type: "heading", level: 3, text: "Como liberar o modo" },
    {
      type: "list",
      ordered: true,
      items: ["Termine uma fuga do Tártaro", "Fale com Hipnos no saguão", "Escolha a provação da semana"],
    },
    {
      type: "quote",
      text: "Queríamos um motivo para voltar ao Submundo toda semana.",
      author: "Equipe da Supergiant",
    },
    {
      type: "image",
      url: "https://cdn.exemplo.com.br/hades/provacoes.jpg",
      alt: "Zagreus diante do quadro de provações no saguão da Casa de Hades",
      credit: "Divulgação/Supergiant Games",
    },
    { type: "video", youtubeId: "ID_DO_VIDEO" },
    {
      type: "callout",
      tone: "info",
      text: "A atualização é gratuita e chega a todas as plataformas no mesmo dia.",
    },
    {
      type: "callout",
      tone: "aviso",
      text: "Saves do modo de provações não contam para as conquistas da campanha.",
    },
    {
      type: "callout",
      tone: "spoiler",
      text: "A provação final libera uma conversa inédita com Perséfone.",
    },
    {
      type: "table",
      header: ["Arma", "Antes", "Depois"],
      rows: [
        ["Escudo do Caos", "1,2 s", "1,0 s"],
        ["Lança Eterna", "0,8 s", "0,8 s"],
        ["Arco Coronacht", "1,5 s", "1,4 s"],
      ],
    },
    { type: "achievement", apiName: "HELLBENT", platform: "steam" },
    { type: "divider" },
    { type: "paragraph", text: "*Texto gerado por robô a partir das notas oficiais da atualização.*" },
  ],
} satisfies ArticlePayloadInput;

export const EXAMPLE_GUIDE = {
  game: { steamAppId: 1145360 },
  version: "v1.0",
  facts: {
    difficulty: 6,
    hoursMin: 40,
    hoursMax: 60,
    playthroughs: "1 (várias fugas)",
    missables: 0,
    online: 0,
  },
  overview: [
    "Hades é um roguelike de ação: cada fuga do Submundo leva de 30 a 50 minutos, e o progresso permanente vem dos espelhos, das armas e das relações com os deuses.",
    "Nenhuma conquista é perdível. A mais demorada pede 10 fugas completas, e a mais difícil exige Calor 32 no Pacto da Punição.",
  ],
  warnings: [
    "Não gaste Diamantes na decoração antes de liberar as melhorias do Contrato da Casa que dão Recursos.",
  ],
  body: [
    {
      type: "paragraph",
      text: "Este guia segue a ordem mais rápida para o 100%: história primeiro, depois relações e por fim o Calor alto.",
    },
  ],
  steps: [
    {
      title: "Primeira fuga e história principal",
      hours: "15 a 25 h",
      body: [
        {
          type: "paragraph",
          text: "Jogue no ritmo normal até completar a **primeira fuga**. Invista no Espelho da Noite: *Persistência da Morte* e *Defesa Sombria* primeiro.",
        },
        {
          type: "list",
          ordered: true,
          items: ["Libere as seis armas", "Complete 10 fugas para ver o epílogo"],
        },
      ],
      achievements: [],
    },
    {
      title: "Calor alto",
      hours: "10 a 20 h",
      body: [
        {
          type: "paragraph",
          text: "Com as armas melhoradas, suba o Pacto da Punição aos poucos. O Escudo do Caos com o aspecto de Beowulf é a escolha mais segura.",
        },
        { type: "callout", tone: "aviso", text: "Calor acima de 20 deixa os chefes com fases extras." },
      ],
      achievements: ["HELLBENT"],
    },
  ],
  achievementNotes: [
    {
      apiName: "HELLBENT",
      platform: "steam",
      category: "desafio",
      spoiler: false,
      tip: [
        {
          type: "paragraph",
          text: "Ative condições até somar **Calor 32** e vença uma fuga. Prefira Tempo Limitado e Sem Recompensas a aumentar o dano dos inimigos.",
        },
      ],
      steps: ["Melhore o Espelho da Noite por completo", "Use o Escudo do Caos (aspecto de Beowulf)"],
    },
  ],
  collectibles: [
    { name: "Armas infernais", total: 6, description: "Cada uma com quatro aspectos." },
    { name: "Lembranças", total: 25, description: "Presentes dados pelos personagens em troca de néctar." },
  ],
  sources: [{ title: "Hades, página oficial", url: "https://www.supergiantgames.com/games/hades/" }],
} satisfies GuidePayloadInput;
