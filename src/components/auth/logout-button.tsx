import { getTranslations } from "next-intl/server";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logoutAction } from "@/server/auth/actions";

export async function LogoutButton({
  locale,
  className,
}: {
  locale: string;
  /** Extra classes for the button, e.g. `w-full` where it shares a row with another button. */
  className?: string;
}) {
  const t = await getTranslations("auth");
  return (
    <form action={logoutAction} data-testid="logout-form" className="contents">
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        className={cn(buttonVariants({ variant: "outline", size: "lg" }), className)}
        data-testid="logout"
      >
        {t("logout")}
      </button>
    </form>
  );
}
