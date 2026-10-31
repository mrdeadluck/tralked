/**
 * Hollow Knight guide, transcribed from the preview's `HK` object.
 * Achievement names refer to the Steam fixture's schema (`hollow-knight.json`);
 * the seed resolves them to `apiName`s and fails loudly if one is unknown.
 */

export type GuideCategory = "historia" | "chefes" | "coletaveis" | "desafio" | "dlc";

export const HK_GUIDE = {
  gameSlug: "hollow-knight",
  authorHandle: "Nyx_Vortex",
  status: "published" as const,
  version: "v3.2",
  difficulty: 8,
  hoursMin: 70,
  hoursMax: 100,
  playthroughs: "3 a 4",
  missables: 0,
  online: 0,
  usefulCount: 1284,
  overview: [
    "Hollow Knight é um metroidvania de exploração densa, com chefes exigentes e muitos coletáveis. O 100% de conquistas pede uma jornada completa, os panteões do conteúdo Godmaster e saves dedicados a speedrun e ao modo Alma de Aço.",
    "Nenhuma conquista é perdível de forma definitiva: depois dos créditos o jogo volta para antes do chefe final. A parte mais difícil está nos panteões e na Alma de Aço, onde morrer apaga o save.",
  ],
  warnings: [
    "Ritual e Banishment são excludentes no mesmo save. Faça Ritual na jornada principal e Banishment no save de speedrun.",
    "A Alma de Aço deve ser a última etapa: com a rota e os chefes dominados, o risco cai muito.",
    "Todas as expansões são gratuitas e já fazem parte do jogo.",
  ],
  /**
   * Collectibles (preview `HK.collect`), stored in `Guide.collectibles` as
   * `[{ name, total, description }]` (totals only, no per-user progress).
   */
  collectibles: [
    { name: "Larvas", total: 46, description: "Marcador de larvas vendido por Iselda." },
    { name: "Fragmentos de máscara", total: 16, description: "Cada 4 fragmentos viram uma máscara." },
    { name: "Fragmentos de vaso", total: 9, description: "Cada 3 fragmentos viram um vaso de alma." },
    { name: "Minério pálido", total: 6, description: "Usado para melhorar o ferrão." },
    { name: "Amuletos", total: 40, description: "Inclui os amuletos das expansões." },
    { name: "Chefes no Salão dos Deuses", total: 44, description: "Contagem usada nos panteões." },
  ],
  steps: [
    {
      title: "Jornada principal e exploração",
      hours: "35 a 45 h",
      body: "Jogue no ritmo normal explorando cada área. Pegue amuletos, máscaras e vasos que aparecerem no caminho e termine com o final padrão.",
      achievements: ["Falsehood", "Test of Resolve", "Proof of Resolve", "Charmed", "Protected", "Soulful", "Grubfriend", "The Hollow Knight"],
    },
    {
      title: "Limpeza de coletáveis",
      hours: "10 a 15 h",
      body: "Volte para fechar tudo antes de ir aos finais alternativos. Use o mapa completo e o marcador de larvas.",
      achievements: ["Metamorphosis", "Blessed", "Masked", "Worldsoul", "True Hunter", "Completion"],
    },
    {
      title: "Trupe Grimm",
      hours: "3 a 5 h",
      body: "Acenda a lanterna do pesadelo e complete o ritual neste save. Deixe Banishment para o save de speedrun.",
      achievements: ["Ritual"],
    },
    {
      title: "Finais alternativos",
      hours: "2 h",
      body: "Recarregue o save antes do chefe final para cada final restante.",
      achievements: ["Sealed Siblings", "Dream No More"],
    },
    {
      title: "Panteões de Hallownest",
      hours: "15 a 30 h",
      body: "Treine cada chefe no Salão dos Deuses antes de encarar um panteão inteiro. O quinto é o desafio final do jogo.",
      achievements: ["Brotherhood", "Inspiration", "Focus", "Soul and Shade", "Embrace the Void"],
    },
    {
      title: "Speedruns",
      hours: "5 a 20 h",
      body: "Novo save seguindo uma rota de speedrun. Speed Completion (100% em menos de 20 h) costuma ir num save separado.",
      achievements: ["Speedrun 1", "Speedrun 2", "Banishment", "Speed Completion"],
    },
    {
      title: "Alma de Aço",
      hours: "15 a 25 h",
      body: "Morrer apaga o save. Siga a mesma rota da speedrun com calma e evite lutas opcionais.",
      achievements: ["Steel Soul"],
    },
  ],
  notes: [
    { name: "Falsehood", category: "chefes", tip: "Primeiro chefe, nas Encruzilhadas Esquecidas. Quando ele cair atordoado, a cabeça fica exposta: é ali que o dano conta.", steps: ["Fique abaixo dele no salto e recue quando a maça bater no chão.", "Ataque a cabeça exposta a cada atordoamento.", "Use foco para curar só quando ele estiver se levantando."] },
    { name: "Test of Resolve", category: "chefes", tip: "Fique perto dela: o lançamento da agulha passa por cima se você estiver colado. Pule o golpe giratório." },
    { name: "Proof of Resolve", category: "chefes", tip: "Ela espalha espinhos pela arena. Mantenha distância média e puna depois de cada investida." },
    { name: "Charmed", category: "coletaveis", tip: "Acontece naturalmente no começo do jogo." },
    { name: "Blessed", category: "coletaveis", tip: "Alguns amuletos são vendidos por mercadores e outros exigem chefes opcionais. Confira a lista de coletáveis abaixo." },
    { name: "Protected", category: "coletaveis", tip: "A primeira máscara extra costuma vir naturalmente nas primeiras áreas." },
    { name: "Masked", category: "coletaveis", tip: "Vários fragmentos são vendidos ou ficam atrás de desafios de plataforma. Use o mapa completo para achar os que faltam." },
    { name: "Soulful", category: "coletaveis", tip: "Explore os cantos das primeiras áreas e compre o fragmento à venda em Dirtmouth." },
    { name: "Worldsoul", category: "coletaveis", tip: "O último costuma ser o mais escondido. Confira a contagem na tela de inventário." },
    { name: "Grubfriend", category: "coletaveis", tip: "Compre o marcador de larvas com Iselda em Dirtmouth para que elas apareçam no mapa." },
    { name: "Metamorphosis", category: "coletaveis", tip: "Ao entrar numa sala, ouça o choro das larvas presas. Com o marcador de Iselda, as que faltam aparecem no mapa." },
    { name: "True Hunter", category: "coletaveis", tip: "Alguns inimigos só aparecem em sonhos ou em áreas opcionais. Derrote o número exigido de cada um." },
    { name: "Completion", category: "coletaveis", tip: "A porcentagem fica na tela de save. Ela conta amuletos, máscaras, vasos, chefes e melhorias." },
    { name: "The Hollow Knight", category: "historia", spoiler: true, tip: "Final padrão. Ataque nas aberturas depois das investidas e mantenha distância dos golpes em área." },
    { name: "Sealed Siblings", category: "historia", spoiler: true, tip: "Com o Coração do Vazio equipado, derrote o Hollow Knight sem usar o Ferrão dos Sonhos na luta." },
    { name: "Dream No More", category: "historia", spoiler: true, tip: "Exige o Coração do Vazio. Na luta final, use o Ferrão dos Sonhos quando Hornet prender o Hollow Knight." },
    { name: "Ritual", category: "dlc", tip: "Junte as chamas do pesadelo pelo mapa e vença o rei do pesadelo no fim do ritual." },
    { name: "Banishment", category: "dlc", tip: "Excludente com Ritual no mesmo save. Faça no save de speedrun, seguindo a conversa com Brumm." },
    { name: "Brotherhood", category: "dlc", tip: "O primeiro panteão serve de treino para os próximos." },
    { name: "Inspiration", category: "dlc", tip: "Chefes com padrões rápidos. Treine os mais difíceis no Salão dos Deuses." },
    { name: "Focus", category: "dlc", tip: "Monte um conjunto de amuletos focado em dano e cura rápida." },
    { name: "Soul and Shade", category: "dlc", tip: "O mais longo antes do final. Pratique a sequência de chefes em blocos.", steps: ["Desbloqueie e treine cada chefe no Salão dos Deuses.", "Teste dois ou três conjuntos de amuletos e fique com o que dá mais folga.", "Faça tentativas completas só quando vencer cada chefe com consistência."] },
    { name: "Embrace the Void", category: "dlc", spoiler: true, tip: "Treine cada chefe no Salão dos Deuses antes de tentar o panteão inteiro. Amuletos de dano e alcance ajudam.", steps: ["Complete os quatro panteões anteriores.", "Vença os chefes finais isoladamente várias vezes seguidas.", "Reserve sessões longas: uma tentativa completa passa de uma hora."] },
    { name: "Speedrun 1", category: "desafio", tip: "Pule larvas e coletáveis opcionais. Foque nas habilidades de movimento obrigatórias." },
    { name: "Speedrun 2", category: "desafio", tip: "Faça no mesmo save do Speedrun 1. Siga uma rota de speedrun e só pegue os amuletos essenciais." },
    { name: "Speed Completion", category: "desafio", tip: "Use uma rota de coleta já otimizada e evite voltas desnecessárias pelo mapa." },
    { name: "Steel Soul", category: "desafio", tip: "Faça por último. Evite lutas opcionais arriscadas até ter vida e amuletos de sobra." },
  ] as {
    name: string;
    category: GuideCategory;
    spoiler?: boolean;
    tip: string;
    steps?: string[];
  }[],
  tips: [
    { handle: "KairoBR", votes: 342, body: "Para o Panteão de Hallownest, treinar só os últimos cinco chefes em sequência me poupou umas 10 horas." },
    { handle: "LunaDeFerro", votes: 198, body: "Na Alma de Aço, salve o banco antes de cada área nova. Parece óbvio, mas é onde mais gente perde o save." },
    { handle: "b0ltz", votes: 87, body: "Dá para fazer Banishment e Speedrun 2 no mesmo save sem perder tempo: Brumm fica no caminho." },
  ],
  /** Newest first; `agoDays` is days before the seed run. */
  revisions: [
    { version: "v3.2", summary: "Rota de speedrun revisada e dicas do Panteão de Hallownest ampliadas.", handle: "Nyx_Vortex", agoDays: 3 },
    { version: "v3.0", summary: "Guia reorganizado em 7 etapas e lista de coletáveis adicionada.", handle: "KairoBR", agoDays: 60 },
    { version: "v2.1", summary: "Correção sobre Ritual e Banishment serem excludentes.", handle: "b0ltz", agoDays: 150 },
    { version: "v1.0", summary: "Primeira versão publicada.", handle: "Nyx_Vortex", agoDays: 365 },
  ],
  /** Steps lucas has ticked in the preview (`S.stepsDone`): the first four. */
  lucasStepsDone: [0, 1, 2, 3],
};
