/**
 * How the URLs of an S3-compatible bucket are built (NUD-202).
 *
 * - path style: `https://endpoint/bucket/key` - MinIO, Cloudflare R2, the bucket behind nginx on
 *   the dedicated server. This has always been the rule whenever an endpoint is configured.
 * - virtual-hosted style: `https://bucket.endpoint/key` - Railway buckets (and AWS S3, which has no
 *   endpoint variable here and is virtual-hosted anyway).
 *
 * `S3_URL_STYLE` / `BACKUP_S3_URL_STYLE` are optional: unset keeps the old rule, `virtual` switches
 * an endpoint to bucket sub-domains. Pure and dependency-free: the CSP (src/lib/security-headers.ts,
 * also evaluated in the proxy) and the storage clients must agree on the host the browser talks to.
 */
const normalise = (style: string | undefined) => style?.trim().toLowerCase() ?? "";

/** True for an unset value, `path` and `virtual`. A deploy check refuses everything else. */
export function isKnownUrlStyle(style: string | undefined): boolean {
  const value = normalise(style);
  return value === "" || value === "path" || value === "virtual";
}

/** The `forcePathStyle` of the S3 client for this endpoint and style. */
export function usesPathStyle(endpoint: string | undefined, style: string | undefined): boolean {
  if (normalise(style) === "virtual") return false;
  return Boolean(endpoint?.trim());
}
