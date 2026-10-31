export type RawItem = {
  url: string;
  title: string;
  summary: string | null;
  publishedAt: Date | null;
  sourceId: string;
  /** Publisher name when the feed provides one (Google News `<source>`). */
  publisher?: string;
  /**
   * Set when the item has no fetchable article page: a Google News item whose publisher URL could not
   * be resolved (`url` is then the Google redirect link). Later stages must not try to download or
   * extract text for these; the title, `publisher` and `summary` are all there is.
   */
  textUnavailable?: true;
};
