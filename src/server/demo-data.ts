/**
 * Static data of the demo seed (`pnpm db:seed --demo`, NUD-060). All business names are invented;
 * the street addresses are real public addresses in Vienna. The coordinates are hand-picked
 * approximations of those addresses (street level, a few hundred metres at worst), good enough
 * for a demo - a real customer's pin has to be confirmed by the admin on the map (D9).
 */

import { CATALOG_SKUS } from "./product-catalog";

export const DEMO_DEPOT = {
  depotName: "Nudelfabrik Wien (Demo)",
  depotAddress: "Absberggasse 27, 1100 Wien",
  depotLat: 48.1745,
  depotLng: 16.3935,
} as const;

/** Marker in `Order.internalNote`: tells the seed which orders it created. */
export const DEMO_ORDER_NOTE = "Demo-Daten (db:seed --demo)";

export const DEMO_CUSTOMER_PREFIX = "D-";

export type DemoNote = { de: string; hans: string };

export type DemoCustomer = {
  number: string;
  name: string;
  street: string;
  postalCode: string;
  lat: number;
  lng: number;
  hours?: string;
  note?: DemoNote;
};

export const DEMO_CUSTOMERS: readonly DemoCustomer[] = [
  {
    number: "D-001",
    name: "Trattoria Il Gelso Nero",
    street: "Linke Wienzeile 4",
    postalCode: "1060",
    lat: 48.199,
    lng: 16.3633,
    hours: "Mo-Sa 6-10 Uhr",
  },
  {
    number: "D-002",
    name: "Osteria Zum Roten Hahn",
    street: "Mariahilfer Straße 85",
    postalCode: "1060",
    lat: 48.1963,
    lng: 16.3511,
    hours: "Mo-Fr 7-11 Uhr",
    note: {
      de: "Hintereingang über den Hof, bitte klingeln.",
      hans: "请走院子里的后门，并按门铃。",
    },
  },
  {
    number: "D-003",
    name: "Ristorante La Bottega Bianca",
    street: "Kärntner Straße 51",
    postalCode: "1010",
    lat: 48.2033,
    lng: 16.3697,
    hours: "Mo-Sa 6-9 Uhr",
  },
  {
    number: "D-004",
    name: "Gasthaus Goldener Schlüssel",
    street: "Graben 21",
    postalCode: "1010",
    lat: 48.2085,
    lng: 16.3706,
    hours: "Mo-Fr 6-10 Uhr",
    note: { de: "Fußgängerzone: Lieferung nur bis 10 Uhr.", hans: "步行区：只能在10点前送货。" },
  },
  {
    number: "D-005",
    name: "Café Piccolo Mondo",
    street: "Rotenturmstraße 19",
    postalCode: "1010",
    lat: 48.2102,
    lng: 16.373,
  },
  {
    number: "D-006",
    name: "Pizzeria Da Luca e Sofia",
    street: "Schottenring 24",
    postalCode: "1010",
    lat: 48.2155,
    lng: 16.3647,
    hours: "Mo-Sa 8-12 Uhr",
  },
  {
    number: "D-007",
    name: "Bistro Zur Alten Mühle",
    street: "Josefstädter Straße 39",
    postalCode: "1080",
    lat: 48.2092,
    lng: 16.3441,
  },
  {
    number: "D-008",
    name: "Trattoria Nonna Rosa",
    street: "Alser Straße 4",
    postalCode: "1090",
    lat: 48.2147,
    lng: 16.3478,
    hours: "Di-Sa 7-11 Uhr",
  },
  {
    number: "D-009",
    name: "Restaurant Jadegarten",
    street: "Währinger Straße 20",
    postalCode: "1090",
    lat: 48.2185,
    lng: 16.36,
    hours: "täglich 8-11 Uhr",
    note: {
      de: "Ware bitte direkt in die Küche im Keller tragen.",
      hans: "请把货直接送到地下室的厨房。",
    },
  },
  {
    number: "D-010",
    name: "Ristorante Il Girasole",
    street: "Praterstraße 38",
    postalCode: "1020",
    lat: 48.2157,
    lng: 16.3856,
  },
  {
    number: "D-011",
    name: "Gasthaus Zum Schwarzen Adler",
    street: "Taborstraße 24",
    postalCode: "1020",
    lat: 48.2155,
    lng: 16.3796,
    hours: "Mo-Fr 6-10 Uhr",
  },
  {
    number: "D-012",
    name: "Pasta e Basta",
    street: "Landstraßer Hauptstraße 71",
    postalCode: "1030",
    lat: 48.2053,
    lng: 16.3935,
  },
  {
    number: "D-013",
    name: "Osteria Del Ponte",
    street: "Favoritenstraße 114",
    postalCode: "1100",
    lat: 48.1805,
    lng: 16.369,
    hours: "Mo-Sa 7-10 Uhr",
    note: { de: "Bitte die Lieferung an Herrn Rossi übergeben.", hans: "请把货交给罗西先生。" },
  },
  {
    number: "D-014",
    name: "Cucina Bella Napoli",
    street: "Meidlinger Hauptstraße 30",
    postalCode: "1120",
    lat: 48.1785,
    lng: 16.3315,
  },
  {
    number: "D-015",
    name: "Restaurant Himmelblau",
    street: "Wiedner Hauptstraße 60",
    postalCode: "1040",
    lat: 48.1925,
    lng: 16.3681,
    hours: "Mo-Fr 8-11 Uhr",
  },
  {
    number: "D-016",
    name: "Trattoria Santa Lucia",
    street: "Neubaugasse 25",
    postalCode: "1070",
    lat: 48.2025,
    lng: 16.3492,
  },
  {
    number: "D-017",
    name: "Beisl Zum Grünen Baum",
    street: "Burggasse 70",
    postalCode: "1070",
    lat: 48.205,
    lng: 16.34,
    note: { de: "Parken nur in der Ladezone vor dem Haus.", hans: "只能停在房子前面的装卸区。" },
  },
  {
    number: "D-018",
    name: "Ristorante Villa Toscana",
    street: "Ottakringer Straße 45",
    postalCode: "1160",
    lat: 48.2112,
    lng: 16.3182,
    hours: "Mo-Sa 7-10 Uhr",
  },
  {
    number: "D-019",
    name: "Gasthof Weinviertler Stube",
    street: "Hernalser Hauptstraße 55",
    postalCode: "1170",
    lat: 48.2178,
    lng: 16.3303,
  },
  {
    number: "D-020",
    name: "Mensa Pasta Fresca",
    street: "Simmeringer Hauptstraße 60",
    postalCode: "1110",
    lat: 48.1783,
    lng: 16.4027,
    hours: "Mo-Fr 6-9 Uhr",
  },
];

/** SKUs of the three catalog products (NUD-138), in display order. */
export const DEMO_PRODUCT_SKUS = CATALOG_SKUS;

/**
 * Deterministic order lines for the customer at `index` (0-based): 1-3 distinct products.
 * Quantities are whole numbers (D23), 1-6.
 */
export function demoOrderLines(index: number): { sku: string; quantity: number }[] {
  const count = 1 + (index % 3);
  return Array.from({ length: count }, (_, k) => {
    const sku = DEMO_PRODUCT_SKUS[(index + k) % DEMO_PRODUCT_SKUS.length]!;
    return { sku, quantity: ((index + k * 2) % 6) + 1 };
  });
}

/**
 * Demo prices per SKU in euro cents (D33, NUD-196). Only the demo has prices — the real catalog has
 * none, the office types the amount of an order. Chosen so a demo bill has readable numbers.
 */
export const DEMO_PRICES: Record<string, number> = {
  "NUDELN-BEUTEL": 990,
  "NUDELN-KARTON": 2900,
  "WANTAN-TEIG": 1250,
};

/** Every fifth demo customer pays cash on delivery; the rest is on the monthly bill (D33). */
export function demoPaymentTerm(index: number): "MONTHLY" | "ON_DELIVERY" {
  return index % 5 === 0 ? "ON_DELIVERY" : "MONTHLY";
}

/** Two demo vehicles (NUD-146): the capacities are placeholders, the owner enters the real fleet. */
export const DEMO_VEHICLES = [
  { name: "Transporter 1", plate: "W-12345A", capacityKg: 800 },
  { name: "Transporter 2", plate: "W-67890B", capacityKg: 1200 },
] as const;

/**
 * Two standing tours for the day plan (NUD-194, D32): fixed groups of demo customers with a demo
 * driver, `from`/`to` are 1-based indexes into `DEMO_CUSTOMERS`. D-015 .. D-020 deliberately belong
 * to no group, so the off-route list at the bottom of the page has content in the demo.
 */
export const DEMO_STANDING_TOURS = [
  { name: "Stammtour 1", driverUsername: "fahrer-de", from: 1, to: 8 },
  { name: "Stammtour 2", driverUsername: "driver-en", from: 9, to: 14 },
] as const;
