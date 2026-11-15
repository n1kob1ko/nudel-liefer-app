import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type AbstractIntlMessages, NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import cs from "../../../messages/cs.json";
import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import srLatn from "../../../messages/sr-Latn.json";
import zhHans from "../../../messages/zh-Hans.json";
import { StopMarks } from "./stop-marks";

const LOCALES: Record<string, AbstractIntlMessages> = {
  de,
  en,
  "sr-Latn": srLatn,
  cs,
  "zh-Hans": zhHans,
};

function renderMarks(
  locale: string,
  stop: { intoFridge?: boolean; handInvoice?: boolean },
  interactive = true,
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={LOCALES[locale]}
      onError={(error) => {
        throw error;
      }}
      getMessageFallback={({ namespace, key }) => {
        throw new Error(`missing message ${namespace}.${key}`);
      }}
    >
      <StopMarks stop={stop} interactive={interactive} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe.each(Object.keys(LOCALES))("StopMarks in %s", (locale) => {
  const marks = (LOCALES[locale] as { driver: { marks: Record<string, string> } }).driver.marks;

  it("shows only the symbols; a tap opens the box that says what it means", () => {
    renderMarks(locale, { intoFridge: true, handInvoice: true });
    const fridge = screen.getByTestId("mark-fridge");
    expect(fridge).toHaveAccessibleName(marks.fridge);
    // Symbol only: no visible word next to it.
    expect(fridge).not.toHaveTextContent(marks.fridge);
    expect(fridge.querySelector('[data-icon="fridge"]')).not.toBeNull();
    expect(screen.queryByTestId("mark-fridge-info")).toBeNull();

    fireEvent.click(fridge);
    const info = screen.getByTestId("mark-fridge-info");
    expect(info).toHaveTextContent(marks.fridge);
    expect(info).toHaveTextContent(marks.fridgeInfo);

    fireEvent.keyDown(info, { key: "Escape" });
    fireEvent.click(screen.getByTestId("mark-invoice"));
    expect(screen.getByTestId("mark-invoice-info")).toHaveTextContent(marks.invoiceInfo);
  });

  it("is display only inside list rows, with the meaning for screen readers", () => {
    renderMarks(locale, { intoFridge: true }, false);
    const fridge = screen.getByTestId("mark-fridge");
    expect(fridge.tagName).toBe("SPAN");
    expect(fridge).toHaveTextContent(marks.fridge);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("mark-invoice")).toBeNull();
  });

  it("shows nothing without a mark", () => {
    const { container } = renderMarks(locale, {});
    expect(container).toBeEmptyDOMElement();
  });
});
