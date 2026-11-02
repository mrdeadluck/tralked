import type { LinkPlatform } from "./profiles";
import type { VerifyFailure } from "./verify";

const NAME: Record<LinkPlatform, string> = { steam: "Steam", psn: "PlayStation", xbox: "Xbox", retro: "RetroAchievements" };
const FIELD: Record<LinkPlatform, string> = { steam: "Resumo", psn: "Sobre mim", xbox: "Bio", retro: "Motto" };

/** Why "Verificar agora" did not verify, in the words the connections page shows (pt-BR). */
export function verifyFailureMessage(reason: VerifyFailure, platform: LinkPlatform): string {
  const name = NAME[platform];
  switch (reason) {
    case "code_missing":
      return `Lemos o seu perfil ${name}, mas o código não está no campo "${FIELD[platform]}". Confira se o texto foi salvo com o código; a ${name} pode levar alguns minutos para mostrar a mudança.`;
    case "not_found":
      return platform === "psn" || platform === "retro"
        ? `Não encontramos o perfil ${name} conectado. Se você mudou o nome da conta, salve o nome novo no campo acima e verifique de novo.`
        : `Não encontramos o perfil ${name} conectado. Tente de novo em instantes.`;
    case "different":
      return `O nome conectado agora pertence a outra conta ${name}. Salve o nome atual da sua conta no campo acima e verifique de novo.`;
    case "private":
      return "Seu perfil Steam está privado, então o Resumo não aparece para ninguém. Deixe o perfil público e tente de novo.";
    case "error":
      return `A ${name} não respondeu a tempo. Tente de novo em instantes.`;
  }
}
