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
 * The transformation segment goes **immediately after the org-uid**, before
 * any folder/sub-path components. So:
 *
 *   in:  https://img.perceptpixel.com/<org>/<filename>
 *   out: https://img.perceptpixel.com/<org>/w_<size>,h_<size>,c_pad/<filename>
 *
 *   in:  https://img.perceptpixel.com/<org>/<folder>/<filename>
 *   out: https://img.perceptpixel.com/<org>/w_<size>,h_<size>,c_pad/<folder>/<filename>
 *
 * The naive "insert before last slash" approach we tried first lands the
 * transform between folder and filename — PerceptPixel returns 400 for that
 * shape. The transform must be the *second* path segment.
 *
 * Uses c_pad to maintain aspect ratio without cropping — important for
 * worker photos where we don't want to chop heads off. Adds padding to
 * make the image square instead.
 *
 * If the input is malformed (not a valid URL, or has fewer than 2 path
 * segments), returns it unchanged.
 */
export function perceptpixelThumbnailUrl(cdnUrl: string, size: number): string {
  let url: URL;
  try {
    url = new URL(cdnUrl);
  } catch {
    return cdnUrl;
  }
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length < 2) return cdnUrl;
  // PerceptPixel transformations (in this account/org) only work for files
  // inside a folder — root-level files (just <org>/<filename>, 2 segments)
  // return 404 for any transformation URL, even though the original works.
  // Empirically verified 2026-05-07: tried w_40/c_pad, w_40 alone, and
  // f_jpg alone — all 404 at root, all 200 in folder.
  // Fallback: return the original URL and let the rendering side use CSS
  // to scale it down. Loses bandwidth efficiency but stays visually correct.
  if (segments.length === 2) return cdnUrl;
  const [orgUid, ...rest] = segments;
  const transformation = `w_${size},h_${size},c_pad`;
  return `${url.origin}/${orgUid}/${transformation}/${rest.join("/")}`;
}
