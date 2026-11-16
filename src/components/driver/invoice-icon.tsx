import { cn } from "@/lib/utils";

/**
 * The invoice mark on the driver screens: a bold "R" (Rechnung) in a ring, as the owner noted it on
 * 2026-11-16 ("ein Symbol R Zeichen, dann weiß er, dass er die Rechnung mitgeben muss"). Drawn as
 * paths, not as text, so it looks the same in every language and font and works offline. It uses
 * `currentColor`, so it follows the light and the dark theme.
 */
export function InvoiceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5 shrink-0", className)}
      aria-hidden
      focusable="false"
      data-icon="invoice"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10.25" strokeWidth="1.75" />
      <path d="M9.25 17.25V6.75h3.5a3 3 0 0 1 0 6h-3.5M12.25 12.75l3.25 4.5" strokeWidth="2.5" />
    </svg>
  );
}
