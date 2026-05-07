// lib/perceptpixel-url.ts
//
// Pure URL helpers for PerceptPixel CDN URLs. Deliberately separated from
// lib/perceptpixel-utils.ts because that file does env-var validation at
// module load (throws if PERCEPTPIXEL_API_KEY is missing). Pure URL helpers
// have no such dependency, so they're safe to import from any module —
// Server Components, Client Components, or anywhere else.
//
// PerceptPixel transformation URL format (from their docs):
//   https://img.perceptpixel.com/<org-uid>/<transformations>/<filename>
//
// The transformations segment is comma-separated key-value pairs joined by
// underscores: w_60,h_60,c_pad,q_auto. Inserted between org-uid and filename.
//
// Source: https://perceptpixel.com/docs/Transformations/resize

/**
 * Build a thumbnail URL from a stored cdn_url.
 *
 * Input shape (what we store in DB after upload):
 *   https://img.perceptpixel.com/<org-uid>/<filename>
 *
 * Output shape:
 *   https://img.perceptpixel.com/<org-uid>/w_<size>,h_<size>,c_pad/<filename>
 *
 * Uses c_pad to maintain aspect ratio without cropping — important for
 * worker photos where we don't want to chop heads off. Adds padding to
 * make the image square instead.
 *
 * If the input doesn't contain a "/" (malformed/unexpected), returns it
 * unchanged — caller's `<img src>` will simply show the original.
 */
export function perceptpixelThumbnailUrl(cdnUrl: string, size: number): string {
  const lastSlash = cdnUrl.lastIndexOf("/");
  if (lastSlash === -1) return cdnUrl;
  const before = cdnUrl.slice(0, lastSlash);
  const after = cdnUrl.slice(lastSlash); // includes the leading slash
  return `${before}/w_${size},h_${size},c_pad${after}`;
}
