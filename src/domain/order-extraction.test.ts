import { describe, expect, it } from "vitest";

import { type AppLocale, createLocalizedText } from "@/lib/localized-text";

import {
  assembleDraft,
  buildExtractionPrompt,
  type CatalogProduct,
  extractionAnswerSchema,
  matchCustomer,
  matchProduct,
  normalizeLabel,
  unitHintFromLabel,
} from "./order-extraction";

const product = (
  id: string,
  names: Partial<Record<AppLocale, string>>,
  unit: CatalogProduct["unit"],
): CatalogProduct => ({
  id,
  name: createLocalizedText(names, "de"),
  unit,
});

/** The real catalog (NUD-138): two products share the German name "Nudeln" and differ by unit. */
const CATALOG: CatalogProduct[] = [
  product("pack", { de: "Nudeln", "zh-Hans": "面条", en: "Noodles" }, "PACK"),
  product("crate", { de: "Nudeln", "zh-Hans": "面条", en: "Noodles" }, "CRATE"),
  product("wantan", { de: "Wantan-Teig", "zh-Hans": "馄饨皮", en: "Wonton wrappers" }, "PIECE"),
];

const answer = (input: unknown) => extractionAnswerSchema.parse(input);

describe("normalizeLabel", () => {
  it("folds case, accents and punctuation", () => {
    expect(normalizeLabel("  Nudeln, Kiste!  ")).toBe("nudeln kiste");
    expect(normalizeLabel("Sáček")).toBe("sacek");
  });

  it("keeps Chinese characters", () => {
    expect(normalizeLabel("面条 箱")).toBe("面条 箱");
  });
});

describe("unitHintFromLabel", () => {
  it.each([
    ["2 Karton Nudeln", "CRATE"],
    ["5 Sackerl", "PACK"],
    ["5 Beutel Nudeln", "PACK"], // the old word still appears in customer messages
    ["3 纸箱 面条", "CRATE"],
    ["2 袋 面条", "PACK"],
    ["10 kg Nudeln", "KG"],
    ["4 Stück Wantan", "PIECE"],
  ])("reads the unit from %j", (label, unit) => {
    expect(unitHintFromLabel(label)).toBe(unit);
  });

  it("returns null when no unit is mentioned", () => {
    expect(unitHintFromLabel("Nudeln")).toBeNull();
  });
});

describe("matchProduct", () => {
  it("uses the unit to tell the two Nudeln products apart", () => {
    expect(matchProduct("2 Kiste Nudeln", CATALOG)?.productId).toBe("crate");
    expect(matchProduct("5 Sackerl Nudeln", CATALOG)?.productId).toBe("pack");
    expect(matchProduct("2 箱 面条", CATALOG)?.productId).toBe("crate");
  });

  it("matches by name in any locale", () => {
    expect(matchProduct("2 Wonton wrappers", CATALOG)?.productId).toBe("wantan");
    expect(matchProduct("3 馄饨皮", CATALOG)?.productId).toBe("wantan");
  });

  it("reports ambiguity instead of guessing when the unit is missing", () => {
    const match = matchProduct("3 Nudeln", CATALOG);
    expect(match?.ambiguous).toBe(true);
    expect(match?.candidates).toEqual(["pack", "crate"]);
  });

  it("prefers the product whose unit the message names", () => {
    const match = matchProduct("2 Kiste Nudeln", CATALOG);
    expect(match?.ambiguous).toBe(false);
    expect(match?.candidates[0]).toBe("crate");
  });

  it("returns null when no catalog name appears", () => {
    expect(matchProduct("2 Kartoffeln", CATALOG)).toBeNull();
    expect(matchProduct("", CATALOG)).toBeNull();
  });
});

describe("assembleDraft", () => {
  it("maps the acceptance example of NUD-150", () => {
    const draft = assembleDraft(
      answer({
        lines: [
          { label: "Nudeln Kiste", quantity: 2, confidence: 0.9 },
          { label: "Nudeln Sackerl", quantity: 5, confidence: 0.8 },
        ],
        window: {
          from: "2026-10-29",
          to: "2026-10-29",
          fromTime: "08:00",
          toTime: "12:00",
          confidence: 0.7,
        },
        confidence: 0.8,
      }),
      CATALOG,
    );
    expect(draft.lines).toEqual([
      { productId: "crate", quantity: "2", confidence: 0.9, label: "Nudeln Kiste" },
      { productId: "pack", quantity: "5", confidence: 0.8, label: "Nudeln Sackerl" },
    ]);
    expect(draft.window).toEqual({
      from: "2026-10-29",
      to: "2026-10-29",
      fromTime: "08:00",
      toTime: "12:00",
    });
    expect(draft.unmatched).toEqual([]);
    expect(draft.confidence).toBe(0.8);
  });

  it("merges two lines of the same product", () => {
    const draft = assembleDraft(
      answer({
        lines: [
          { label: "Nudeln Sackerl", quantity: 2, confidence: 0.9 },
          { label: "Nudeln Sackerl", quantity: 3, confidence: 0.5 },
        ],
      }),
      CATALOG,
    );
    expect(draft.lines).toEqual([
      { productId: "pack", quantity: "5", confidence: 0.5, label: "Nudeln Sackerl" },
    ]);
    // the weakest line decides, so one uncertain line is visible in the draft
    expect(draft.confidence).toBe(0.5);
  });

  it("keeps an unknown product out of the lines and reports it", () => {
    const draft = assembleDraft(
      answer({ lines: [{ label: "2 Kartoffeln", quantity: 2, confidence: 0.9 }] }),
      CATALOG,
    );
    expect(draft.lines).toEqual([]);
    expect(draft.unmatched).toEqual([
      { label: "2 Kartoffeln", quantity: 2, reason: "unknown_product", candidates: [] },
    ]);
    expect(draft.confidence).toBe(0);
  });

  it("reports an ambiguous product with its candidates", () => {
    const draft = assembleDraft(
      answer({ lines: [{ label: "3 Nudeln", quantity: 3, confidence: 0.9 }] }),
      CATALOG,
    );
    expect(draft.unmatched[0]?.reason).toBe("ambiguous_product");
    expect(draft.unmatched[0]?.candidates).toEqual(["pack", "crate"]);
  });

  it("drops an unusable window but keeps the lines", () => {
    const draft = assembleDraft(
      answer({
        lines: [{ label: "Nudeln Kiste", quantity: 1, confidence: 0.9 }],
        window: { from: "morgen", to: null, confidence: 0.9 },
      }),
      CATALOG,
    );
    expect(draft.window).toBeNull();
    expect(draft.windowConfidence).toBe(0);
    expect(draft.lines).toHaveLength(1);
  });

  it("keeps the lines when the model answers the window as words (measured live, 2026-10-28)", () => {
    // deepseek/deepseek-v4.1-flash-1017 answered `"window":"morgen vormittag"`; refusing the whole
    // answer over that would have thrown away a perfectly good draft.
    const draft = assembleDraft(
      answer({
        lines: [
          { label: "Nudeln Karton", quantity: 2, confidence: 0.9 },
          { label: "Nudeln Beutel", quantity: 5, confidence: 0.9 },
        ],
        window: "morgen vormittag",
        note: null,
        confidence: 0.85,
      }),
      CATALOG,
    );
    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["crate", "2"],
      ["pack", "5"],
    ]);
    expect(draft.window).toBeNull();
    expect(draft.windowNote).toBe("morgen vormittag");
    expect(draft.confidence).toBe(0.85);
  });

  it("keeps a note as it is and never turns it into a line", () => {
    const draft = assembleDraft(
      answer({ lines: [], note: "Bitte vor 10 Uhr", confidence: 0.4 }),
      CATALOG,
    );
    expect(draft.note).toBe("Bitte vor 10 Uhr");
    expect(draft.lines).toEqual([]);
  });
});

describe("buildExtractionPrompt", () => {
  const prompt = buildExtractionPrompt(CATALOG, "2026-10-28", "Europe/Vienna");

  it("names every catalog product with its unit and today's date", () => {
    expect(prompt).toContain("de: Nudeln");
    expect(prompt).toContain("zh-Hans: 馄饨皮");
    expect(prompt).toContain("unit: CRATE");
    expect(prompt).toContain("Today is 2026-10-28");
  });

  it("forbids the window as a plain string and asks for an object or null", () => {
    expect(prompt).toContain("never a string");
  });
});

describe("the sender's name (NUD-210)", () => {
  it("keeps the name the model read and accepts answers without one", () => {
    expect(answer({ lines: [], customer: "  Wok Palace  " }).customer).toBe("Wok Palace");
    expect(answer({ lines: [], customer: null }).customer).toBeNull();
    expect(answer({ lines: [] }).customer).toBeUndefined();
  });

  it("asks for the name as written and forbids guessing", () => {
    const prompt = buildExtractionPrompt(CATALOG, "2026-10-28", "Europe/Vienna");
    expect(prompt).toContain("`customer`");
    expect(prompt).toContain('"customer":"Wok Palace"');
  });
});

describe("matchCustomer", () => {
  const CUSTOMERS = [
    { id: "wok", name: "Wok Palace", companyName: "Wok Palace GmbH", abbreviation: "WOK" },
    { id: "lotus", name: "Lotus Garten", companyName: null, abbreviation: null },
    { id: "lotus2", name: "Lotus Garten Süd", companyName: null, abbreviation: null },
    { id: "long", name: "龙凤饭店", companyName: "Drachen & Phönix KG", abbreviation: null },
    { id: "li", name: "Li", companyName: null, abbreviation: null },
  ];

  it("finds a customer by its exact name, whatever the case and accents", () => {
    expect(matchCustomer("wok palace", CUSTOMERS)).toBe("wok");
    expect(matchCustomer("LOTUS GARTEN SUD", CUSTOMERS)).toBe("lotus2");
    expect(matchCustomer("龙凤饭店", CUSTOMERS)).toBe("long");
  });

  it("finds a customer by its company name or abbreviation", () => {
    expect(matchCustomer("Drachen & Phönix KG", CUSTOMERS)).toBe("long");
    expect(matchCustomer("WOK", CUSTOMERS)).toBe("wok");
  });

  it("accepts a name with extra words around it", () => {
    expect(matchCustomer("Wok Palace Küche (Hr. Chen)", CUSTOMERS)).toBe("wok");
    expect(matchCustomer("Bestellung 龙凤饭店 厨房", CUSTOMERS)).toBe("long");
  });

  it("prefers the exact name over a longer name that contains it", () => {
    expect(matchCustomer("Lotus Garten", CUSTOMERS)).toBe("lotus");
  });

  it("proposes nobody when two customers fit equally well", () => {
    const twins = [
      { id: "a", name: "Asia Imbiss", companyName: null, abbreviation: null },
      { id: "b", name: "Asia Imbiss", companyName: null, abbreviation: null },
    ];
    expect(matchCustomer("Asia Imbiss", twins)).toBeNull();
  });

  it("proposes nobody for an unknown, empty or too short name", () => {
    expect(matchCustomer("Pizzeria Roma", CUSTOMERS)).toBeNull();
    expect(matchCustomer("", CUSTOMERS)).toBeNull();
    expect(matchCustomer(null, CUSTOMERS)).toBeNull();
    // "Li" is a real customer, but two letters inside other words must not match ("Lieferung").
    expect(matchCustomer("Lieferung morgen", CUSTOMERS)).toBeNull();
    expect(matchCustomer("Li", CUSTOMERS)).toBe("li");
  });
});
