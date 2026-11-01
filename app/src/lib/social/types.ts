/** What one visitor sees differently on a list of comments or posts (safe to import in client code). */
export type SocialViewerState = {
  /** The visitor's reactions by item id. */
  mine: Record<string, 1 | -1>;
  /** Authors in a block with the visitor (either way): their items show collapsed. */
  blocked: string[];
};

export const EMPTY_VIEWER_STATE: SocialViewerState = { mine: {}, blocked: [] };

/** Longest private message (characters). */
export const MESSAGE_MAX = 2000;

export type MessageView = { id: string; body: string; createdAt: Date; mine: boolean; senderHandle: string | null };
