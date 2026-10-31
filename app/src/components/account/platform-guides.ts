export type CodePlatform = "psn" | "xbox" | "retro";

export type PlatformGuide = {
  name: string;
  /** Label of the handle field. */
  handleLabel: string;
  placeholder: string;
  /** Profile field where the code is pasted. */
  field: string;
  /** Where that field is, step by step. */
  where: string;
  /** What has to be public for the import to work. */
  privacy: string;
};

/** Step-by-step verification copy per platform (pt-BR). */
export const PLATFORM_GUIDES: Record<CodePlatform, PlatformGuide> = {
  psn: {
    name: "PlayStation",
    handleLabel: "ID online da PSN",
    placeholder: "ex.: Lucas-Exemplo",
    field: "Sobre mim",
    where:
      "No PS5: Perfil → Editar perfil → Sobre mim. No app PlayStation: aba Perfil → menu (…) → Editar perfil → Sobre mim.",
    privacy:
      "Deixe os troféus visíveis para Qualquer pessoa em Configurações → Usuários e contas → Privacidade.",
  },
  xbox: {
    name: "Xbox",
    handleLabel: "Gamertag",
    placeholder: "ex.: LucasExemplo",
    field: "Bio",
    where: "No app Xbox ou em xbox.com: abra seu perfil → Personalizar perfil → Bio.",
    privacy:
      "Em Privacidade, deixe o histórico de jogos e conquistas visível para Todos.",
  },
  retro: {
    name: "RetroAchievements",
    handleLabel: "Usuário do RetroAchievements",
    placeholder: "ex.: LucasExemplo",
    field: "Motto",
    where: "Em retroachievements.org: Settings → Profile → User Motto.",
    privacy: "Perfis do RetroAchievements já são públicos: nada a mudar.",
  },
};
