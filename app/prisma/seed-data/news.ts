import type { GAME_SLUG_BY_PREVIEW_ID } from "./games";

type PreviewGameId = keyof typeof GAME_SLUG_BY_PREVIEW_ID;

export type SeedArticle = {
  slug: string;
  title: string;
  subtitle: string | null;
  body: string;
  category: "GAMES" | "GUIAS" | "COMUNIDADE";
  platforms: ("PC" | "PLAYSTATION" | "XBOX" | "NINTENDO")[];
  imageLabel: string;
  authorHandle: string;
  previewGameId?: PreviewGameId;
  /** 0 = list, 1 = side highlight, 2 = main highlight. */
  featured: 0 | 1 | 2;
  likes: number;
  comments: number;
  /** Hours before the seed run (preview "há 2 horas", "ontem"...). */
  agoHours: number;
};

const FOOTER =
  "*Texto de exemplo para o ambiente de desenvolvimento do GAMELOG. O conteúdo editorial real substitui este corpo.*";

/** Authors of the preview's news (`AUTHORS`). Only some of them are also players. */
export const AUTHOR_HANDLES = ["Fuyushiro", "Rivia", "Al1enado", "NascimentoRE", "Nyx_Vortex"] as const;

export const ARTICLES: SeedArticle[] = [
  // Main highlight (preview HERO)
  {
    slug: "25-conquistas-mais-raras-da-steam-em-2026",
    title: "As 25 conquistas mais raras da Steam em 2026, e o que é preciso para fazer cada uma",
    subtitle:
      "Levantamento da redação cruzou raridade global e tempo médio de conclusão. Três delas têm menos de 0,1% de desbloqueio.",
    body: [
      "Toda lista de conquistas raras começa com uma pergunta simples: o que torna uma conquista difícil de verdade? Neste levantamento, a redação separou dois critérios, a porcentagem global de desbloqueio e o tempo que um jogador dedicado costuma levar para chegar lá.",
      "## Como a lista foi montada\n\nCada item foi classificado pela raridade e, em caso de empate, pelo tempo estimado de conclusão. Conquistas ligadas a eventos já encerrados ficaram de fora, para que a lista sirva a quem começa a jogar hoje.",
      "## O que as mais raras têm em comum\n\nA maioria exige repetição disciplinada: partidas longas sem erro, sequências de chefes ou execução precisa de rotas. Poucas dependem de sorte, e quase todas ficam mais acessíveis com um bom guia e um save dedicado.",
      "No GAMELOG, as conquistas lendárias, com 3% ou menos de desbloqueio global, rendem o maior XP e são o caminho mais curto para subir de nível. Acompanhe a lista completa e marque as que você já tem no seu perfil.",
      FOOTER,
    ].join("\n\n"),
    category: "GUIAS",
    platforms: ["PC"],
    imageLabel: "imagem: conquistas raras",
    authorHandle: "Fuyushiro",
    featured: 2,
    likes: 356,
    comments: 120,
    agoHours: 2,
  },
  // Side highlights (preview SIDE)
  {
    slug: "hollow-knight-guia-100-por-cento-em-7-etapas",
    title: "Hollow Knight: guia de 100% ganha rota em 7 etapas",
    subtitle: null,
    body: [
      "O guia de 100% de Hollow Knight foi reorganizado em sete etapas, da jornada principal até o modo Alma de Aço. A ideia é que cada etapa feche um conjunto coerente de conquistas, sem obrigar ninguém a voltar para áreas já limpas.",
      "## O que mudou na rota\n\nA limpeza de coletáveis agora vem logo depois do final padrão, e os finais alternativos ficam antes dos panteões. Assim, o save principal fica pronto antes de você encarar os desafios mais longos.",
      "## Atenção a Ritual e Banishment\n\nAs duas conquistas da Trupe Grimm são excludentes no mesmo save. O guia indica qual fazer na jornada principal e qual deixar para o save de speedrun.",
      "Abra o guia completo para ver as dicas por conquista, as estimativas de tempo de cada etapa e marcar o seu progresso.",
      FOOTER,
    ].join("\n\n"),
    category: "GUIAS",
    platforms: ["PC"],
    imageLabel: "hollow knight",
    authorHandle: "Nyx_Vortex",
    previewGameId: "hollow-knight",
    featured: 1,
    likes: 129,
    comments: 41,
    agoHours: 26,
  },
  {
    slug: "semana-do-terror-conquistas-de-survival-horror-xp-em-dobro",
    title: "Semana do terror: conquistas de Survival Horror valem XP em dobro",
    subtitle: null,
    body: [
      "Durante a semana do terror, as conquistas de jogos com a skill Survival Horror rendem o dobro de XP. O bônus vale para qualquer jogo da sua biblioteca que conte para essa skill.",
      "## Como aproveitar\n\nComece pelos jogos em que você já está perto de uma conquista rara. A missão semanal de terror também entra na promoção, então vale encaixar as duas no mesmo fim de semana.",
      "## Para quem joga em grupo\n\nJogos cooperativos de caça a fantasmas e de sobrevivência contam para as duas skills envolvidas. Combine com a sua Família GAMELOG e divida as conquistas que exigem mais de uma pessoa.",
      FOOTER,
    ].join("\n\n"),
    category: "COMUNIDADE",
    platforms: [],
    imageLabel: "evento halloween",
    authorHandle: "Rivia",
    featured: 1,
    likes: 87,
    comments: 52,
    agoHours: 28,
  },
  {
    slug: "hades-os-3-desafios-que-mais-travam-o-100-por-cento",
    title: "Hades: os 3 desafios que mais travam o 100% da comunidade",
    subtitle: null,
    body: [
      "Entre as conquistas de Hades, três costumam concentrar as reclamações de quem tenta fechar o 100%. O que elas têm em comum é a exigência de consistência: não basta uma boa partida, é preciso repetir o resultado.",
      "## Por que travam\n\nAs conquistas pedem combinações específicas de bênçãos e armas, e a variação de cada fuga ajuda e atrapalha ao mesmo tempo. Anotar o que funcionou em cada tentativa economiza muitas horas.",
      "## O que fazer\n\nEscolha uma arma e domine seus aspectos antes de buscar o desafio mais difícil. A comunidade também recomenda treinar os chefes finais em sequência, em vez de recomeçar a cada fuga.",
      FOOTER,
    ].join("\n\n"),
    category: "GAMES",
    platforms: ["PLAYSTATION", "XBOX", "PC"],
    imageLabel: "hades",
    authorHandle: "Al1enado",
    previewGameId: "hades",
    featured: 1,
    likes: 64,
    comments: 27,
    agoHours: 48,
  },
  {
    slug: "civilization-vi-e-suas-320-conquistas-vale-a-pena-comecar-agora",
    title: "Civilization VI e suas 320 conquistas: vale a pena começar agora?",
    subtitle: null,
    body: [
      "Com 320 conquistas, Civilization VI é um dos jogos com a maior lista da biblioteca. A pergunta de quem chega agora é se vale o investimento de tempo, e a resposta depende do que você espera do jogo.",
      "## Uma maratona em fatias\n\nA lista é longa porque cobre vitórias, civilizações, cenários e conteúdos adicionais. Como cada partida é demorada, o ideal é escolher um conjunto de conquistas por partida e aceitar que o 100% é uma meta de longo prazo.",
      "## No GAMELOG\n\nO jogo conta para a skill Estratégia. Mesmo sem chegar ao 100%, cada conquista renderá XP, e as mais raras são boas candidatas para as missões semanais.",
      FOOTER,
    ].join("\n\n"),
    category: "GAMES",
    platforms: ["PC"],
    imageLabel: "civilization vi",
    authorHandle: "NascimentoRE",
    previewGameId: "civ6",
    featured: 1,
    likes: 53,
    comments: 31,
    agoHours: 50,
  },
  // List (preview NEWS)
  {
    slug: "baldurs-gate-3-10-conquistas-perdiveis",
    title: "Baldur's Gate 3: 10 conquistas perdíveis para conhecer antes de começar",
    subtitle:
      "Algumas escolhas do primeiro ato fecham conquistas para o resto da campanha. Veja o que evitar e quando salvar.",
    body: [
      "Em um RPG com tantas ramificações, algumas decisões fecham portas. Esta lista reúne dez conquistas que dependem de escolhas feitas cedo na campanha, para você planejar o save antes de se comprometer.",
      "## Por que salvar em slots separados\n\nManter um save antes de cada grande decisão permite voltar sem refazer horas de jogo. É a forma mais simples de não perder nenhuma conquista da lista.",
      "## As escolhas que mais pesam\n\nA maior parte dos casos envolve aliados, conflitos entre facções e a forma de resolver encontros do primeiro ato. Cada item da lista indica a decisão e o momento aproximado em que ela acontece.",
      "Se você já passou do primeiro ato, não desanime: várias das conquistas listadas podem ser recuperadas em uma nova jogada focada.",
      FOOTER,
    ].join("\n\n"),
    category: "GUIAS",
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    imageLabel: "baldurs gate 3",
    authorHandle: "Rivia",
    previewGameId: "bg3",
    featured: 0,
    likes: 48,
    comments: 66,
    agoHours: 1,
  },
  {
    slug: "importe-conquistas-de-playstation-e-xbox-em-breve",
    title: "Em breve: importe conquistas de PlayStation e Xbox para o seu personagem",
    subtitle:
      "A redação explica como vai funcionar a importação e por que as skills por gênero vão somar tudo num só perfil.",
    body: [
      "Hoje o GAMELOG importa conquistas da Steam. O próximo passo é aceitar também as de PlayStation e Xbox, para que o seu personagem reflita tudo o que você já jogou em qualquer plataforma.",
      "## Um perfil só\n\nAs skills por gênero somam as conquistas de todas as origens. Um soulslike jogado no console conta para a mesma skill de um jogado no PC, e o nível geral acompanha.",
      "## O que ainda está em aberto\n\nOs detalhes de cada plataforma, como privacidade e frequência de sincronização, ainda estão em definição. Assine a newsletter para acompanhar as novidades quando a importação sair.",
      FOOTER,
    ].join("\n\n"),
    category: "COMUNIDADE",
    platforms: ["PLAYSTATION", "XBOX"],
    imageLabel: "perfil multiplataforma",
    authorHandle: "Fuyushiro",
    featured: 0,
    likes: 212,
    comments: 94,
    agoHours: 3,
  },
  {
    slug: "celeste-capitulo-9-desafio-mais-dificil-do-ano",
    title: "Celeste: a comunidade elegeu o Capítulo 9 como o desafio mais difícil do ano",
    subtitle:
      "Votação com mais de 8 mil jogadores coloca o Farewell no topo. Veja as dicas mais votadas para atravessar.",
    body: [
      "Na votação da comunidade, o Capítulo 9 de Celeste, o Farewell, ficou no topo da lista de desafios mais difíceis do ano. A escolha não surpreende quem já tentou: são telas longas, que cobram precisão do começo ao fim.",
      "## O que as dicas mais votadas dizem\n\nA recomendação mais repetida é dividir o capítulo em trechos curtos e dominar um por vez. Os jogadores também sugerem pausar para descansar quando a frustração aumenta, em vez de insistir por horas.",
      "## Para quem está começando\n\nNão é preciso encarar o Farewell logo de cara. As conquistas dos capítulos anteriores já rendem XP para a skill Plataforma e preparam o seu controle dos movimentos.",
      FOOTER,
    ].join("\n\n"),
    category: "GAMES",
    platforms: ["NINTENDO", "PC"],
    imageLabel: "celeste",
    authorHandle: "Al1enado",
    previewGameId: "celeste",
    featured: 0,
    likes: 31,
    comments: 18,
    agoHours: 5,
  },
  {
    slug: "resident-evil-4-rota-rank-s-plus-profissional",
    title: "Resident Evil 4: rota para o rank S+ no Profissional sem armas infinitas",
    subtitle:
      "Guia atualizado com os pontos de save que mais ajudam e os chefes que exigem preparo.",
    body: [
      "O rank S+ no modo Profissional pede uma jogada eficiente do início ao fim, e sem armas infinitas cada recurso conta. Este guia propõe uma rota que equilibra velocidade e segurança.",
      "## Pontos de save e preparo\n\nA rota indica onde salvar para recomeçar um trecho sem perder muito progresso, e quais compras priorizar no comerciante antes dos chefes que mais punem a falta de munição.",
      "## Os chefes que exigem mais\n\nPara cada chefe, o guia lista a arma recomendada e o tipo de munição a reservar. Em geral, vale gastar menos nos inimigos comuns e chegar às lutas grandes com folga.",
      "O texto é atualizado conforme a comunidade encontra variações melhores da rota. Se achar uma, envie a sua dica.",
      FOOTER,
    ].join("\n\n"),
    category: "GUIAS",
    platforms: ["PC", "PLAYSTATION", "XBOX"],
    imageLabel: "resident evil 4",
    authorHandle: "NascimentoRE",
    previewGameId: "re4",
    featured: 0,
    likes: 77,
    comments: 40,
    agoHours: 25,
  },
  {
    slug: "phasmophobia-conquistas-coop-que-mais-pedem-grupo",
    title: "Phasmophobia: as conquistas co-op que mais pedem grupo no Discord",
    subtitle:
      "Levantamos os pedidos de grupo da semana. Monte sua equipe pelo canal de caçadas.",
    body: [
      "Algumas conquistas de Phasmophobia só saem com uma equipe afinada, e os pedidos de grupo se repetem toda semana. Reunimos as que mais aparecem para facilitar a sua busca por parceiros.",
      "## O que costuma pedir grupo\n\nConquistas que exigem investigar um tipo específico de fantasma, ou cumprir objetivos opcionais na mesma partida, funcionam melhor com a comunicação de voz de todos os quatro jogadores.",
      "## Como montar a equipe\n\nUse o canal de caçadas do Discord da comunidade e combine horário, dificuldade e quem leva cada equipamento. Convidar a sua Família GAMELOG também ajuda a fechar o grupo mais rápido.",
      FOOTER,
    ].join("\n\n"),
    category: "COMUNIDADE",
    platforms: ["PC"],
    imageLabel: "phasmophobia",
    authorHandle: "Rivia",
    previewGameId: "phasmophobia",
    featured: 0,
    likes: 22,
    comments: 35,
    agoHours: 27,
  },
];
