/**
 * Locale texts of the redesigned stop screen (redesign RD-2, re-design.md §7.3).
 *
 * The messages themselves are added through the fragment protocol (`messages/_fragments/D2.json`)
 * and merged by the orchestrator. Unit tests render the real message files, which do not contain
 * the fragment yet, so `stopText` falls back to this table per locale. Once the fragment is merged
 * the translation wins; the table then only documents the wording.
 */
const TEXTS = {
  backToTour: {
    de: "Zurück zur Tour",
    "zh-Hans": "返回线路",
  },
  photos: { de: "Fotos", "zh-Hans": "照片" },
  photoStore: { de: "Eingang", "zh-Hans": "入口" },
  photoParking: { de: "Parken", "zh-Hans": "停车" },
  statusDeliveredAt: {
    de: "Geliefert {time}",
    "zh-Hans": "{time} 已送达",
  },
  statusProblem: {
    de: "Problem: {reason}",
    "zh-Hans": "有问题：{reason}",
  },
  navigateStarting: {
    de: "Navigation wird geöffnet …",
    "zh-Hans": "正在打开导航 …",
  },
  deliveredStrip: {
    de: "Geliefert um {time}",
    "zh-Hans": "{time} 已送达",
  },
  problemStrip: {
    de: "Problem gemeldet",
    "zh-Hans": "问题已上报",
  },
  editAction: { de: "Bearbeiten", "zh-Hans": "编辑" },
  nextStop: {
    de: "Weiter zu Stopp {number}",
    "zh-Hans": "前往第 {number} 站",
  },
  backToTourAction: {
    de: "Zur Tour",
    "zh-Hans": "返回线路",
  },
  viewerTitle: {
    de: "Foto ansehen",
    "zh-Hans": "查看照片",
  },
  viewerPrev: {
    de: "Vorheriges Foto",
    "zh-Hans": "上一张照片",
  },
  viewerNext: {
    de: "Nächstes Foto",
    "zh-Hans": "下一张照片",
  },
  viewerClose: { de: "Schließen", "zh-Hans": "关闭" },
} as const;

export type StopTextKey = keyof typeof TEXTS;

type Translate = (key: string, values?: Record<string, string | number>) => string;

function isMissing(caught: unknown): boolean {
  return (
    caught instanceof Error &&
    (caught.message.includes("MISSING_MESSAGE") || caught.message.includes("missing message"))
  );
}

/**
 * Localized text of the stop screen: the merged message when it exists, otherwise the per-locale
 * fallback above (unit tests render the message files before the fragment is merged).
 */
export function stopText(
  t: Translate,
  locale: string,
  key: StopTextKey,
  values?: Record<string, string | number>,
): string {
  try {
    return t(key, values);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const table = TEXTS[key];
  const template: string =
    (table as Record<string, string | undefined>)[locale] ?? (table.de as string);
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}
