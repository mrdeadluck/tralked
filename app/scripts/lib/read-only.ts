const READ_ONLY = "-c default_transaction_read_only=on";

/**
 * `url` with every session it opens set read-only (`options` startup parameter, which pg sends to
 * the server), so a dry run cannot write even through a pooled connection opened later. Options the
 * URL already carries are kept.
 */
export function readOnlyUrl(url: string): string {
  const parsed = new URL(url);
  const options = parsed.searchParams.get("options");
  parsed.searchParams.set("options", options ? `${options} ${READ_ONLY}` : READ_ONLY);
  return parsed.toString();
}

/** Throws unless `show()` (the session's `SHOW default_transaction_read_only`) answers "on". */
export async function assertReadOnly(show: () => Promise<string | undefined>): Promise<void> {
  const value = await show();
  if (value !== "on") throw new Error(`The database session is not read-only (default_transaction_read_only = ${value ?? "?"}).`);
}
