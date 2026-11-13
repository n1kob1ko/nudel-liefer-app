/**
 * NUD-093: verifies that the object-storage bucket is NOT publicly readable. Sends anonymous
 * (unsigned) requests to the bucket and to an object key; a private bucket answers 401/403 to both
 * (S3, R2 and MinIO answer 403 even for keys that do not exist, so a 200/404 means anonymous access
 * is allowed). Needs S3_ENDPOINT (+ S3_BUCKET) or, for AWS S3, S3_BUCKET + S3_REGION.
 *
 *   pnpm exec tsx scripts/check-storage-private.ts
 *
 * Exit code 0 = private, 1 = public or unexpected answer, 2 = not configured.
 */
import { usesPathStyle } from "../src/lib/s3-url-style";
import { storageSources } from "../src/lib/security-headers";

const bucket = process.env.S3_BUCKET?.trim();
const base = storageSources(process.env)[0];
if (!bucket || !base) {
  console.error("S3_BUCKET and S3_ENDPOINT (or S3_REGION for AWS) must be set.");
  process.exit(2);
}
const pathStyle = usesPathStyle(process.env.S3_ENDPOINT, process.env.S3_URL_STYLE);
const root = pathStyle ? `${base}/${bucket}` : base;
const targets = [
  { label: "bucket listing", url: `${root}${pathStyle ? "/" : "/?list-type=2"}` },
  { label: "object read", url: `${root}/customers/00000000-0000-4000-8000-000000000000.jpg` },
];

// `package.json` has no "type": "module", so tsx compiles this file as CommonJS, where top-level
// await is not supported. The checks live in an async main() for that reason.
async function main() {
  let failed = false;
  for (const { label, url } of targets) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      const private_ = response.status === 401 || response.status === 403;
      console.log(
        `${private_ ? "ok  " : "FAIL"} ${label}: anonymous GET -> HTTP ${response.status}`,
      );
      if (!private_) failed = true;
    } catch (error) {
      console.error(
        `FAIL ${label}: request failed (${error instanceof Error ? error.message : error})`,
      );
      failed = true;
    }
  }
  console.log(
    failed
      ? "The bucket may be publicly readable or unreachable: check the provider settings (docs/deploy.md)."
      : "Anonymous access is refused: the bucket is private.",
  );
  // Set the exit code instead of calling process.exit(): a forced exit while fetch()'s handles are
  // still closing trips a libuv assertion on Windows (exit code 0xC0000409) and loses the real code.
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
