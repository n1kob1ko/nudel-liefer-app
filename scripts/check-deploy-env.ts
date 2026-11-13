/**
 * Runs first in a hosted build (`pnpm build:vercel`, `pnpm build:railway`): fails fast with a
 * readable list of problems instead of a half-configured deployment. Outside Vercel and Railway
 * (VERCEL_ENV and RAILWAY_ENVIRONMENT_NAME unset) it does nothing, so both scripts can also be
 * tried locally with the variables set.
 */
import { checkDeployEnv } from "./lib/deploy-env";

if (
  !process.env.VERCEL_ENV &&
  !process.env.RAILWAY_ENVIRONMENT_NAME &&
  !process.env.CHECK_DEPLOY_ENV
) {
  console.log("[deploy-env] not a Vercel or Railway build, skipping");
} else {
  const { errors, warnings } = checkDeployEnv(process.env);
  for (const w of warnings) console.warn(`[deploy-env] warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`[deploy-env] error: ${e}`);
    console.error(
      "[deploy-env] see docs/deploy-railway.md (Railway) or docs/deploy.md section 'Environment variables' (Vercel)",
    );
    process.exit(1);
  }
  console.log("[deploy-env] ok");
}
