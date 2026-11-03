import type { z } from "zod";

/**
 * Error format of the bot API (`/api/v1/*`):
 * `{ "error": { "code", "message", "issues": [{ "path", "message" }] } }`.
 * `path` is a JSON Pointer (RFC 6901) into the request body; "" is the body itself.
 */

export type ApiIssue = { path: string; message: string };

export type ApiErrorCode =
  | "bad_request"
  | "invalid_json"
  | "idempotency_key_required"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "slug_conflict"
  | "guide_exists"
  | "published_locked"
  | "idempotency_conflict"
  | "unsupported_media_type"
  | "payload_too_large"
  | "validation_failed"
  | "rate_limited";

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; issues: ApiIssue[] } };

/** Every status code an error can carry, in one place for the docs and the OpenAPI document. */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  bad_request: 400,
  invalid_json: 400,
  idempotency_key_required: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  slug_conflict: 409,
  guide_exists: 409,
  published_locked: 409,
  idempotency_conflict: 409,
  unsupported_media_type: 415,
  payload_too_large: 413,
  validation_failed: 422,
  rate_limited: 429,
};

export function errorBody(code: ApiErrorCode, message: string, issues: ApiIssue[] = []): ApiErrorBody {
  return { error: { code, message, issues } };
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  issues: ApiIssue[] = [],
  headers?: HeadersInit,
): Response {
  return Response.json(errorBody(code, message, issues), { status: ERROR_STATUS[code], headers });
}

/** `["blocks", 3, "url"]` -> `/blocks/3/url` (with `~` and `/` escaped as RFC 6901 says). */
export function toPointer(path: readonly PropertyKey[]): string {
  return path.map((part) => `/${String(part).replace(/~/g, "~0").replace(/\//g, "~1")}`).join("");
}

/** zod issues as API issues. Unknown keys get one issue each, pointing at the key itself. */
export function zodIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => ({
        path: toPointer([...issue.path, key]),
        message: "Campo desconhecido",
      }));
    }
    return [{ path: toPointer(issue.path), message: issue.message }];
  });
}
