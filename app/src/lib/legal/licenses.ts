/** Third-party software, fonts and data shipped with or used by Tralked (shown on /licencas). */

export type LicenseEntry = {
  name: string;
  /** npm package name, when it is a runtime dependency (checked against package.json by a test). */
  pkg?: string;
  license: string;
  url: string;
  note?: string;
};

export const SOFTWARE: LicenseEntry[] = [
  { name: "Next.js", pkg: "next", license: "MIT", url: "https://github.com/vercel/next.js" },
  { name: "React", pkg: "react", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "React DOM", pkg: "react-dom", license: "MIT", url: "https://github.com/facebook/react" },
  { name: "Prisma", pkg: "prisma", license: "Apache-2.0", url: "https://github.com/prisma/prisma" },
  { name: "Prisma Client", pkg: "@prisma/client", license: "Apache-2.0", url: "https://github.com/prisma/prisma" },
  { name: "Prisma adapter-pg", pkg: "@prisma/adapter-pg", license: "Apache-2.0", url: "https://github.com/prisma/prisma" },
  { name: "node-postgres (pg)", pkg: "pg", license: "MIT", url: "https://github.com/brianc/node-postgres" },
  { name: "jose", pkg: "jose", license: "MIT", url: "https://github.com/panva/jose" },
  { name: "Zod", pkg: "zod", license: "MIT", url: "https://github.com/colinhacks/zod" },
  { name: "react-markdown", pkg: "react-markdown", license: "MIT", url: "https://github.com/remarkjs/react-markdown" },
  {
    name: "sharp",
    pkg: "sharp",
    license: "Apache-2.0",
    url: "https://github.com/lovell/sharp",
    note: "Inclui a libvips, sob LGPL-3.0-or-later.",
  },
  { name: "Vercel Blob SDK", pkg: "@vercel/blob", license: "Apache-2.0", url: "https://github.com/vercel/storage" },
  { name: "Tailwind CSS", license: "MIT", url: "https://github.com/tailwindlabs/tailwindcss" },
];

export const FONTS: LicenseEntry[] = [
  {
    name: "Archivo",
    license: "SIL Open Font License 1.1",
    url: "https://github.com/Omnibus-Type/Archivo",
    note: "Também incluída nos arquivos do site para a imagem de compartilhamento.",
  },
  { name: "JetBrains Mono", license: "SIL Open Font License 1.1", url: "https://github.com/JetBrains/JetBrainsMono" },
];

export const DATA_SOURCES: LicenseEntry[] = [
  {
    name: "Steam (Valve)",
    license: "Termos da Steam Web API",
    url: "https://steamcommunity.com/dev/apiterms",
    note: "Fichas, artes, conquistas e raridade global. Imagens e marcas são dos respectivos donos.",
  },
  { name: "IGDB (Twitch)", license: "Termos da API IGDB", url: "https://api-docs.igdb.com/", note: "Metadados de jogos." },
  { name: "RAWG", license: "Termos da API RAWG", url: "https://rawg.io/apidocs", note: "Metadados complementares (exige atribuição)." },
  { name: "SteamGridDB", license: "Termos do SteamGridDB", url: "https://www.steamgriddb.com/", note: "Capas, banners e logos enviados pela comunidade." },
  { name: "RetroAchievements", license: "Termos da Web API", url: "https://retroachievements.org/", note: "Conquistas de jogos retrô." },
  { name: "SteamSpy", license: "Dados públicos", url: "https://steamspy.com/", note: "Lista de jogos populares e tags." },
];
