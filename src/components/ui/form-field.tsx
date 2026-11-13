"use client";

import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement, useId } from "react";

import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * FormField (redesign RD-2, re-design.md §5/§7.5, fixes F1).
 *
 * The wrapper owns the label, the optional description or info hint, the control and the inline
 * error text, and
 * wires the aria relationships for the caller. Errors are **localized text passed in by the caller**
 * — this layer never renders a browser validation bubble (forms use `noValidate`; zod messages go
 * through next-intl).
 *
 * Wiring: pass the control as the single child and FormField sets `aria-describedby` (description
 * + error) and `aria-invalid` on it. When the control already defines an id, that id is reused so
 * an external `<Label htmlFor>` keeps pointing at the right element.
 */
export type FieldIds = { control: string; description: string; error: string };

/** Stable ids for one field; exported for callers that prefer to wire the attributes themselves. */
export function fieldIds(id: string): FieldIds {
  return { control: id, description: `${id}-description`, error: `${id}-error` };
}

export function FormField({
  label,
  children,
  description,
  info,
  error,
  required = false,
  htmlFor,
  hint,
  id,
  className,
  "aria-describedby": ariaDescribedBy,
}: {
  label: ReactNode;
  children: ReactNode;
  /**
   * Helper text that is always visible under the label. Use it only for what the user must read
   * to fill the field in correctly; everything else is `info`.
   */
  description?: string;
  /**
   * An explanation behind a small "i" next to the label (`InfoTip`): one tap away, not on the page.
   * It is also the field's description for screen readers, so nothing is lost without a pointer.
   */
  info?: string;
  /** Localized error text; rendered below the control and announced through the wired attributes. */
  error?: string;
  required?: boolean;
  /** Overrides the control id the label points at (defaults to the child's id or a generated one). */
  htmlFor?: string;
  /** Optional trailing hint (e.g. a link or a counter) rendered next to the label. */
  hint?: ReactNode;
  /** Id base for the generated description/error ids; defaults to `useId()`. */
  id?: string;
  className?: string;
  /** Extra ids appended to the control's `aria-describedby`. */
  "aria-describedby"?: string;
}) {
  const generated = useId();
  const childElement = isValidElement<{ id?: string; "aria-describedby"?: string }>(children)
    ? children
    : null;
  const childId = typeof childElement?.props.id === "string" ? childElement.props.id : undefined;
  const ids = fieldIds(id ?? childId ?? generated);
  // The caller's own `aria-describedby` (prop or attribute on the control) is kept, and the field's
  // own description/error ids are appended.
  const extra = childElement?.props["aria-describedby"] ?? ariaDescribedBy;
  const describedBy = [
    extra,
    description || info ? ids.description : null,
    error ? ids.error : null,
  ]
    .filter(Boolean)
    .join(" ");

  const control = childElement
    ? cloneElement(childElement as ReactElement<Record<string, unknown>>, {
        // Keep the external `<Label htmlFor>` pointing at the real control, even when the caller
        // did not set an id itself.
        id: childId ?? ids.control,
        "aria-describedby": describedBy || undefined,
        "aria-invalid": error ? true : undefined,
      })
    : children;

  return (
    <div data-slot="form-field" className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-2">
        {/* Inline, so a wrapping label keeps the asterisk right after its last word — and the
            asterisk stays outside the <label>, so the accessible name is exactly the label text. */}
        <span className="min-w-0 text-base font-medium">
          <Label htmlFor={htmlFor ?? ids.control} className="inline text-base font-medium">
            {label}
          </Label>
          {required ? (
            <span className="ms-1 text-destructive" aria-hidden>
              *
            </span>
          ) : null}
          {info ? <InfoTip className="ms-1.5 -mt-0.5">{info}</InfoTip> : null}
        </span>
        {hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
      </div>
      {description ? (
        <p id={ids.description} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : info ? (
        <p id={ids.description} className="sr-only">
          {info}
        </p>
      ) : null}
      {control}
      {error ? (
        <p id={ids.error} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
