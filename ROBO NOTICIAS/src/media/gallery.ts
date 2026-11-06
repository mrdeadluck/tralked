import type { ItemRow, StoryRow } from "../db.js";

/**
 * News about new images (a screenshot drop, an official gallery) brings the images (Lucas, 05/11/2026):
 * a `gallery` block of the official pictures the sources carry. `chooseImages(..., { gallery: true })`
 * picks them with the same rules as the cover, in at most 2 vision calls.
 */
export const GALLERY_MIN = 3;
export const GALLERY_MAX = 8;

const IMAGES = /novas imagens|screenshots?|galeria|capturas|fotos oficiais|imagens oficiais|key art|new images|gallery/i;

/** The story is about new images: its headline or one of its items' titles says so. */
export function isImagesStory(story: Pick<StoryRow, "headline">, items: ItemRow[]): boolean {
  return IMAGES.test(story.headline) || items.some((i) => IMAGES.test(i.title));
}
