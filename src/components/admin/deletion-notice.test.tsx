import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeletionNotice } from "./deletion-notice";

describe("DeletionNotice", () => {
  it("is a note with its text, and stays off the printed bill", () => {
    render(<DeletionNotice testId="notice">Wird ab dem 17.11.2026 gelöscht.</DeletionNotice>);

    const note = screen.getByRole("note");
    expect(note).toHaveTextContent("Wird ab dem 17.11.2026 gelöscht.");
    expect(note).toHaveAttribute("data-testid", "notice");
    expect(note.className).toContain("print:hidden");
    // The icon is decoration: the sentence says everything.
    expect(note.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});
