import { connection } from "next/server";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { AuthFrame } from "@/components/auth/auth-frame";
import { LogoutButton } from "@/components/auth/logout-button";
import { PurgeOfflineData } from "@/components/driver/purge-offline-data";
import { HelpLink } from "@/components/shared/help-link";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { AuthorizationError, requireRole } from "@/server/auth/guards";

import { LoginForm } from "./login-form";

/**
 * NUD-185 (QA 2026-10-29 F20): a signed-in visitor sees the login page instead of being bounced to
 * their home screen with no hint — plus who is signed in, the way back in and a way out. That is
 * what makes a shared office tablet usable for handing a tour to a driver.
 *
 * The "no session → purge the offline copy" rule (NUD-081) lives here with it: now that a signed-in
 * driver may legitimately open this page, the purge must not wipe his cached tour while he works.
 */
async function LoginIntro() {
  // The session is request data (see `requirePageActor`): without this the guard runs during
  // prerendering with an empty cookie jar.
  await connection();
  let actor: Awaited<ReturnType<typeof requireRole>> | null = null;
  try {
    actor = await requireRole("ADMIN", "DRIVER");
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
  }
  if (!actor) return <PurgeOfflineData />;
  const [t, locale] = await Promise.all([getTranslations("auth"), getLocale()]);
  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs"
      data-testid="login-session-banner"
    >
      <p className="text-base font-medium wrap-anywhere">{t("signedInAs", { name: actor.name })}</p>
      <div className="grid grid-cols-2 gap-2">
        <Link
          href={actor.role === "DRIVER" ? "/driver" : "/admin"}
          className={buttonVariants({ size: "lg" })}
          data-testid="login-continue"
        >
          {t("continue")}
        </Link>
        <LogoutButton locale={locale} className="w-full" />
      </div>
    </div>
  );
}

async function Body({
  kind,
  searchParams,
}: {
  kind: "admin" | "driver";
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { callbackUrl } = await searchParams;
  return (
    <LoginForm
      kind={kind}
      callbackUrl={typeof callbackUrl === "string" ? callbackUrl : undefined}
    />
  );
}

/** Login page body; reads `?callbackUrl` inside Suspense (dynamic data under cacheComponents). */
export function LoginPageContent(props: Parameters<typeof Body>[0]) {
  return (
    <AuthFrame>
      <Suspense>
        {/* Purges the offline copy when there is no session (NUD-081) — or names the signed-in user. */}
        <LoginIntro />
      </Suspense>
      <Suspense>
        <Body {...props} />
      </Suspense>
      {/* Help page (NUD-127): reachable without a login, so it belongs on both login screens. */}
      <p className="text-center text-base">
        <HelpLink className="inline-flex min-h-12 items-center px-3 link" />
      </p>
    </AuthFrame>
  );
}
