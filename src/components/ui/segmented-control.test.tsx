import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Map as MapIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "./segmented-control";

const options = [
  { value: "list", label: "Liste", testId: "segment-list" },
  { value: "map", label: "Karte", icon: MapIcon, testId: "segment-map" },
];

describe("SegmentedControl", () => {
  afterEach(cleanup);

  it("renders every option and marks the current one as selected", () => {
    render(
      <SegmentedControl
        value="list"
        onValueChange={() => {}}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    const list = screen.getByTestId("segment-list");
    const map = screen.getByTestId("segment-map");
    // Radix renders the items as radios; the state is `aria-checked` (`aria-pressed` is invalid on
    // `role="radio"`).
    expect(list).toHaveRole("radio");
    expect(list).toHaveAttribute("aria-checked", "true");
    expect(map).toHaveAttribute("aria-checked", "false");
    expect(list).not.toHaveAttribute("aria-pressed");
    expect(list).toHaveTextContent("Liste");
  });

  it("exposes the group through its accessible name", () => {
    render(
      <SegmentedControl
        value="list"
        onValueChange={() => {}}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    expect(screen.getByRole("group", { name: "Ansicht" })).toBeInTheDocument();
  });

  it("reports the selected value when another segment is clicked", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        value="list"
        onValueChange={onValueChange}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    fireEvent.click(screen.getByTestId("segment-map"));
    expect(onValueChange).toHaveBeenCalledWith("map");
  });

  // Arrow-key roving focus is Radix behaviour and needs real focus tracking, which jsdom does not
  // provide; it is verified in the browser during the visual check instead.

  it("keeps the current selection when the active segment is pressed again", () => {
    const onValueChange = vi.fn();
    render(
      <SegmentedControl
        value="list"
        onValueChange={onValueChange}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    fireEvent.click(screen.getByTestId("segment-list"));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("draws one travelling thumb, inside the selected segment only", () => {
    const { rerender } = render(
      <SegmentedControl
        value="list"
        onValueChange={() => {}}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    expect(document.querySelectorAll('[data-slot="segmented-thumb"]')).toHaveLength(1);
    expect(
      screen.getByTestId("segment-list").querySelector('[data-slot="segmented-thumb"]'),
    ).not.toBeNull();
    // Not on page load: the knob only stretches once the user has moved it.
    expect(document.querySelector(".knob-stretch")).toBeNull();

    rerender(
      <SegmentedControl
        value="map"
        onValueChange={() => {}}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    expect(document.querySelectorAll('[data-slot="segmented-thumb"]')).toHaveLength(1);
    expect(
      screen.getByTestId("segment-map").querySelector('[data-slot="segmented-thumb"]'),
    ).not.toBeNull();
  });

  it("keeps the thumbs of two controls apart", () => {
    render(
      <>
        <SegmentedControl value="list" onValueChange={() => {}} options={options} ariaLabel="A" />
        <SegmentedControl
          value="map"
          onValueChange={() => {}}
          options={options.map((option) => ({ ...option, testId: undefined }))}
          ariaLabel="B"
        />
      </>,
    );
    expect(document.querySelectorAll('[data-slot="segmented-thumb"]')).toHaveLength(2);
  });

  it("stretches the thumb after the user picked another segment", () => {
    const onValueChange = vi.fn();
    const { rerender } = render(
      <SegmentedControl
        value="list"
        onValueChange={onValueChange}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    fireEvent.click(screen.getByTestId("segment-map"));
    expect(onValueChange).toHaveBeenCalledWith("map");
    rerender(
      <SegmentedControl
        value="map"
        onValueChange={onValueChange}
        options={options}
        ariaLabel="Ansicht"
      />,
    );
    expect(
      screen
        .getByTestId("segment-map")
        .querySelector('[data-slot="segmented-thumb"] .knob-stretch'),
    ).not.toBeNull();
  });
});
