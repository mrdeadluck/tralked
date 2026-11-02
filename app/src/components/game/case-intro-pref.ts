/**
 * "Não mostrar a animação nos próximos jogos": this browser's copy of the choice (logged out, or
 * before the account's answer arrives). Logged in, the account (`User.caseIntroOff`) is the source
 * of truth and this copy follows it, so re-enabling in /conta reaches every device.
 */
export const INTRO_OFF_KEY = "tralked:case-intro:off";

export function readIntroOff(): boolean {
  try {
    return localStorage.getItem(INTRO_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The intro plays on its own at most once per browser session (tab): the next new game of the same
 * visit opens straight away. "Abrir a capinha de novo" still replays it on request.
 */
export const INTRO_SESSION_KEY = "tralked:case-intro:session";

export function readIntroPlayedThisSession(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

export function markIntroPlayedThisSession(): void {
  try {
    sessionStorage.setItem(INTRO_SESSION_KEY, "1");
  } catch {
    // sem armazenamento de sessão: a animação segue a regra por jogo
  }
}

export function writeIntroOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(INTRO_OFF_KEY, "1");
    else localStorage.removeItem(INTRO_OFF_KEY);
  } catch {
    // sem armazenamento local: a conta (se houver) guarda
  }
}
