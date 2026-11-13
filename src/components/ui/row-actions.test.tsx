import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PencilIcon } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DropdownMenuItem } from "./dropdown-menu";
import { RowActions, RowButton, RowButtons } from "./row-actions";

describe("RowActions", () => {
  afterEach(cleanup);

  it("labels the icon-only trigger", () => {
    render(
      <RowActions label="Aktionen für Bestellung 4711">
        <DropdownMenuItem>Bearbeiten</DropdownMenuItem>
      </RowActions>,
    );
    const trigger = screen.getByRole("button", { name: "Aktionen für Bestellung 4711" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(trigger.textContent?.trim()).toBe("");
  });

  it("opens the menu with the children on click", () => {
    const onSelect = vi.fn();
    render(
      <RowActions label="Aktionen">
        <DropdownMenuItem onSelect={onSelect}>Bearbeiten</DropdownMenuItem>
      </RowActions>,
    );
    const trigger = screen.getByRole("button", { name: "Aktionen" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const item = screen.getByRole("menuitem", { name: "Bearbeiten" });
    fireEvent.click(item);
    expect(onSelect).toHaveBeenCalled();
  });
});

describe("RowButtons", () => {
  afterEach(cleanup);

  it("shows each action as a button with its word, no menu to open", () => {
    const onClick = vi.fn();
    render(
      <RowButtons>
        <RowButton icon={PencilIcon} label="Bearbeiten" onClick={onClick} />
      </RowButtons>,
    );
    const button = screen.getByRole("button", { name: "Bearbeiten" });
    expect(button).toHaveTextContent("Bearbeiten");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds the subject of the row to the accessible name", () => {
    render(
      <RowButtons>
        <RowButton icon={PencilIcon} label="Bearbeiten" subject="Transporter 1" />
      </RowButtons>,
    );
    expect(screen.getByRole("button", { name: "Bearbeiten: Transporter 1" })).toBeInTheDocument();
  });

  it("marks a destructive action in red", () => {
    render(
      <RowButtons>
        <RowButton icon={PencilIcon} label="Löschen" destructive />
      </RowButtons>,
    );
    expect(screen.getByRole("button", { name: "Löschen" })).toHaveClass("text-destructive");
  });
});
