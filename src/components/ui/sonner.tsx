"use client";

import { useTranslations } from "next-intl";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toast host (redesign RD-2, re-design.md §5). Mount once — `src/app/[locale]/layout.tsx` renders
 * the single global `<Toaster />` for both apps.
 *
 * Position: this component cannot know whether the viewer is in the driver or the admin app, so the
 * position is a prop with a sensible default. The shell that owns the layout passes
 * `position="bottom-center"` for the driver app (above the sticky action bar) and
 * `position="top-right"` for the admin app. Toasts with an `action` render a labelled button
 * (sonner does that itself), which is what the offline "Rückgängig" undo uses.
 */
function Toaster({
  position = "top-right",
  theme = "light",
  toastOptions,
  ...props
}: ToasterProps & { position?: ToasterProps["position"] }) {
  const t = useTranslations("common");
  return (
    <Sonner
      // Follows the app's colour-scheme choice (NUD-132), which the root layout passes down; "system"
      // would follow the OS and disagree with the class on <html>.
      theme={theme}
      position={position}
      // The live region's name is read by screen readers: localized, without the "alt+T" hotkey hint.
      containerAriaLabel={t("notifications")}
      hotkey={[]}
      className="toaster group"
      toastOptions={{
        ...toastOptions,
        classNames: {
          toast: "rounded-lg border border-border shadow-md",
          actionButton:
            "btn-edge rounded-md bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-transform duration-[140ms] ease-out active:scale-[.97]",
          cancelButton: "rounded-md bg-muted px-3 py-1.5 font-medium text-foreground",
          ...toastOptions?.classNames,
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
