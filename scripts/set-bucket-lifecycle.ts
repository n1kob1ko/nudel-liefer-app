/**
 * Bucket lifecycle for the order screenshots (NUD-113 item 3, docs/deploy.md section 11.3):
 * `tsx scripts/set-bucket-lifecycle.ts [--days 190] [--apply]`.
 *
 * The retention cron deletes screenshot rows *and* their objects; this rule is the belt-and-braces
 * that also removes an object whose row was lost. Dry run by default: it prints the rule it would
 * put and reads back the current configuration.
 *
 * Self-contained like the other operator scripts (copy it to the server with `scp`, run it there
 * with the app's environment). Exit codes: 0 = done, 1 = setup problem, 2 = the provider refused.
 */
import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { readS3Config } from "../src/server/storage/s3";

const DEFAULT_DAYS = 190;
const PREFIX = "screenshots/";
const RULE_ID = "expire-order-screenshots";

function parseArgs(argv: readonly string[]): { days: number; apply: boolean } {
  let days = DEFAULT_DAYS;
  let apply = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") apply = true;
    else if (argv[i] === "--days") days = Number(argv[++i]);
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("--days must be 1..3650");
  return { days, apply };
}

async function main(): Promise<number> {
  let options: { days: number; apply: boolean };
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(
      `usage: tsx scripts/set-bucket-lifecycle.ts [--days 190] [--apply]\n${(error as Error).message}`,
    );
    return 1;
  }
  const config = readS3Config(process.env);
  if (!config) {
    console.error("[lifecycle] S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not set");
    return 1;
  }
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.pathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });

  const rule = {
    ID: RULE_ID,
    Status: "Enabled" as const,
    Filter: { Prefix: PREFIX },
    Expiration: { Days: options.days },
  };
  console.info(
    `[lifecycle] bucket ${config.bucket}: ${RULE_ID} expires ${PREFIX} after ${options.days} days ` +
      `(${options.apply ? "APPLY" : "dry run"})`,
  );

  try {
    const current = await client.send(
      new GetBucketLifecycleConfigurationCommand({ Bucket: config.bucket }),
    );
    console.info(
      `[lifecycle] configured rules: ${(current.Rules ?? []).map((r) => r.ID ?? "(no id)").join(", ") || "none"}`,
    );
    // Keep every foreign rule; replace only our own.
    const others = (current.Rules ?? []).filter((r) => r.ID !== RULE_ID);
    if (!options.apply) return 0;
    await client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: config.bucket,
        LifecycleConfiguration: { Rules: [...others, rule] },
      }),
    );
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NoSuchLifecycleConfiguration") {
      console.info("[lifecycle] no lifecycle configuration yet");
      if (!options.apply) return 0;
      await client.send(
        new PutBucketLifecycleConfigurationCommand({
          Bucket: config.bucket,
          LifecycleConfiguration: { Rules: [rule] },
        }),
      );
    } else {
      console.error(`[lifecycle] refused: ${name ?? "unknown"} ${(error as Error).message}`);
      return 2;
    }
  }

  const after = await client.send(
    new GetBucketLifecycleConfigurationCommand({ Bucket: config.bucket }),
  );
  for (const r of after.Rules ?? []) {
    console.info(
      `[lifecycle] rule ${r.ID ?? "(no id)"}: prefix ${r.Filter?.Prefix ?? "-"}, expire ${r.Expiration?.Days ?? "-"} day(s), ${r.Status}`,
    );
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error("[lifecycle] failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
