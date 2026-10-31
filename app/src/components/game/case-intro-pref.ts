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

export function writeIntroOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(INTRO_OFF_KEY, "1");
    else localStorage.removeItem(INTRO_OFF_KEY);
  } catch {
    // sem armazenamento local: a conta (se houver) guarda
  }
}
