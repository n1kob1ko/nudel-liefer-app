import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import de from "../../../messages/de.json";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "./dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";
import { Switch } from "./switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function withMessages(ui: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="de" messages={de}>
      {ui}
    </NextIntlClientProvider>
  );
}

afterEach(cleanup);

describe("overlay motion", () => {
  it("lets a popover grow out of its trigger and removes it again on close", async () => {
    render(
      <Popover>
        <PopoverTrigger>Filter</PopoverTrigger>
        <PopoverContent>Inhalt</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByText("Filter"));
    const content = await screen.findByText("Inhalt");
    expect(content).toHaveClass("pop");
    expect(content.className).toContain("--radix-popover-content-transform-origin");
    // No leftover fade classes from the old look, which would fight the new keyframes.
    expect(content.className).not.toContain("animate-in");

    fireEvent.click(screen.getByText("Filter"));
    await waitFor(() => expect(screen.queryByText("Inhalt")).toBeNull());
  });

  it("anchors a menu to its trigger as well", async () => {
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger>Mehr</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Bearbeiten</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const menu = await screen.findByRole("menu");
    expect(menu).toHaveClass("pop");
    expect(menu.className).toContain("--radix-dropdown-menu-content-transform-origin");
  });

  it("opens a dialog from the centre, settles its content, and closes with Escape", async () => {
    render(
      withMessages(
        <Dialog>
          <DialogTrigger>Öffnen</DialogTrigger>
          <DialogContent>
            <DialogTitle>Tour freigeben</DialogTitle>
            <DialogDescription>Der Fahrer sieht die Tour sofort.</DialogDescription>
          </DialogContent>
        </Dialog>,
      ),
    );
    fireEvent.click(screen.getByText("Öffnen"));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("dialog-pop", "settle");
    expect(document.querySelector('[data-slot="dialog-overlay"]')).toHaveClass("overlay-fade");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("slides a bottom sheet on the vertical axis and a side sheet on the horizontal one", async () => {
    const { rerender } = render(
      withMessages(
        <Sheet open>
          <SheetContent side="bottom">
            <SheetTitle>Problem melden</SheetTitle>
            <SheetDescription>Was ist passiert?</SheetDescription>
          </SheetContent>
        </Sheet>,
      ),
    );
    expect(await screen.findByRole("dialog")).toHaveClass("sheet-y");
    rerender(
      withMessages(
        <Sheet open>
          <SheetContent side="left">
            <SheetTitle>Menü</SheetTitle>
            <SheetDescription>Navigation</SheetDescription>
          </SheetContent>
        </Sheet>,
      ),
    );
    const side = await screen.findByRole("dialog");
    expect(side).toHaveClass("sheet-x");
    expect(side.className).toContain("[--sheet-enter:-100%]");
  });
});

describe("Tabs", () => {
  it("moves one highlight to the tab the user picks", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Stopps</TabsTrigger>
          <TabsTrigger value="b">Karte</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Liste</TabsContent>
        <TabsContent value="b">Kartenansicht</TabsContent>
      </Tabs>,
    );
    const stops = screen.getByRole("tab", { name: "Stopps" });
    const map = screen.getByRole("tab", { name: "Karte" });
    expect(stops.querySelector('[data-slot="tabs-thumb"]')).not.toBeNull();
    expect(map.querySelector('[data-slot="tabs-thumb"]')).toBeNull();

    // Radix selects a tab on mousedown (and on focus), not on click.
    fireEvent.mouseDown(map, { button: 0 });
    expect(map).toHaveAttribute("aria-selected", "true");
    expect(document.querySelectorAll('[data-slot="tabs-thumb"]')).toHaveLength(1);
    expect(map.querySelector('[data-slot="tabs-thumb"]')).not.toBeNull();
    expect(screen.getByText("Kartenansicht")).toBeVisible();
  });

  it("follows a controlled value", () => {
    const { rerender } = render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">Stopps</TabsTrigger>
          <TabsTrigger value="b">Karte</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    rerender(
      <Tabs value="b">
        <TabsList>
          <TabsTrigger value="a">Stopps</TabsTrigger>
          <TabsTrigger value="b">Karte</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(
      screen.getByRole("tab", { name: "Karte" }).querySelector('[data-slot="tabs-thumb"]'),
    ).not.toBeNull();
  });
});

describe("Switch", () => {
  it("stretches its knob only after the user toggled it, and still reports the change", () => {
    const changes: boolean[] = [];
    render(<Switch aria-label="Aktiv" onCheckedChange={(checked) => changes.push(checked)} />);
    const toggle = screen.getByRole("switch", { name: "Aktiv" });
    expect(toggle.querySelector(".knob-stretch")).toBeNull();

    fireEvent.click(toggle);
    expect(changes).toEqual([true]);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle.querySelector(".knob-stretch")).not.toBeNull();
  });
});
