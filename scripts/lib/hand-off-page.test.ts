import { describe, expect, it } from "vitest";

import type { HandOffContent, HandOffTopic } from "../../content/hand-off/types";
import {
  handOffCss,
  handOffData,
  handOffHtml,
  handOffProblems,
  handOffScript,
} from "./hand-off-page";

const topic = (extra: Partial<HandOffTopic> = {}): HandOffTopic => ({
  id: "produkt-anlegen",
  area: "buero",
  title: { de: "Produkt anlegen", zh: "新建产品" },
  summary: { de: "Neue Nudelsorte erfassen.", zh: "录入新的产品。" },
  path: { de: "Seitenleiste → Stammdaten → Produkte", zh: "侧边栏 → 基础数据 → 产品" },
  search: { de: ["waren typ hinzufügen"], zh: ["添加产品"] },
  steps: [
    { text: { de: "Produkte öffnen.", zh: "打开产品。" }, label: "Produkte" },
    {
      text: { de: "Neues Produkt anlegen.", zh: "新建产品。" },
      label: "Neues Produkt",
      result: "Produkt angelegt.",
    },
  ],
  after: { de: "Danach ist es sofort bestellbar.", zh: "之后即可下单。" },
  route: "/de/admin/products/new",
  ...extra,
});

const content = (topics: HandOffTopic[]): HandOffContent => ({
  topics,
  glossary: [{ de: "Produkt", zh: "产品" }],
});

describe("handOffProblems", () => {
  it("accepts a complete topic", () => {
    expect(handOffProblems(content([topic()]))).toEqual([]);
  });

  it("rejects an empty field, a duplicate id, too few steps and an unmatched acceptance phrase", () => {
    const problems = handOffProblems(
      content([
        topic({ summary: { de: "", zh: "x" } }),
        topic({ id: "produkt-anlegen" }),
        topic({ id: "step-poor", steps: [topic().steps[0]!], search: { de: ["x"], zh: ["y"] } }),
      ]),
    );
    expect(problems.some((p) => p.includes("empty summary.de"))).toBe(true);
    expect(problems.some((p) => p.includes("duplicate id"))).toBe(true);
    expect(problems.some((p) => p.includes("must be 2..12"))).toBe(true);
    expect(problems.some((p) => p.includes("waren typ hinzufügen"))).toBe(true);
  });

  it("rejects an id that is not kebab-case and an unknown area", () => {
    const problems = handOffProblems(
      content([topic({ id: "Produkt Anlegen", area: "nope" as HandOffTopic["area"] })]),
    );
    expect(problems.some((p) => p.includes("kebab-case"))).toBe(true);
    expect(problems.some((p) => p.includes("unknown area"))).toBe(true);
  });
});

describe("handOffHtml", () => {
  const html = handOffHtml(content([topic(), topic({ id: "fahrer-foto", area: "fahrer" })]));

  it("renders every topic in both languages, so the page works without JavaScript", () => {
    expect(html).toContain('<div class="lang" data-lang="de" lang="de">');
    expect(html).toContain('data-lang="zh" lang="zh-Hans"');
    expect(html.match(/id="topic-produkt-anlegen"/g)).toHaveLength(1);
    expect(html.match(/produkt-anlegen/g)!.length).toBeGreaterThan(2);
    expect(html).toContain("新建产品");
    expect(html).toContain("Produkt anlegen");
  });

  it("loads external assets with relative URLs and contains no inline script or handler", () => {
    expect(html).toContain('href="hand-off.css"');
    expect(html).toContain('src="hand-off-data.js"');
    expect(html).toContain('src="hand-off.js"');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/<style/);
  });

  it("shows the exact German UI label verbatim and escapes it", () => {
    expect(html).toContain("«Neues Produkt»");
    const escaped = handOffHtml(content([topic({ title: { de: "a < b & c", zh: "x" } })]));
    expect(escaped).toContain("a &lt; b &amp; c");
  });

  it("carries the honesty banner about the unreviewed Chinese texts", () => {
    expect(html).toContain("noch von einem Muttersprachler geprüft");
  });
});

describe("the generated data and behaviour files", () => {
  it("expose the index as data and keep the behaviour free of inline handlers", () => {
    const data = handOffData(content([topic()]));
    expect(data).toContain("window.HANDOFF_INDEX = ");
    expect(JSON.parse(data.slice(data.indexOf("= ") + 2, data.lastIndexOf(";")))).toEqual([
      {
        id: "produkt-anlegen",
        area: "buero",
        de: {
          title: "Produkt anlegen",
          summary: "Neue Nudelsorte erfassen.",
          terms: ["waren typ hinzufügen"],
        },
        zh: { title: "新建产品", summary: "录入新的产品。", terms: ["添加产品"] },
      },
    ]);
    const script = handOffScript();
    expect(script).not.toMatch(/\son[a-z]+=/i);
    expect(script).toContain("handoff.lang");
  });

  it("hides the inactive language only when the script runs, and keeps both when printing", () => {
    const css = handOffCss();
    // Progressive enhancement: without JavaScript (no data-js) both languages stay visible.
    expect(css).toContain('body[data-js="1"][data-lang="de"] .lang[data-lang="zh"]');
    expect(css).toContain("@media print");
    expect(handOffScript()).toContain('setAttribute("data-js", "1")');
    // Redesign RD2: links are ink with a yolk underline; yolk is never a text colour on white.
    expect(css).toContain("--primary: #15171a");
    expect(css).toContain("--mark: #ffc72c");
  });
});
