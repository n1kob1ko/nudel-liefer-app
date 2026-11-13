/**
 * The CORS rule of the photo bucket (NUD-202). The browser uploads a photo with a plain PUT to a
 * presigned URL (src/lib/upload-image.ts) and the offline code reads photos with fetch, so a bucket
 * on another origin than the app must answer the preflight. On the dedicated server the bucket sat
 * behind the app's own nginx (same origin, no CORS); a Railway bucket lives on its own host.
 * Pure: `scripts/set-bucket-cors.ts` talks to the bucket.
 */
export type CorsRule = {
  ID: string;
  AllowedOrigins: string[];
  AllowedMethods: string[];
  AllowedHeaders: string[];
  ExposeHeaders: string[];
  MaxAgeSeconds: number;
};

export const CORS_RULE_ID = "nudel-browser-uploads";

/**
 * A bare origin (`https://host[:port]`), lower-cased. Refuses wildcards, paths and plain http
 * (except localhost): the rule decides which web pages may write into the bucket with a signed URL.
 */
export function parseOrigin(value: string): string {
  const text = value.trim();
  if (!text || text.includes("*")) throw new Error(`not an origin: "${value}"`);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`not an origin: "${value}"`);
  }
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username) {
    throw new Error(`an origin has no path or query: "${value}"`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error(`the origin must be https (http only for localhost): "${value}"`);
  }
  return url.origin;
}

export function corsRules(origins: readonly string[]): CorsRule[] {
  const allowed = [...new Set(origins.map(parseOrigin))];
  if (allowed.length === 0) throw new Error("at least one --origin is needed");
  return [
    {
      ID: CORS_RULE_ID,
      AllowedOrigins: allowed,
      AllowedMethods: ["GET", "HEAD", "PUT"],
      // The upload sends exactly one own header (Content-Type, part of the signature).
      AllowedHeaders: ["content-type"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    },
  ];
}
