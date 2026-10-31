export const DEFAULT_RETURN_TO = "/jogador/me";

/** Only same-origin relative paths are allowed, to avoid open redirects. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return DEFAULT_RETURN_TO;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_RETURN_TO;
  }
  // Control characters (e.g. CR/LF) have no place in a redirect target.
  if (/[\u0000-\u001f\u007f]/.test(value)) return DEFAULT_RETURN_TO;
  return value;
}
