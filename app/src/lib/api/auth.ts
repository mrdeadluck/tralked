import { apiError } from "./errors";
import { verifyApiKey, type ApiKeyRecord, type ApiScope } from "./keys";
import { consumeRateLimit, rateLimitHeaders } from "./rate-limit";

export type Authorized = { ok: true; key: ApiKeyRecord; headers: Record<string, string> };
export type Refused = { ok: false; response: Response };

/**
 * Authenticates a bot request: 401 without an active key, 429 over the per-key limit, 403 when
 * the key lacks `scope`. On success `headers` carries the rate-limit headers for the answer.
 */
export async function authorize(request: Request, scope?: ApiScope): Promise<Authorized | Refused> {
  const key = await verifyApiKey(request.headers.get("authorization"));
  if (!key) {
    return {
      ok: false,
      response: apiError(
        "unauthorized",
        "Envie uma chave válida em Authorization: Bearer tk_live_… (a chave pode ter sido revogada).",
        [],
        { "WWW-Authenticate": 'Bearer realm="tralked"' },
      ),
    };
  }

  const limit = consumeRateLimit(key.id);
  const headers = rateLimitHeaders(limit);
  if (!limit.ok) {
    return {
      ok: false,
      response: apiError(
        "rate_limited",
        `Limite de ${limit.limit} requisições por minuto atingido. Tente de novo em ${limit.resetSeconds} s.`,
        [],
        headers,
      ),
    };
  }

  if (scope && !key.scopes.includes(scope)) {
    return { ok: false, response: missingScope(scope, headers) };
  }
  return { ok: true, key, headers };
}

export function missingScope(scope: ApiScope, headers?: Record<string, string>): Response {
  return apiError("forbidden", `Esta chave não tem o escopo ${scope}.`, [], headers);
}
