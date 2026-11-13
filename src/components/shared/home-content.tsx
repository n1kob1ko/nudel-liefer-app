import { BriefcaseBusinessIcon, ChevronRightIcon, type LucideIcon, TruckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { AuthFrame } from "@/components/auth/auth-frame";
import { Link } from "@/i18n/navigation";

import { Brand } from "./brand";
import { LanguageSwitcher } from "./language-switcher";

/** One way in: a whole row to tap, 72 px high, with what is behind it in a few words. */
function Entry({
  href,
  icon: Icon,
  title,
  hint,
  testId,
}: {
  href: "/admin" | "/driver";
  icon: LucideIcon;
  title: string;
  hint: string;
  testId: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className="group flex min-h-18 items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-xs transition-[border-color,box-shadow,transform] duration-150 ease-out outline-none hover:border-input/60 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-[.99] motion-reduce:transition-none"
    >
      <span
        aria-hidden
        className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"
      >
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg font-semibold">{title}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
      <ChevronRightIcon
        aria-hidden
        className="size-5 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5 motion-reduce:transition-none rtl:rotate-180"
      />
    </Link>
  );
}

/**
 * Start page: the two ways into the app. `/admin` and `/driver` send a visitor without a session
 * to the matching login and everybody else straight to their screen, so one tap is enough either way.
 */
export function HomeContent() {
  const t = useTranslations("home");
  return (
    <AuthFrame brand={<Brand as="h1" className="justify-center" data-testid="title" />}>
      <main className="flex flex-col gap-3">
        <Entry
          href="/admin"
          icon={BriefcaseBusinessIcon}
          title={t("office")}
          hint={t("officeHint")}
          testId="home-office"
        />
        <Entry
          href="/driver"
          icon={TruckIcon}
          title={t("driver")}
          hint={t("driverHint")}
          testId="home-driver"
        />
      </main>
      <div className="flex justify-center">
        <LanguageSwitcher variant="compact" />
      </div>
    </AuthFrame>
  );
}
