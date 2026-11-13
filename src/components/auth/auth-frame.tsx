import type { ReactNode } from "react";

import { Brand } from "@/components/shared/brand";

/**
 * The frame of every screen in front of the login: start page, office login, driver login.
 * One narrow column in the middle of the screen, the app mark on top, the page below it.
 * The column is centred with `my-auto`, so a tall page (small phone, open keyboard) scrolls from
 * the top instead of being cut off above the viewport.
 */
export function AuthFrame({
  children,
  brand = <Brand className="justify-center" />,
}: {
  children: ReactNode;
  /** The start page passes its own mark, because there the name is the `h1`. */
  brand?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-1 flex-col items-center px-4 py-6 sm:py-10">
      <div className="my-auto flex w-full max-w-sm flex-col gap-5">
        {brand}
        {children}
      </div>
    </div>
  );
}
