/** Platforms connected with a code pasted in the profile (Exophase model). */
export type LinkPlatform = "steam" | "psn" | "xbox" | "retro";

export type PlatformGuide = {
  name: string;
  /** Label of the handle field. */
  handleLabel: string;
  placeholder: string;
  /** Longest accepted input (Steam takes a whole profile link). */
  maxLength: number;
  /** Profile field where the code is pasted. */
  field: string;
  /** Where that field is, step by step. */
  where: string;
  /** What has to be public for the import to work. */
  privacy: string;
  /** What the import brings ("troféus", "conquistas"). */
  unlocks: string;
};

/** Step-by-step verification copy per platform (pt-BR). */
export const PLATFORM_GUIDES: Record<LinkPlatform, PlatformGuide> = {
  steam: {
    name: "Steam",
    handleLabel: "Perfil Steam (link, nome personalizado ou SteamID64)",
    placeholder: "ex.: https://steamcommunity.com/id/seu-perfil",
    maxLength: 200,
    field: "Resumo",
    where:
      "Na Steam (app ou steamcommunity.com): abra seu perfil → Editar perfil → Resumo. Cole o código em qualquer lugar do texto e salve.",
    privacy: "Em Editar perfil → Privacidade, deixe Meu perfil e Detalhes de jogos como Público.",
    unlocks: "conquistas",
  },
  psn: {
    name: "PlayStation",
    handleLabel: "ID online da PSN",
    placeholder: "ex.: Lucas-Exemplo",
    maxLength: 40,
    field: "Sobre mim",
    where:
      "No PS5: Perfil → Editar perfil → Sobre mim. No app PlayStation: aba Perfil → menu (…) → Editar perfil → Sobre mim.",
    privacy:
      "Deixe os troféus visíveis para Qualquer pessoa em Configurações → Usuários e contas → Privacidade.",
    unlocks: "troféus",
  },
  xbox: {
    name: "Xbox",
    handleLabel: "Gamertag",
    placeholder: "ex.: LucasExemplo",
    maxLength: 40,
    field: "Bio",
    where: "No app Xbox ou em xbox.com: abra seu perfil → Personalizar perfil → Bio.",
    privacy:
      "Em Privacidade, deixe o histórico de jogos e conquistas visível para Todos.",
    unlocks: "conquistas",
  },
  retro: {
    name: "RetroAchievements",
    handleLabel: "Usuário do RetroAchievements",
    placeholder: "ex.: LucasExemplo",
    maxLength: 40,
    field: "Motto",
    where: "Em retroachievements.org: Settings → Profile → User Motto.",
    privacy: "Perfis do RetroAchievements já são públicos: nada a mudar.",
    unlocks: "conquistas",
  },
};
