import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Which article an AI call works for, so the Claude Code counter can add up the cost per article
 * (`claude_usage.story_id`). Calls outside a context (triage, clustering) count as the collection's.
 */
export type UsageRef = {
  storyId?: number;
  pautaId?: number;
  /** For work whose row does not exist yet (a pauta is recorded after it is written): linked later by tag. */
  tag?: string;
};

const storage = new AsyncLocalStorage<UsageRef>();

export const withUsageRef = <T>(ref: UsageRef, fn: () => Promise<T>): Promise<T> => storage.run(ref, fn);

export const currentUsageRef = (): UsageRef => storage.getStore() ?? {};
