import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import de from "../../../messages/de.json";
import { FormField } from "./form-field";
import { InfoTip } from "./info-tip";

function renderDe(ui: ReactNode) {
  return render(
    <NextIntlClientProvider
      locale="de"
      messages={de}
      onError={(error) => {
        throw error;
      }}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("InfoTip", () => {
  afterEach(cleanup);

  it("keeps the explanation off the page until the i is pressed", () => {
    renderDe(<InfoTip testId="tip">Nur ganze Zahlen.</InfoTip>);
    const trigger = screen.getByTestId("tip");
    expect(trigger).toHaveAccessibleName(de.common.info);
    expect(trigger).toHaveAttribute("type", "button");
    expect(screen.queryByText("Nur ganze Zahlen.")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByText("Nur ganze Zahlen.")).toBeVisible();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });
});

describe("FormField info", () => {
  afterEach(cleanup);

  it("puts the hint behind an i and still describes the control for screen readers", () => {
    renderDe(
      <FormField id="weight" label="Gewicht" info="In Kilogramm, für die Auslastung.">
        <input />
      </FormField>,
    );
    const field = screen.getByLabelText("Gewicht");
    expect(field).toHaveAttribute("aria-describedby", "weight-description");
    const description = document.getElementById("weight-description")!;
    expect(description).toHaveTextContent("In Kilogramm, für die Auslastung.");
    // Read out, but not shown: the visible page stays free of help text.
    expect(description).toHaveClass("sr-only");
    expect(screen.getByRole("button", { name: de.common.info })).toBeInTheDocument();
  });

  it("shows no i when there is nothing to explain", () => {
    renderDe(
      <FormField id="name" label="Name">
        <input />
      </FormField>,
    );
    expect(screen.queryByRole("button", { name: de.common.info })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Name")).not.toHaveAttribute("aria-describedby");
  });
});
