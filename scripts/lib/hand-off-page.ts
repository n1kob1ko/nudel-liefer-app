/**
 * HTML/CSS/JS builders for the bilingual hand-off help page (NUD-127), pure and unit-testable
 * (no I/O). `scripts/build-hand-off.ts` writes the four files into `public/`.
 *
 * Hard rules (docs/handoff-vserver-deploy-and-help.md section 7):
 * - The page is a static file, so the CSP branch for files allows `script-src 'self'` only: no inline
 *   `<script>`, no inline `style`, no `onclick`, no external fonts. Everything lives in
 *   `hand-off.css`, `hand-off-data.js` and `hand-off.js`, loaded with relative URLs (correct under
 *   `/delivery-app/` and at the root).
 * - All topics are rendered server-side in BOTH languages, so the page is complete without
 *   JavaScript; the search box and the language switch are the only enhancements.
 * - German UI labels are never translated: they are shown verbatim in a code span.
 */
import type {
  HandOffArea,
  HandOffContent,
  HandOffText,
  HandOffTopic,
} from "../../content/hand-off/types";

export const HAND_OFF_AREAS: { id: HandOffArea; de: string; zh: string }[] = [
  { id: "buero", de: "Büro (Admin)", zh: "办公室（管理端）" },
  { id: "fahrer", de: "Fahrer (App)", zh: "司机（App）" },
  { id: "konto", de: "Anmeldung & Konto", zh: "登录与账号" },
  { id: "system", de: "System & Fehler", zh: "系统与错误" },
  { id: "glossar", de: "Begriffe (Glossar)", zh: "术语表" },
];

const esc = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const text = (value: HandOffText, lang: "de" | "zh") => (lang === "de" ? value.de : value.zh);

/** Problems that must fail the build; an empty array means the content is shippable. */
export function handOffProblems(content: HandOffContent): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  for (const topic of content.topics) {
    const where = topic.id || "<missing id>";
    if (!kebab.test(topic.id)) problems.push(`${where}: id is not kebab-case`);
    if (ids.has(topic.id)) problems.push(`${where}: duplicate id`);
    ids.add(topic.id);
    for (const field of ["title", "summary", "path"] as const) {
      if (!topic[field]?.de?.trim()) problems.push(`${where}: empty ${field}.de`);
      if (!topic[field]?.zh?.trim()) problems.push(`${where}: empty ${field}.zh`);
    }
    if (topic.search.de.length === 0) problems.push(`${where}: empty search.de`);
    if (topic.search.zh.length === 0) problems.push(`${where}: empty search.zh`);
    if (topic.steps.length < 2 || topic.steps.length > 12)
      problems.push(`${where}: ${topic.steps.length} steps (must be 2..12)`);
    topic.steps.forEach((step, index) => {
      if (!step.text.de.trim()) problems.push(`${where}: step ${index + 1} has no German text`);
      if (!step.text.zh.trim()) problems.push(`${where}: step ${index + 1} has no Chinese text`);
    });
    if (!HAND_OFF_AREAS.some((area) => area.id === topic.area))
      problems.push(`${where}: unknown area "${topic.area}"`);
  }
  const matches = content.topics.filter((topic) =>
    [...topic.search.de, ...topic.search.zh].some(
      (term) => term.toLowerCase() === "waren typ hinzufügen",
    ),
  );
  if (matches.length !== 1)
    problems.push(
      `"waren typ hinzufügen" must resolve to exactly one topic (got ${matches.length})`,
    );
  return problems;
}

const stepHtml = (topic: HandOffTopic, lang: "de" | "zh") =>
  topic.steps
    .map((step) => {
      const label = step.label ? ` <span class="label">«${esc(step.label)}»</span>` : "";
      const result = step.result ? ` <span class="result">→ ${esc(step.result)}</span>` : "";
      return `<li>${esc(text(step.text, lang))}${label}${result}</li>`;
    })
    .join("\n            ");

/**
 * One article per topic, with a UNIQUE id, holding both languages inside it: an outer language
 * switch would duplicate every anchor, and `#topic-x` must work in either language.
 */
const topicHtml = (topic: HandOffTopic) => {
  const body = (lang: "de" | "zh") => `
          <div class="lang" data-lang="${lang}" lang="${lang === "de" ? "de" : "zh-Hans"}">
            <h3>${esc(text(topic.title, lang))}</h3>
            <p class="summary">${esc(text(topic.summary, lang))}</p>
            <p class="path"><span class="k">${lang === "de" ? "Weg" : "路径"}</span> <code>${esc(text(topic.path, lang))}</code></p>
            <ol>
            ${stepHtml(topic, lang)}
            </ol>
            ${topic.after ? `<p class="after"><span class="k">${lang === "de" ? "Danach" : "之后"}</span> ${esc(text(topic.after, lang))}</p>` : ""}
          </div>`;
  return `
        <article class="topic" id="topic-${esc(topic.id)}" data-area="${topic.area}">${body("de")}${body("zh")}
          <p class="route">${esc(topic.route ?? "")}</p>
        </article>`;
};

/** Navigation for one language: the grouped topic titles plus the glossary. */
function navigationSection(content: HandOffContent, lang: "de" | "zh"): string {
  const groups = HAND_OFF_AREAS.map((area) => {
    const topics = content.topics.filter((topic) => topic.area === area.id);
    if (topics.length === 0) return "";
    const items = topics
      .map(
        (topic) =>
          `<li><a href="#topic-${esc(topic.id)}" data-topic="${esc(topic.id)}">${esc(text(topic.title, lang))}</a><span class="one">${esc(text(topic.summary, lang))}</span></li>`,
      )
      .join("\n          ");
    return `
        <section class="group">
          <h3>${esc(lang === "de" ? area.de : area.zh)}</h3>
          <ul class="toc">
          ${items}
          </ul>
        </section>`;
  }).join("\n");

  const glossary =
    content.glossary.length > 0
      ? `
        <section class="group glossary">
          <h3>${lang === "de" ? "Glossar: Deutsch ↔ 简体中文" : "术语表：Deutsch ↔ 简体中文"}</h3>
          <table>
            <thead><tr><th>Deutsch</th><th>简体中文</th></tr></thead>
            <tbody>
${content.glossary.map((entry) => `              <tr><td>${esc(entry.de)}</td><td>${esc(entry.zh)}</td></tr>`).join("\n")}
            </tbody>
          </table>
        </section>`
      : "";

  return `
    <div class="lang nav" data-lang="${lang}" lang="${lang === "de" ? "de" : "zh-Hans"}">
      <p class="lead">${
        lang === "de"
          ? "Diese Hilfe beschreibt die App. Die chinesischen Texte werden noch von einem Muttersprachler geprüft."
          : "本帮助介绍本应用。中文文本尚待母语者校对。"
      }</p>
      <p class="hint">${
        lang === "de"
          ? "Oben tippen, um zu suchen (z. B. <code>waren typ hinzufügen</code>), oder unten ein Thema wählen."
          : "可在上方搜索（例如 <code>添加产品</code>），或在下方选择主题。"
      }</p>
      ${groups}
      ${glossary}
    </div>`;
}

export function handOffHtml(content: HandOffContent): string {
  const title = "Routenplanner – Hilfe / 帮助";
  const topics = content.topics.map(topicHtml).join("\n");
  return `<!doctype html>
<!-- GENERATED by scripts/build-hand-off.ts from content/hand-off/index.ts - do not edit by hand. -->
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="hand-off.css">
</head>
<body data-lang="de">
<header class="top">
  <h1>${esc(title)}</h1>
  <p class="sub">${
    content.topics.length
  } Themen / 个主题 · <a href="de/driver/login">Fahrer-App</a> · <a href="de/login">Büro</a></p>
  <div class="controls">
    <label for="q" class="sr">Suchen / 搜索</label>
    <input id="q" type="search" placeholder="Suchen… z. B. waren typ hinzufügen / 例如：添加产品" autocomplete="off">
    <div class="langs">
      <button type="button" data-setlang="de" class="active">Deutsch</button>
      <button type="button" data-setlang="zh">简体中文</button>
    </div>
  </div>
  <ul id="results" class="results" hidden></ul>
</header>
<main>
${navigationSection(content, "de")}
${navigationSection(content, "zh")}
  <section class="group" id="topics">
    <div class="lang" data-lang="de" lang="de"><h2>Alle Themen</h2></div>
    <div class="lang" data-lang="zh" lang="zh-Hans"><h2>全部主题</h2></div>
${topics}
  </section>
</main>
<footer class="foot">
  <p>${
    content.topics.length
  } Themen, ${content.glossary.length} Glossarbegriffe. Erzeugt aus <code>content/hand-off/index.ts</code>.</p>
</footer>
<script defer src="hand-off-data.js"></script>
<script defer src="hand-off.js"></script>
</body>
</html>
`;
}

/** `window.HANDOFF_INDEX` — data only, no behaviour. */
export function handOffData(content: HandOffContent): string {
  const index = content.topics.map((topic) => ({
    id: topic.id,
    area: topic.area,
    de: { title: topic.title.de, summary: topic.summary.de, terms: topic.search.de },
    zh: { title: topic.title.zh, summary: topic.summary.zh, terms: topic.search.zh },
  }));
  return `/* GENERATED by scripts/build-hand-off.ts - do not edit by hand. */\nwindow.HANDOFF_INDEX = ${JSON.stringify(index, null, 0)};\n`;
}

/** The search/language behaviour. Plain IIFE, no imports, no inline handlers (CSP). */
export function handOffScript(): string {
  return `/* GENERATED by scripts/build-hand-off.ts - do not edit by hand. */
(function () {
  var index = window.HANDOFF_INDEX || [];
  var body = document.body;
  var input = document.getElementById("q");
  var results = document.getElementById("results");
  var KEY = "handoff.lang";

  function setLang(lang, remember) {
    // Marks that the script runs: only then does the CSS hide the other language, so a browser
    // without JavaScript still shows every topic in German AND Chinese (section 7.3 item 5).
    body.setAttribute("data-js", "1");
    body.setAttribute("data-lang", lang);
    document.documentElement.setAttribute("lang", lang === "de" ? "de" : "zh-Hans");
    var buttons = document.querySelectorAll("[data-setlang]");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].className = buttons[i].getAttribute("data-setlang") === lang ? "active" : "";
    }
    if (remember) { try { localStorage.setItem(KEY, lang); } catch (e) {} }
    if (input) search(input.value);
  }

  function normalise(value) {
    return value.toLowerCase().replace(/\\u00e4/g, "a").replace(/\\u00f6/g, "o").replace(/\\u00fc/g, "u").replace(/\\u00df/g, "ss");
  }

  function search(query) {
    if (!results) return;
    var q = normalise(query.trim());
    if (q.length < 2) { results.hidden = true; results.innerHTML = ""; return; }
    var lang = body.getAttribute("data-lang") === "zh" ? "zh" : "de";
    var hits = [];
    for (var i = 0; i < index.length && hits.length < 20; i++) {
      var entry = index[i];
      // Search BOTH languages: a Chinese-speaking driver looks up a German word (and vice versa)
      // without having to switch the page language first. The hit is shown in the active language.
      var de = entry.de, zh = entry.zh;
      var haystack = normalise([de.title, de.summary, de.terms.join(" "), zh.title, zh.summary, zh.terms.join(" ")].join(" | "));
      if (haystack.indexOf(q) !== -1) hits.push(entry);
    }
    results.innerHTML = "";
    for (var j = 0; j < hits.length; j++) {
      var hit = hits[j];
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.setAttribute("href", "#topic-" + hit.id);
      a.setAttribute("data-topic", hit.id);
      a.textContent = hit[lang].title;
      li.appendChild(a);
      var span = document.createElement("span");
      span.className = "one";
      span.textContent = hit[lang].summary;
      li.appendChild(span);
      results.appendChild(li);
    }
    results.hidden = hits.length === 0;
  }

  document.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var wanted = target.getAttribute("data-setlang");
    if (wanted) { setLang(wanted, true); return; }
    var topic = target.getAttribute("data-topic");
    if (topic) {
      var article = document.getElementById("topic-" + topic);
      if (article) {
        if (results) results.hidden = true;
        if (input) input.value = "";
        article.setAttribute("tabindex", "-1");
        article.focus();
        article.scrollIntoView({ block: "start" });
      }
    }
  });

  if (input) input.addEventListener("input", function () { search(input.value); });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && results) { results.hidden = true; if (input) { input.value = ""; input.focus(); } }
  });

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  setLang(saved === "zh" ? "zh" : "de", false);
})();
`;
}

export function handOffCss(): string {
  return `/* GENERATED by scripts/build-hand-off.ts - do not edit by hand. */
:root { color-scheme: light dark; --primary: #2f6b4f; --line: #e5e7eb; }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #18181b; font: 16px/1.6 system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif; }
.top { border-bottom: 1px solid var(--line); padding: 16px; position: sticky; top: 0; background: inherit; }
h1 { margin: 0 0 4px; font-size: 24px; }
.sub { margin: 0 0 12px; color: #52525b; font-size: 14px; }
.sub a { color: var(--primary); }
.controls { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
#q { flex: 1 1 320px; min-height: 48px; padding: 0 12px; font-size: 16px; border: 1px solid var(--line); border-radius: 8px; }
.langs { display: flex; gap: 8px; }
.langs button { min-height: 48px; padding: 0 16px; font-size: 16px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; cursor: pointer; }
.langs button.active { border-color: var(--primary); color: var(--primary); font-weight: 600; }
.results { list-style: none; margin: 12px 0 0; padding: 0; }
.results li { padding: 8px 0; border-top: 1px solid var(--line); }
.results a { color: var(--primary); font-weight: 600; text-decoration: none; margin-right: 8px; }
.one { color: #52525b; font-size: 14px; }
main { padding: 16px; max-width: 980px; }
.group { margin: 0 0 28px; }
.group h3 { margin: 0 0 8px; font-size: 18px; }
main h2 { font-size: 20px; margin: 24px 0 8px; }
.hint { color: #52525b; font-size: 14px; }
.toc { list-style: none; margin: 0; padding: 0; }
.toc li { padding: 6px 0; border-top: 1px solid var(--line); }
.toc a { color: var(--primary); text-decoration: none; font-weight: 600; margin-right: 8px; }
.topic { border-top: 1px solid var(--line); padding: 16px 0; }
.topic h3 { margin: 0 0 4px; font-size: 17px; }
.topic .summary { margin: 0 0 8px; }
.topic .path, .topic .after { font-size: 14px; color: #3f3f46; }
.k { font-weight: 600; }
code { background: #f4f4f5; padding: 1px 4px; border-radius: 4px; font-size: 14px; }
.label, .result { white-space: nowrap; }
.topic ol { padding-left: 22px; }
.topic li { margin: 4px 0; }
.route { color: #71717a; font-size: 12px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; border-top: 1px solid var(--line); padding: 6px 8px; }
.lead { background: #fffbeb; border: 1px solid #fde68a; padding: 8px 12px; border-radius: 8px; font-size: 14px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
/* The other language is hidden only once the script runs (body[data-js]): without JavaScript the
   page shows every topic in German AND Chinese, which is the documented no-JS behaviour. */
body[data-js="1"][data-lang="de"] .lang[data-lang="zh"],
body[data-js="1"][data-lang="zh"] .lang[data-lang="de"] { display: none; }
.foot { padding: 16px; color: #71717a; font-size: 13px; border-top: 1px solid var(--line); }
@media print {
  .controls, .results, .foot { display: none; }
  /* A printed copy carries both languages. Same specificity as the hide rule, declared later. */
  body[data-js="1"][data-lang="de"] .lang[data-lang="de"],
  body[data-js="1"][data-lang="de"] .lang[data-lang="zh"],
  body[data-js="1"][data-lang="zh"] .lang[data-lang="de"],
  body[data-js="1"][data-lang="zh"] .lang[data-lang="zh"] { display: block; }
  .topic { break-inside: avoid; }
}
@media (prefers-color-scheme: dark) {
  body { background: #18181b; color: #e4e4e7; }
  code { background: #27272a; }
  .one, .sub, .foot { color: #a1a1aa; }
  .lead { background: #2a2107; border-color: #854d0e; }
}
`;
}
