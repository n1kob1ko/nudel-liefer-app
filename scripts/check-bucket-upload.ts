/**
 * Proves that a browser at the app's address can upload to and read from the photo bucket
 * (NUD-202): `pnpm bucket:check [--origin https://<app address>]`.
 *
 * It does what the browser does, with the `Origin` header a page of the app would send:
 *   1. the preflight (OPTIONS) of the upload,
 *   2. the upload itself (PUT to a presigned URL),
 *   3. reading the object back from a presigned URL,
 * and checks that every answer carries `Access-Control-Allow-Origin` for that origin. The test
 * object (`healthcheck/...`) is deleted again. Origins come from `--origin` or `S3_CORS_ORIGINS`.
 *
 * Exit codes: 0 = a browser upload works, 1 = setup problem, 2 = a step failed (the line says which).
 */
import { getStorage, readS3Config } from "../src/server/storage";
import { parseOrigin } from "./lib/bucket-cors";

function readOrigins(argv: readonly string[]): string[] {
  const values = (process.env.S3_CORS_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--origin") values.push(argv[++i] ?? "");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return [...new Set(values.map(parseOrigin))];
}

const allows = (response: Response, origin: string) => {
  const value = response.headers.get("access-control-allow-origin");
  return value === origin || value === "*";
};

async function checkOrigin(origin: string): Promise<boolean> {
  const storage = getStorage();
  const key = `healthcheck/cors-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
  const body = Buffer.from("routenplanner bucket check\n");
  const contentType = "text/plain";
  let ok = true;
  const step = (label: string, passed: boolean, detail: string) => {
    console.info(`[bucket-check] ${passed ? "ok  " : "FAIL"} ${origin} ${label}: ${detail}`);
    if (!passed) ok = false;
  };

  const target = await storage.createUploadUrl({ key, contentType, contentLength: body.length });
  try {
    const preflight = await fetch(target.url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    step(
      "preflight",
      preflight.ok && allows(preflight, origin),
      `HTTP ${preflight.status}, allow-origin ${preflight.headers.get("access-control-allow-origin") ?? "missing"}`,
    );

    const put = await fetch(target.url, {
      method: target.method,
      headers: { ...target.headers, Origin: origin },
      body: new Uint8Array(body),
    });
    step(
      "upload",
      put.ok && allows(put, origin),
      `HTTP ${put.status}, allow-origin ${put.headers.get("access-control-allow-origin") ?? "missing"}`,
    );

    const get = await fetch(await storage.getReadUrl(key), { headers: { Origin: origin } });
    const text = get.ok ? await get.text() : "";
    step(
      "read",
      get.ok && allows(get, origin) && text === body.toString(),
      `HTTP ${get.status}, allow-origin ${get.headers.get("access-control-allow-origin") ?? "missing"}, ${text.length} bytes`,
    );
  } finally {
    await storage.delete(key).catch(() => undefined);
  }
  return ok;
}

async function main(): Promise<number> {
  let origins: string[];
  try {
    origins = readOrigins(process.argv.slice(2));
  } catch (error) {
    console.error(
      `usage: tsx scripts/check-bucket-upload.ts [--origin https://<app address>]\n${(error as Error).message}`,
    );
    return 1;
  }
  if (origins.length === 0) {
    console.error("[bucket-check] no origin: pass --origin or set S3_CORS_ORIGINS");
    return 1;
  }
  if (!readS3Config(process.env)) {
    console.error("[bucket-check] S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set");
    return 1;
  }
  let ok = true;
  for (const origin of origins) {
    try {
      if (!(await checkOrigin(origin))) ok = false;
    } catch (error) {
      console.error(
        `[bucket-check] FAIL ${origin}: ${error instanceof Error ? error.message : String(error)}`,
      );
      ok = false;
    }
  }
  return ok ? 0 : 2;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(
      `[bucket-check] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  },
);
