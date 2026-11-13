import fs from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

/**
 * Checks shared by the driver usability specs (NUD-095).
 *  - `axeAudit`: axe-core on the visible page; serious / critical findings are returned (all
 *    findings are written to the test output so that moderate ones can be reviewed).
 *  - `layoutAudit`: the driver rules of backlog 4.3 measured in the browser (touch targets >= 48 px,
 *    text >= 16 px, quantities >= 28 px bold, no horizontal scroll).
 */
/**
 * Lets CSS transitions / animations (sheet, toast, button colours, rows that rise in) finish: axe
 * reads mid-fade colours. One look is not enough: content that streams in is revealed up to 300 ms
 * after the page, and its entrance starts only then. So this waits until two looks in a row, 150 ms
 * apart, find nothing moving.
 */
export async function settle(page: Page) {
  let quiet = 0;
  for (let round = 0; round < 20 && quiet < 2; round++) {
    await page.waitForTimeout(150);
    const moving = await page
      .evaluate(async () => {
        const running = document
          .getAnimations()
          .filter(
            (a) => a.effect?.getTiming().iterations !== Infinity && a.playState !== "finished",
          );
        await Promise.all(running.map((a) => a.finished.catch(() => {})));
        return running.length;
      })
      .catch(() => 0);
    quiet = moving === 0 ? quiet + 1 : 0;
  }
}

export type AxeFinding = {
  screen: string;
  id: string;
  impact: string;
  help: string;
  nodes: string[];
};

export async function axeAudit(page: Page, screen: string, info: TestInfo): Promise<AxeFinding[]> {
  await settle(page);
  const result = await new AxeBuilder({ page }).analyze();
  const all = result.violations.map((v) => ({
    screen,
    id: v.id,
    impact: v.impact ?? "minor",
    help: v.help,
    nodes: v.nodes.map((n) => `${n.target.join(" ")} :: ${n.failureSummary?.split("\n")[1] ?? ""}`),
  }));
  if (all.length) {
    const file = info.outputPath(`axe-${screen.replace(/[^a-z0-9-]+/gi, "_")}.json`);
    fs.writeFileSync(file, JSON.stringify(all, null, 2));
    console.log(
      `AXE ${screen}: ${all.map((v) => `${v.impact}:${v.id}(${v.nodes.length})`).join(" ")}`,
    );
  }
  return all.filter((v) => v.impact === "serious" || v.impact === "critical");
}

export type LayoutFinding = { screen: string; kind: string; detail: string };

export async function layoutAudit(page: Page, screen: string): Promise<LayoutFinding[]> {
  await settle(page);
  const found = await page.evaluate(() => {
    const out: { kind: string; detail: string }[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth) {
      out.push({ kind: "hscroll", detail: `${doc.scrollWidth} > ${doc.clientWidth}` });
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    const label = (el: Element) =>
      `${el.tagName.toLowerCase()}${el.getAttribute("data-testid") ? `[${el.getAttribute("data-testid")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
    // Touch targets. A native <select> / <input> is measured as is; links inside running text
    // (none in the driver UI) would be exempt.
    const targets = document.querySelectorAll(
      "a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], summary",
    );
    for (const el of targets) {
      if (!visible(el) || (el as HTMLElement).closest("[aria-hidden=true], [hidden], [inert]"))
        continue;
      if ((el as HTMLButtonElement).disabled && el.tagName === "BUTTON") continue;
      // Visually hidden <input type=file>: the visible button in front of it is the target.
      if (el instanceof HTMLInputElement && el.type === "file") continue;
      if (
        el.closest(
          "nextjs-portal, [data-nextjs-toast], [data-nextjs-dev-tools-button], .leaflet-control-attribution",
        )
      )
        continue;
      const r = el.getBoundingClientRect();
      if (r.height < 47.5 || r.width < 47.5) {
        out.push({
          kind: "target",
          detail: `${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        });
      }
    }
    // Text size: every visible text node's parent must compute to >= 16 px.
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? "").trim()) continue;
      seen.add(el);
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      // The map credit line (OSM / Leaflet attribution) is legally required secondary text: exempt.
      if (
        !visible(el) ||
        el.closest(
          "nextjs-portal, [aria-hidden=true], [data-nextjs-toast], .leaflet-control-attribution",
        )
      )
        continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 15.99) out.push({ kind: "text", detail: `${size}px ${label(el)}` });
    }
    // Quantities: >= 28 px and bold.
    for (const el of document.querySelectorAll(
      "[data-testid=item-quantity] strong, [data-testid=summary-total] strong",
    )) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      if (parseFloat(s.fontSize) < 27.99 || Number(s.fontWeight) < 700) {
        out.push({ kind: "quantity", detail: `${s.fontSize}/${s.fontWeight} ${label(el)}` });
      }
    }
    return out;
  });
  return found.map((f) => ({ screen, ...f }));
}
