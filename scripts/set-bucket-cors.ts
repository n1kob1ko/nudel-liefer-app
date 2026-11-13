/**
 * CORS rule of the photo bucket (NUD-202, docs/deploy-railway.md):
 * `tsx scripts/set-bucket-cors.ts --origin https://<app address> [--origin ...] [--apply]`.
 *
 * Needed whenever the bucket is on another host than the app (a Railway bucket, Cloudflare R2):
 * without it the browser refuses the photo upload ("CORS Missing Allow Origin"). Dry run by
 * default: it prints the rule it would put and the rules the bucket has now. Run it again with
 * every address the app is opened under whenever an address is added (the list is replaced).
 *
 * Reads S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY / S3_URL_STYLE like the
 * app. Exit codes: 0 = done, 1 = setup problem, 2 = the provider refused.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from "@aws-sdk/client-s3";

import { readS3Config } from "../src/server/storage/s3";
import { type CorsRule, corsRules } from "./lib/bucket-cors";

function parseArgs(argv: readonly string[]): { origins: string[]; apply: boolean } {
  const origins: string[] = [];
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--origin") origins.push(argv[++i] ?? "");
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return { origins, apply };
}

const describeRule = (rule: {
  ID?: string;
  AllowedOrigins?: string[];
  AllowedMethods?: string[];
}) =>
  `${rule.ID ?? "(no id)"}: ${(rule.AllowedMethods ?? []).join("/")} from ${(rule.AllowedOrigins ?? []).join(", ")}`;

async function main(): Promise<number> {
  let rules: CorsRule[];
  let apply: boolean;
  try {
    const options = parseArgs(process.argv.slice(2));
    rules = corsRules(options.origins);
    apply = options.apply;
  } catch (error) {
    console.error(
      `usage: tsx scripts/set-bucket-cors.ts --origin https://<app address> [--origin ...] [--apply]\n${(error as Error).message}`,
    );
    return 1;
  }
  const config = readS3Config(process.env);
  if (!config) {
    console.error("[cors] S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set");
    return 1;
  }
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.pathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const readRules = async () => {
    try {
      return (
        (await client.send(new GetBucketCorsCommand({ Bucket: config.bucket }))).CORSRules ?? []
      );
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchCORSConfiguration") return [];
      throw error;
    }
  };

  console.info(
    `[cors] bucket ${config.bucket}: ${describeRule(rules[0]!)} (${apply ? "APPLY" : "dry run"})`,
  );
  try {
    const current = await readRules();
    console.info(`[cors] configured now: ${current.map(describeRule).join("; ") || "none"}`);
    if (!apply) return 0;
    await client.send(
      new PutBucketCorsCommand({ Bucket: config.bucket, CORSConfiguration: { CORSRules: rules } }),
    );
    for (const rule of await readRules()) console.info(`[cors] rule ${describeRule(rule)}`);
  } catch (error) {
    console.error(
      `[cors] refused: ${(error as { name?: string }).name ?? "unknown"} ${(error as Error).message}`,
    );
    return 2;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`[cors] failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
