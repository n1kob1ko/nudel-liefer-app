import "dotenv/config";

import { createPrismaClient } from "../src/server/db";
import { backfillSerbian } from "../src/server/serbian-backfill";
import { getTranslator } from "../src/server/translator";

/**
 * Fills the missing Serbian (Latin) texts of existing rows (NUD-150, decision log NUD-140).
 *
 *   pnpm backfill:serbian             # dry run: counts only
 *   pnpm backfill:serbian -- --apply  # writes
 *
 * Needs `ANTHROPIC_API_KEY` (or a DeepL key plus the Claude key for the Serbian slot): with the
 * `FakeTranslator` the command refuses to run, because it would store "[sr-Latn] ..." placeholders.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const translator = getTranslator();
  if (translator.kind === "fake") {
    console.error(
      "No real translation provider is configured (ANTHROPIC_API_KEY missing) - refusing to write placeholder texts. Set the key in the environment and try again.",
    );
    process.exitCode = 1;
    return;
  }
  const db = createPrismaClient();
  try {
    const report = await backfillSerbian({ db, translator }, { apply });
    console.log(`[backfill-serbian] ${JSON.stringify(report)}`);
    if (!apply) console.log("Dry run: nothing was written. Re-run with --apply.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
