/**
 * The picture a shared news link shows (og:image / twitter:image): what the reader sees at the top of the
 * article. Without it WhatsApp, X and Discord fall back to the site icon (Lucas, 05/11/2026). Heavy
 * originals are swapped for light versions, so WhatsApp, which skips large images, still shows one:
 * SteamGridDB heroes (multi-MB PNGs) for their 900px JPEG thumbnail, IGDB art for its 720p size.
 * Site paths ("/logos/…") stay relative: the root layout's metadataBase makes them absolute.
 */
export function shareImageUrl(article: {
  wideImageUrl?: string | null;
  heroUrl?: string | null;
  imageUrl?: string | null;
}): string | null {
  const url = [article.wideImageUrl, article.heroUrl, article.imageUrl].find(
    (u): u is string => typeof u === "string" && (u.startsWith("https://") || (u.startsWith("/") && !u.startsWith("//"))),
  );
  if (!url) return null;
  return url
    .replace(/^(https:\/\/cdn2\.steamgriddb\.com\/)hero\/([0-9a-f]+)\.(?:png|jpe?g|webp)$/i, "$1hero_thumb/$2.jpg")
    .replace(/(images\.igdb\.com\/igdb\/image\/upload\/)t_[a-z0-9_]+\//, "$1t_720p/");
}
