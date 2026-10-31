/**
 * Upload limits shared by the browser (which compresses before sending) and the server (which
 * re-checks everything). Vercel Functions accept request bodies up to 4.5 MB, so the image itself
 * may have at most 4 MB and the multipart request stays under the platform limit.
 */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** Longest side of the stored image, in pixels (also the browser's resize target). */
export const MAX_DIMENSION = 2048;
/** WebP quality used by the browser before upload. */
export const CLIENT_WEBP_QUALITY = 0.85;

export const TOO_LARGE_MESSAGE = "A foto passou de 4 MB mesmo depois de comprimida. Tente uma imagem menor.";
