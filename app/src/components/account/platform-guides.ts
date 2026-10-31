/** Platforms connected on /conta/conexoes (Exophase model: type the profile and save). */
export type LinkPlatform = "steam" | "psn" | "xbox" | "retro";

export const LINK_PLATFORMS: LinkPlatform[] = ["steam", "psn", "xbox", "retro"];

export type PlatformGuide = {
  name: string;
  /** What the field takes, shown under it. */
  hint: string;
  placeholder: string;
  /** Longest accepted input (Steam takes a whole profile link). */
  maxLength: number;
  /** Profile field where a claim's code is pasted. */
  field: string;
  /** Where that field is, step by step. */
  where: string;
  /** What has to be public for the import to work (the privacy help). */
  privacy: string;
  /** What the import brings ("troféus", "conquistas"). */
  unlocks: string;
};

/** Field and help copy per platform (pt-BR). */
export const PLATFORM_GUIDES: Record<LinkPlatform, PlatformGuide> = {
  steam: {
    name: "Steam",
    hint: "Link do perfil (steamcommunity.com/id/… ou /profiles/…), nome personalizado ou SteamID64.",
    placeholder: "ex.: https://steamcommunity.com/id/seu-perfil",
    maxLength: 200,
    field: "Resumo",
    where:
      "Na Steam (app ou steamcommunity.com): abra seu perfil → Editar perfil → Resumo. Cole o código em qualquer lugar do texto e salve.",
    privacy:
      "Na Steam, abra seu perfil → Editar perfil → Configurações de privacidade e deixe “Meu perfil” e “Detalhes de jogos” como Público. Desmarque “Sempre manter meu tempo de jogo total privado” para o Tralked ver as horas jogadas.",
    unlocks: "conquistas",
  },
  psn: {
    name: "PlayStation",
    hint: "Seu ID online da PSN.",
    placeholder: "ex.: Lucas-Exemplo",
    maxLength: 40,
    field: "Sobre mim",
    where:
      "No PS5: Perfil → Editar perfil → Sobre mim. No app PlayStation: aba Perfil → menu (…) → Editar perfil → Sobre mim.",
    privacy:
      "No PS5: Configurações → Usuários e contas → Privacidade → Ver e personalizar suas configurações de privacidade, e deixe “Troféus” e “Jogos” visíveis para Qualquer pessoa. No app PlayStation o caminho é Configurações → Privacidade.",
    unlocks: "troféus",
  },
  xbox: {
    name: "Xbox",
    hint: "Sua gamertag (com o #1234 do final, se tiver).",
    placeholder: "ex.: LucasExemplo",
    maxLength: 40,
    field: "Bio",
    where: "No app Xbox ou em xbox.com: abra seu perfil → Personalizar perfil → Bio.",
    privacy:
      "Em account.xbox.com/Settings (Privacidade e segurança online → Privacidade do Xbox), deixe “Outras pessoas podem ver seu histórico de jogos e aplicativos” e “Você pode ver e compartilhar conquistas” como Todos.",
    unlocks: "conquistas",
  },
  retro: {
    name: "RetroAchievements",
    hint: "Seu usuário do RetroAchievements.",
    placeholder: "ex.: LucasExemplo",
    maxLength: 40,
    field: "Motto",
    where: "Em retroachievements.org: Settings → Profile → User Motto.",
    privacy: "Perfis do RetroAchievements já são públicos: nada a mudar. Se nada aparecer, confira se o usuário está escrito certo.",
    unlocks: "conquistas",
  },
};
