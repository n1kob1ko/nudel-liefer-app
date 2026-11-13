"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

const CELLS = 6;

/**
 * PIN input (redesign RD-2, re-design.md §5/§7.5, fixes F1).
 *
 * Six cells (48 × 56 px in the driver app) backed by **one real `<input>`** that keeps the caller's
 * `name`, `id`, `data-testid` and accessible name, submits with the form (progressive enhancement)
 * and is the element the e2e specs fill. The input is transparent and stretched over the cells, so
 * tapping any cell focuses the field; the cells are `aria-hidden` decoration (not buttons — that
 * would add six tiny, meaningless tab stops).
 *
 * Supports: typing, paste (pasting a 6-digit code), `←`/`→` to move the caret, `Backspace`/`Delete`,
 * `inputMode="numeric"` and `autoComplete="one-time-code"`. Non-digits are ignored.
 */
export function PinInput({
  value,
  onChange,
  length = CELLS,
  className,
  cellClassName,
  invalid,
  autoFocus,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type" | "maxLength"> & {
  /** Controlled value: the digits only (no separators). */
  value: string;
  onChange: (value: string) => void;
  length?: number;
  /** Style one cell (the driver login uses the default 48 × 56 px). */
  cellClassName?: string;
  /** Renders the cells in the error style; `aria-invalid` is forwarded to the real input. */
  invalid?: boolean;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [caret, setCaret] = React.useState(0);

  const digits = value.replace(/\D/g, "").slice(0, length).split("");
  // Where the next typed digit lands — the caret is always clamped to the cells that exist.
  const active = Math.min(caret, digits.length, length - 1);

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    setCaret(clean.length);
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    commit(event.target.value);
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData?.getData("text") ?? "";
    if (!/\d/.test(text)) return;
    event.preventDefault();
    commit(text);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setCaret(Math.max(0, (inputRef.current?.selectionStart ?? digits.length) - 1));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setCaret(Math.min(length, (inputRef.current?.selectionStart ?? 0) + 1));
    } else if (event.key === "Backspace") {
      event.preventDefault();
      const from = inputRef.current?.selectionStart ?? digits.length;
      const cut =
        from >= digits.length && digits.length > 0 ? digits.length - 1 : Math.max(0, from - 1);
      commit(digits.slice(0, cut).join(""));
    } else if (event.key === "Delete") {
      event.preventDefault();
      const from = inputRef.current?.selectionStart ?? 0;
      commit(digits.filter((_, index) => index !== from).join(""));
    }
  };

  return (
    <div
      data-slot="pin-input"
      className={cn("group/pin relative flex w-fit max-w-full items-center gap-2", className)}
    >
      <input
        {...props}
        ref={inputRef}
        type="password"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={length}
        value={value}
        autoFocus={autoFocus}
        aria-invalid={invalid || props["aria-invalid"] ? true : undefined}
        onChange={handleChange}
        onPaste={handlePaste}
        onKeyDown={handleKeyDown}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        // Transparent and stretched over the cells: only the caret is visible, the value never.
        className="absolute inset-0 z-10 w-full cursor-text rounded-md bg-transparent text-transparent caret-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      />
      <div className="flex min-w-0 items-center gap-2" aria-hidden>
        {Array.from({ length }, (_, index) => (
          <div
            key={index}
            data-slot="pin-cell"
            data-filled={index < digits.length ? "" : undefined}
            data-active={index === active ? "" : undefined}
            className={cn(
              "flex h-14 w-12 min-w-0 items-center justify-center rounded-md border bg-card text-2xl font-semibold tabular-nums transition-colors duration-150 motion-reduce:transition-none ",
              index === active && "border-foreground ring-[3px] ring-primary/60",
              invalid ? "border-destructive text-destructive" : "border-input text-foreground",
              cellClassName,
            )}
          >
            {digits[index] ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
