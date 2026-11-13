import type { HandOffContent } from "./types";

/**
 * Single source of truth of the bilingual hand-off help page.
 *
 * Every `label` and `result` string is an exact German UI string from `messages/de.json`; the test
 * in this folder fails if one of them is not found there. The Chinese prose is Simplified Chinese
 * (zh-Hans) and reuses the app's own wording from `messages/zh-Hans.json` where the term exists.
 *
 * Coverage follows docs/handoff-vserver-deploy-and-help.md §8.1 (all 50 numbered topics) plus the
 * "Diese Funktionen gibt es nicht" page of §12.
 */
export const HAND_OFF: HandOffContent = {
  topics: [
    // ── Büro ──────────────────────────────────────────────────────────────────────────────────
    {
      id: "produkt-anlegen",
      area: "buero",
      title: { de: "Produkt anlegen (Nudelsorte)", zh: "新建产品（面条品种）" },
      summary: {
        de: "Eine neue Nudelsorte mit Artikelnummer, Einheit und Namen anlegen.",
        zh: "创建新的面条品种，填写货号、单位和名称。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Produkte → «Neues Produkt»",
        zh: "侧边栏 → 基础数据 → 产品 →「新建产品」",
      },
      search: {
        de: [
          "waren typ hinzufügen",
          "waren-typ",
          "warentyp",
          "produkt anlegen",
          "produkt hinzufügen",
          "neues produkt",
          "nudelsorte",
          "neuer artikel",
          "artikel anlegen",
          "sku",
          "artikelnummer",
        ],
        zh: ["添加产品", "新建产品", "货号", "sku", "面条品种", "新产品"],
      },
      steps: [
        {
          text: {
            de: "Die Seitenleiste öffnen und unter «Stammdaten» den Eintrag «Produkte» wählen.",
            zh: "打开侧边栏，在「基础数据」下选择「产品」。",
          },
          label: "Produkte",
        },
        {
          text: {
            de: "Oben rechts auf «Neues Produkt» klicken.",
            zh: "点击右上角的「新建产品」。",
          },
          label: "Neues Produkt",
        },
        {
          text: {
            de: "Im Abschnitt «Stammdaten» die «Artikelnummer (SKU)» eintragen: Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich — sie muss eindeutig sein.",
            zh: "在「基本信息」中填写「货号（SKU）」：可使用字母、数字、点、连字符和下划线，必须唯一。",
          },
          label: "Artikelnummer (SKU)",
        },
        {
          text: {
            de: "Die «Einheit» wählen: kg, Sackerl, Kiste oder Stück.",
            zh: "选择「单位」：公斤、袋、纸箱或件。",
          },
          label: "Einheit",
        },
        {
          text: {
            de: "Unter «Namen» den «Name (Deutsch)» eintragen.",
            zh: "在「名称」下填写「名称（德语）」。",
          },
          label: "Name (Deutsch)",
        },
        {
          text: {
            de: "Im Feld «Name (vereinfachtes Chinesisch)» den chinesischen Namen eintragen. Das ist ein Pflichtfeld.",
            zh: "在「名称（简体中文）」中填写中文名称，这是必填项。",
          },
          label: "Name (vereinfachtes Chinesisch)",
        },
        {
          text: {
            de: "Auf «Anlegen» klicken.",
            zh: "点击「新建」。",
          },
          label: "Anlegen",
          result: "Produkt angelegt.",
        },
      ],
      after: {
        de: "Die Namen auf Englisch, Serbisch und Tschechisch werden beim Speichern automatisch übersetzt (Kennzeichnung «automatisch») und können von Hand geändert werden. Die App nennt die Sorte «Produkt» — einen «Waren-Typ» gibt es nicht.",
        zh: "英语、塞尔维亚语和捷克语名称会在保存时自动翻译（标记为「自动」），也可以自行修改。应用里称它为「产品」，并没有「Waren-Typ」这个说法。",
      },
      route: "/de/admin/products/new",
    },
    {
      id: "produkt-namen-bearbeiten",
      area: "buero",
      title: { de: "Produkt bearbeiten und Namen pflegen", zh: "编辑产品并维护名称" },
      summary: {
        de: "Ein Produkt öffnen, den Namen auf vereinfachtem Chinesisch ändern und die übersetzten Namen neu erzeugen.",
        zh: "打开产品，修改简体中文名称，并重新生成翻译后的名称。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Produkte → Zeile «Bearbeiten»",
        zh: "侧边栏 → 基础数据 → 产品 → 该行的「编辑」",
      },
      search: {
        de: [
          "produkt bearbeiten",
          "namen ändern",
          "übersetzte namen",
          "übersetzen",
          "neu übersetzen",
          "vereinfachtes chinesisch",
          "produkt umbenennen",
        ],
        zh: ["编辑产品", "修改名称", "翻译名称", "简体中文", "重新生成"],
      },
      steps: [
        {
          text: {
            de: "Unter «Produkte» in der Zeile des Produkts «Bearbeiten» wählen.",
            zh: "在「产品」列表中，点击该产品一行的「编辑」。",
          },
          label: "Bearbeiten",
        },
        {
          text: {
            de: "Den «Name (Deutsch)» oder den «Name (vereinfachtes Chinesisch)» ändern.",
            zh: "修改「名称（德语）」或「名称（简体中文）」。",
          },
          label: "Name (vereinfachtes Chinesisch)",
        },
        {
          text: {
            de: "Die Namen auf Englisch, Serbisch und Tschechisch tragen die Kennzeichnung «automatisch».",
            zh: "英语、塞尔维亚语和捷克语名称带有「自动」标记。",
          },
          label: "automatisch",
        },
        {
          text: {
            de: "Mit «Neu aus dem deutschen Namen übersetzen» den Namen in dieser Sprache neu erzeugen.",
            zh: "点击「根据德语名称重新翻译」，重新生成该语言的名称。",
          },
          label: "Neu aus dem deutschen Namen übersetzen",
        },
        {
          text: {
            de: "Mit «Speichern» sichern.",
            zh: "点击「保存」。",
          },
          label: "Speichern",
          result: "Produkt gespeichert.",
        },
      ],
      after: {
        de: "Der Name auf vereinfachtem Chinesisch ist Pflicht; die übersetzten Namen sind Vorschläge und dürfen von Hand geändert werden.",
        zh: "简体中文名称为必填；翻译后的名称只是建议，可以手动修改。",
      },
      route: "/de/admin/products",
    },
    {
      id: "produkt-status-reihenfolge",
      area: "buero",
      title: {
        de: "Produkt deaktivieren, aktivieren und sortieren",
        zh: "停用、启用产品并调整排序",
      },
      summary: {
        de: "Ein Produkt aus der Bestellauswahl nehmen oder wieder aufnehmen und seine Reihenfolge ändern.",
        zh: "将产品从订单选择中移除或恢复，并调整它的顺序。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Produkte → Spalte «Reihenfolge» / Zeilenmenü",
        zh: "侧边栏 → 基础数据 → 产品 →「排序」列 / 行菜单",
      },
      search: {
        de: [
          "produkt deaktivieren",
          "produkt aktivieren",
          "reihenfolge",
          "nach oben",
          "nach unten",
          "sortieren",
          "produkt inaktiv",
        ],
        zh: ["停用产品", "启用产品", "排序", "上移", "下移"],
      },
      steps: [
        {
          text: {
            de: "Unter «Produkte» in der Spalte «Reihenfolge» «nach oben» oder «nach unten» klicken.",
            zh: "在「产品」的「排序」列中点击「上移」或「下移」。",
          },
          label: "nach oben",
        },
        {
          text: {
            de: "Im Zeilenmenü «Deaktivieren» wählen.",
            zh: "在行菜单中选择「停用」。",
          },
          label: "Deaktivieren",
          result: "Produkt deaktiviert. Es erscheint nicht mehr bei neuen Bestellungen.",
        },
        {
          text: {
            de: "Zum Wiederaufnehmen im Zeilenmenü «Aktivieren» wählen.",
            zh: "要重新启用，在行菜单中选择「启用」。",
          },
          label: "Aktivieren",
          result: "Produkt wieder aktiviert.",
        },
      ],
      after: {
        de: "Deaktivierte Produkte bleiben gespeichert und bestehen in alten Bestellungen weiter. Die Reihenfolge gilt auch in der Produktauswahl bei der Bestellung.",
        zh: "停用的产品仍会保留，旧订单中依然存在。此顺序也用于下订单时的产品选择列表。",
      },
      route: "/de/admin/products",
    },
    {
      id: "kunde-anlegen",
      area: "buero",
      title: { de: "Kunde anlegen", zh: "新增客户" },
      summary: {
        de: "Einen neuen Kunden mit Nummer, Name, Lieferadresse erfassen.",
        zh: "创建新客户，填写编号、名称和送货地址。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Kunden → «Neuer Kunde»",
        zh: "侧边栏 → 基础数据 → 客户 →「新增客户」",
      },
      search: {
        de: [
          "kunde anlegen",
          "neuer kunde",
          "kunden anlegen",
          "kunde erstellen",
          "kundennummer",
          "adresse erfassen",
        ],
        zh: ["新增客户", "创建客户", "客户编号", "送货地址"],
      },
      steps: [
        {
          text: {
            de: "Unter «Kunden» oben rechts «Neuer Kunde» klicken.",
            zh: "在「客户」页面点击右上角的「新增客户」。",
          },
          label: "Neuer Kunde",
        },
        {
          text: {
            de: "Im Abschnitt «Stammdaten» die «Kundennummer» eintragen; vorgeschlagen wird die nächste freie Nummer.",
            zh: "在「基本资料」中填写「客户编号」，系统会建议下一个可用编号。",
          },
          label: "Kundennummer",
        },
        {
          text: {
            de: "Den «Name» des Geschäfts eintragen, so wie er am Schild steht. Er wird nicht übersetzt.",
            zh: "填写店铺「名称」，与招牌一致。名称不会被翻译。",
          },
          label: "Name",
        },
        {
          text: {
            de: "«Straße und Hausnummer», «PLZ», «Ort» und «Land» ausfüllen — das Land ist ein Kürzel mit zwei Buchstaben, z. B. AT.",
            zh: "填写「街道和门牌号」「邮编」「城市」和「国家」——国家为两个字母的代码，例如 AT。",
          },
          label: "Straße und Hausnummer",
        },
        {
          text: {
            de: "«Lieferzeiten (Information)» und «Hinweise für den Fahrer» sind freiwillig.",
            zh: "「送货时间（仅供参考）」和「给司机的备注」可以不填。",
          },
          label: "Hinweise für den Fahrer",
        },
        {
          text: {
            de: "Auf «Kunde anlegen» klicken.",
            zh: "点击「创建客户」。",
          },
          label: "Kunde anlegen",
          result: "Kunde angelegt.",
        },
      ],
      after: {
        de: "Der Hinweis für den Fahrer wird später in die Fahrersprachen übersetzt. Der Adresspunkt wird beim Speichern automatisch aus der Adresse ermittelt; den Parkplatz legst du danach fest.",
        zh: "给司机的备注稍后会翻译成司机使用的语言。保存时会根据地址自动确定地址点；停车位在之后设置。",
      },
      route: "/de/admin/customers/new",
    },
    {
      id: "kartenpunkt-setzen-und-bestaetigen",
      area: "buero",
      title: { de: "Parkplatz festlegen", zh: "设置停车位" },
      summary: {
        de: "Den Parkplatz eines Kunden auf der Karte setzen, damit Tour und Navigation dorthin führen.",
        zh: "在地图上设置客户的停车位，路线和导航就会前往该处。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Kunden → Kunde öffnen → «Parkplätze»",
        zh: "侧边栏 → 基础数据 → 客户 → 打开客户 →「停车位」",
      },
      search: {
        de: [
          "parkplatz",
          "parkplatz festlegen",
          "karte",
          "navigation",
          "lieferadresse",
          "adresspunkt",
        ],
        zh: ["停车位", "设置停车位", "地址点", "导航"],
      },
      steps: [
        {
          text: {
            de: "Auf der Kundenseite im Abschnitt «Parkplätze» auf «Parkplatz hinzufügen» klicken.",
            zh: "在客户页面的「停车位」部分点击「添加停车位」。",
          },
          label: "Parkplatz hinzufügen",
        },
        {
          text: {
            de: "Auf die Karte klicken oder den Marker auf den Parkplatz ziehen. Die Karte startet an der Lieferadresse.",
            zh: "点击地图，或把标记拖到停车位上。地图从送货地址开始显示。",
          },
        },
        {
          text: {
            de: "Optional eine «Bezeichnung» und einen «Hinweis» eintragen, z. B. «Hof» oder «Einfahrt links».",
            zh: "可选：填写「名称」和「备注」，例如「院子」或「入口在左侧」。",
          },
          label: "Bezeichnung",
        },
        {
          text: {
            de: "Mit «Speichern» sichern.",
            zh: "点击「保存」。",
          },
          label: "Speichern",
          result: "Parkplatz gespeichert.",
        },
      ],
      after: {
        de: "Der erste Parkplatz ist der Standard: Touren und Navigation führen dorthin. Ohne Parkplatz wird die Lieferadresse angefahren; der Kunde bleibt trotzdem in der Tour.",
        zh: "第一个停车位为默认停车位：路线和导航都会前往该处。没有停车位时前往送货地址，客户仍然会出现在路线中。",
      },
      route: "/de/admin/customers",
    },
    {
      id: "kundenfotos",
      area: "buero",
      title: { de: "Kundenfotos hochladen oder ersetzen", zh: "上传或更换客户照片" },
      summary: {
        de: "Fotos von Eingang und Parkplatz hinterlegen, damit der Fahrer das Geschäft findet.",
        zh: "上传入口和停车位的照片，方便司机找到店铺。",
      },
      path: {
        de: "Kunden → Kunde öffnen → Abschnitt «Fotos»",
        zh: "客户 → 打开客户 →「照片」部分",
      },
      search: {
        de: [
          "foto hochladen",
          "bild",
          "eingang",
          "parken",
          "kundenfoto",
          "foto ersetzen",
          "geschäft",
          "bild auswählen",
        ],
        zh: ["上传照片", "照片", "入口", "停车", "更换照片"],
      },
      steps: [
        {
          text: {
            de: "In der Kundenansicht zum Abschnitt «Fotos» gehen.",
            zh: "在客户页面找到「照片」部分。",
          },
          label: "Fotos",
        },
        {
          text: {
            de: "Beim Feld «Geschäft / Eingang» auf «Foto ersetzen» klicken.",
            zh: "在「店铺 / 入口」处点击「更换照片」。",
          },
          label: "Foto ersetzen",
        },
        {
          text: {
            de: "«Bild auswählen» wählen oder ein Bild mit Strg+V aus der Zwischenablage einfügen.",
            zh: "选择「选择图片」，或用 Ctrl+V 从剪贴板粘贴图片。",
          },
          label: "Bild auswählen",
          result: "Foto gespeichert.",
        },
        {
          text: {
            de: "Beim Feld «Parken / Entladen» genauso verfahren.",
            zh: "在「停车 / 卸货」处做同样的操作。",
          },
          label: "Parken / Entladen",
        },
        {
          text: {
            de: "Ein vorhandenes Foto lässt sich jederzeit über «Geschäft / Eingang» erneut ersetzen.",
            zh: "已有照片随时可以通过「店铺 / 入口」再次更换。",
          },
          label: "Geschäft / Eingang",
        },
      ],
      after: {
        de: "Fehlende Fotos sind kein Fehler, aber die Kundenliste erinnert mit dem Filter «Fotos fehlen» daran.",
        zh: "缺少照片不算错误，但客户列表会用「缺少照片」筛选提醒你。",
      },
      route: "/de/admin/customers",
    },
    {
      id: "kunden-import",
      area: "buero",
      title: { de: "Kunden importieren (CSV/Excel)", zh: "导入客户（CSV/Excel）" },
      summary: {
        de: "Eine bestehende Kundenliste aus CSV oder XLSX in vier Schritten einlesen.",
        zh: "通过四个步骤读入现有的 CSV 或 XLSX 客户名单。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Kunden → «Import»",
        zh: "侧边栏 → 基础数据 → 客户 →「导入」",
      },
      search: {
        de: ["import", "csv", "excel", "xlsx", "kundenliste", "kunden importieren", "datei"],
        zh: ["导入", "导入客户", "csv", "excel", "客户名单"],
      },
      steps: [
        {
          text: {
            de: "Unter «Kunden» auf «Import» klicken; die Seite «Kunden importieren» öffnet sich.",
            zh: "在「客户」页面点击「导入」，打开「导入客户」页面。",
          },
          label: "Import",
        },
        {
          text: {
            de: "Schritt «Datei»: «Datei mit Kunden» auswählen. Erlaubt sind höchstens 5 MB und 2000 Datenzeilen; die erste Zeile enthält die Spaltenüberschriften.",
            zh: "第 1 步「文件」：选择「客户文件」。最大 5 MB、最多 2000 行数据；第一行必须是列标题。",
          },
          label: "Datei",
        },
        {
          text: {
            de: "Schritt «Spalten»: Jedem Feld die passende Spalte der Datei zuordnen und «Weiter zur Vorschau» klicken.",
            zh: "第 2 步「列」：为每个字段选择文件中对应的列，然后点击「继续到预览」。",
          },
          label: "Spalten",
        },
        {
          text: {
            de: "Schritt «Vorschau»: Neu, Aktualisiert, Unverändert und Fehlerhaft prüfen und dann importieren.",
            zh: "第 3 步「预览」：检查新建、更新、无变化和有错误的行，然后导入。",
          },
          label: "Vorschau",
        },
        {
          text: {
            de: "Schritt «Ergebnis»: «Neu angelegt», «Aktualisiert» und «Nicht importiert» lesen.",
            zh: "第 4 步「结果」：查看「已新建」「已更新」和「未导入」。",
          },
          label: "Ergebnis",
        },
      ],
      after: {
        de: "Nach dem Import werden die Adresspunkte automatisch gesucht. Ändert sich die Adresse eines Kunden, wird der Adresspunkt neu ermittelt. Für Kunden ohne Parkplatz führt der Link «Parkplätze festlegen» durch die Liste.",
        zh: "导入后会自动查找地址点。如果客户地址发生变化，地址点会重新确定。对于没有停车位的客户，可通过「设置停车位」链接逐个处理。",
      },
      route: "/de/admin/customers/import",
    },
    {
      id: "pins-pruefen",
      area: "buero",
      title: { de: "Parkplätze nach dem Import festlegen", zh: "导入后设置停车位" },
      summary: {
        de: "Kunden ohne Parkplatz der Reihe nach durchgehen und den Parkplatz auf der Karte setzen.",
        zh: "逐个查看没有停车位的客户，并在地图上设置停车位。",
      },
      path: {
        de: "Kunden → Import → «Parkplätze festlegen»",
        zh: "客户 → 导入 →「设置停车位」",
      },
      search: {
        de: [
          "parkplätze festlegen",
          "parkplatz setzen",
          "überspringen",
          "nach import",
          "ohne parkplatz",
        ],
        zh: ["设置停车位", "跳过", "没有停车位"],
      },
      steps: [
        {
          text: {
            de: "Nach dem Import auf «Parkplätze festlegen» klicken.",
            zh: "导入完成后点击「设置停车位」。",
          },
          label: "Parkplätze festlegen",
        },
        {
          text: {
            de: "Bei Bedarf «Adresse auf der Karte suchen» nutzen und den Marker auf den Parkplatz ziehen.",
            zh: "需要时使用「在地图上查找地址」，并把标记拖到停车位上。",
          },
          label: "Adresse auf der Karte suchen",
        },
        {
          text: {
            de: "Auf «Parkplatz speichern» klicken — der nächste Kunde erscheint automatisch.",
            zh: "点击「保存停车位」——下一位客户会自动出现。",
          },
          label: "Parkplatz speichern",
          result: "Parkplatz gespeichert.",
        },
        {
          text: {
            de: "Wenn etwas unklar ist, «Überspringen» wählen — die Liste lässt sich später fortsetzen.",
            zh: "如果不确定，选择「跳过」——之后可以继续处理。",
          },
          label: "Überspringen",
        },
        {
          text: {
            de: "Am Ende «Zur Kundenliste» wählen.",
            zh: "最后选择「前往客户列表」。",
          },
          label: "Zur Kundenliste",
        },
      ],
      after: {
        de: "Ein Kunde ohne Parkplatz bleibt in der Tour; sie führt dann zu seiner Lieferadresse.",
        zh: "没有停车位的客户仍在路线中，路线会前往他的送货地址。",
      },
      route: "/de/admin/customers/parking",
    },
    {
      id: "kunde-archivieren",
      area: "buero",
      title: { de: "Kunde archivieren und wiederherstellen", zh: "归档与恢复客户" },
      summary: {
        de: "Einen Kunden aus der Liste nehmen, ohne Daten zu löschen, und ihn später zurückholen.",
        zh: "把客户从列表中移除但不删除数据，之后还能恢复。",
      },
      path: {
        de: "Kunden → Kunde öffnen → «Archivieren»",
        zh: "客户 → 打开客户 →「归档」",
      },
      search: {
        de: [
          "kunde archivieren",
          "archiv",
          "wiederherstellen",
          "kunde löschen",
          "archivierte",
          "kunde deaktivieren",
        ],
        zh: ["归档客户", "归档", "恢复", "已归档"],
      },
      steps: [
        {
          text: {
            de: "In der Kundenansicht «Archivieren» wählen und den Hinweis lesen.",
            zh: "在客户页面选择「归档」，并阅读提示。",
          },
          label: "Archivieren",
          result: "Kunde archiviert.",
        },
        {
          text: {
            de: "Im Filter «Anzeigen» den Wert «Archivierte» wählen, um archivierte Kunden zu sehen.",
            zh: "在「显示」筛选中选择「已归档」，查看已归档的客户。",
          },
          label: "Archivierte",
        },
        {
          text: {
            de: "Beim Kunden «Wiederherstellen» klicken.",
            zh: "在该客户处点击「恢复」。",
          },
          label: "Wiederherstellen",
          result: "Kunde wiederhergestellt.",
        },
      ],
      after: {
        de: "Es wird nichts gelöscht. Archivierte Kunden bekommen keine neuen Bestellungen, bleiben aber in alten Bestellungen erhalten.",
        zh: "数据不会被删除。已归档客户不能下新订单，但旧订单保持不变。",
      },
      route: "/de/admin/customers",
    },
    {
      id: "kunden-suchen-filtern",
      area: "buero",
      title: { de: "Kunden suchen und filtern", zh: "搜索和筛选客户" },
      summary: {
        de: "Kunden über die Suche finden und nach fehlenden Fotos oder fehlendem Parkplatz filtern.",
        zh: "通过搜索找到客户，并按缺少照片或没有停车位进行筛选。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Kunden → «Suche»",
        zh: "侧边栏 → 基础数据 → 客户 →「搜索」",
      },
      search: {
        de: [
          "kunden suchen",
          "suche",
          "filter",
          "fotos fehlen",
          "ohne parkplatz",
          "kunde finden",
          "kundenliste",
        ],
        zh: ["搜索客户", "搜索", "筛选", "缺少照片", "无停车位"],
      },
      steps: [
        {
          text: {
            de: "Unter «Kunden» ins Feld «Suche» Nummer, Name, Straße oder Ort eingeben.",
            zh: "在「客户」页面的「搜索」框中输入编号、名称、街道或城市。",
          },
          label: "Suche",
        },
        {
          text: {
            de: "Den Filter «Fotos fehlen» einschalten, um Kunden ohne Fotos zu sehen.",
            zh: "打开「缺少照片」筛选，查看没有照片的客户。",
          },
          label: "Fotos fehlen",
        },
        {
          text: {
            de: "Den Filter «Ohne Parkplatz» einschalten, um Kunden ohne Parkplatz zu sehen.",
            zh: "打开「无停车位」筛选，查看没有停车位的客户。",
          },
          label: "Ohne Parkplatz",
        },
        {
          text: {
            de: "Mit «Anzeigen» zwischen «Aktive», «Archivierte» und «Alle» wechseln.",
            zh: "用「显示」在「启用」「已归档」和「全部」之间切换。",
          },
          label: "Anzeigen",
        },
      ],
      after: {
        de: "Die Suche ignoriert Groß-/Kleinschreibung und Akzente.",
        zh: "搜索不区分大小写和重音符号。",
      },
      route: "/de/admin/customers",
    },
    {
      id: "bestellung-anlegen",
      area: "buero",
      title: { de: "Bestellung anlegen", zh: "新建订单" },
      summary: {
        de: "Für einen Kunden und einen Liefertag Produkte erfassen und bestätigt oder als Entwurf speichern.",
        zh: "为客户和送货日录入产品，并保存为已确认或草稿。",
      },
      path: {
        de: "Seitenleiste → Betrieb → Bestellungen → «Neue Bestellung»",
        zh: "侧边栏 → 运营 → 订单 →「新建订单」",
      },
      search: {
        de: [
          "bestellung anlegen",
          "neue bestellung",
          "order",
          "menge",
          "position hinzufügen",
          "bestellung erfassen",
        ],
        zh: ["新建订单", "创建订单", "订单", "数量", "订单产品"],
      },
      steps: [
        {
          text: {
            de: "Unter «Bestellungen» auf «Neue Bestellung» klicken.",
            zh: "在「订单」页面点击「新建订单」。",
          },
          label: "Neue Bestellung",
        },
        {
          text: {
            de: "Im Feld «Kunde» nach Name oder Nummer suchen und den Kunden wählen.",
            zh: "在「客户」中按名称或编号搜索并选择客户。",
          },
          label: "Kunde",
        },
        {
          text: {
            de: "Das «Lieferdatum» eintragen; der nächste Liefertag wird vorgeschlagen.",
            zh: "填写「送货日期」，系统会建议下一个送货日。",
          },
          label: "Lieferdatum",
        },
        {
          text: {
            de: "Unter «Produkte» mit «Produkt hinzufügen» eine Zeile anlegen, das Produkt wählen und die «Menge» eintragen.",
            zh: "在「产品」中点击「添加产品」，选择产品并填写「数量」。",
          },
          label: "Produkt hinzufügen",
        },
        {
          text: {
            de: "Weitere Zeilen hinzufügen — die Taste Enter fügt direkt das nächste Produkt hinzu.",
            zh: "继续添加产品——按回车键会直接添加下一行。",
          },
          label: "Menge",
        },
        {
          text: {
            de: "Mit «Bestätigt speichern» die Bestellung festschreiben oder mit «Als Entwurf speichern» nur vormerken.",
            zh: "点击「确认并保存」正式保存订单，或点击「保存为草稿」暂存。",
          },
          label: "Bestätigt speichern",
          result: "Bestellung gespeichert.",
        },
      ],
      after: {
        de: "Mengen dürfen ein Komma oder einen Punkt enthalten, z. B. 2,5. Kommt dasselbe Produkt mehrfach vor, werden die Mengen beim Speichern zusammengezählt. Nur bestätigte Bestellungen kommen in eine Tour.",
        zh: "数量可以使用逗号或句点，例如 2,5。同一产品出现多次时，保存时会合并相加。只有已确认的订单才会进入配送线路。",
      },
      route: "/de/admin/orders/new",
    },
    {
      id: "bestellung-screenshot",
      area: "buero",
      title: { de: "Screenshot zur Bestellung hochladen", zh: "为订单上传截图" },
      summary: {
        de: "Die WhatsApp- oder WeChat-Nachricht des Kunden als Bild an die Bestellung hängen.",
        zh: "把客户的 WhatsApp 或微信消息截图附到订单上。",
      },
      path: {
        de: "Bestellungen → «Neue Bestellung» / «Bearbeiten» → Abschnitt «Screenshot»",
        zh: "订单 →「新建订单」/「编辑」→「截图」部分",
      },
      search: {
        de: [
          "screenshot",
          "bestellung screenshot",
          "whatsapp",
          "wechat",
          "bild einfügen",
          "strg+v",
          "screenshot hochladen",
        ],
        zh: ["截图", "上传截图", "微信", "粘贴"],
      },
      steps: [
        {
          text: {
            de: "Im Bestellformular den Abschnitt «Screenshot» öffnen.",
            zh: "在订单表单中打开「截图」部分。",
          },
          label: "Screenshot",
        },
        {
          text: {
            de: "Den Screenshot hineinziehen, mit «Bild auswählen» auswählen oder mit Strg+V einfügen.",
            zh: "把截图拖入，或点「选择图片」，或用 Ctrl+V 粘贴。",
          },
          label: "Bild auswählen",
        },
        {
          text: {
            de: "Der Screenshot erscheint neben dem Formular; mit «Screenshot entfernen» lässt er sich wieder löschen.",
            zh: "截图会显示在表单旁边；点击「移除截图」可以删除。",
          },
          label: "Screenshot entfernen",
        },
      ],
      after: {
        de: "Der Screenshot ist freiwillig. Beim Kopieren auf ein anderes Datum wird er nicht mitkopiert.",
        zh: "截图不是必填项。复制到其他日期时，截图不会被一起复制。",
      },
      route: "/de/admin/orders/new",
    },
    {
      id: "bestellung-bearbeiten-kopieren",
      area: "buero",
      title: { de: "Bestellung bearbeiten, kopieren und stornieren", zh: "编辑、复制和取消订单" },
      summary: {
        de: "Mengen ändern, eine Bestellung auf ein anderes Datum kopieren oder stornieren.",
        zh: "修改数量、把订单复制到其他日期，或取消订单。",
      },
      path: {
        de: "Bestellungen → Bestellung öffnen → «Bearbeiten» / «Auf anderes Datum kopieren» / «Stornieren»",
        zh: "订单 → 打开订单 →「编辑」/「复制到其他日期」/「取消订单」",
      },
      search: {
        de: [
          "bestellung bearbeiten",
          "bestellung kopieren",
          "stornieren",
          "bestellung ändern",
          "anderes datum",
          "bestellung stornieren",
        ],
        zh: ["编辑订单", "复制订单", "取消订单", "修改订单"],
      },
      steps: [
        {
          text: {
            de: "In der Bestellliste die Bestellung öffnen und «Bearbeiten» wählen.",
            zh: "在订单列表中打开订单，然后点击「编辑」。",
          },
          label: "Bearbeiten",
        },
        {
          text: {
            de: "Mengen oder die interne Notiz ändern und mit «Speichern» sichern.",
            zh: "修改数量或内部备注，然后点击「保存」。",
          },
          label: "Speichern",
          result: "Änderungen gespeichert.",
        },
        {
          text: {
            de: "Zum Kopieren «Auf anderes Datum kopieren» wählen und ein neues Lieferdatum eintragen.",
            zh: "要复制，选择「复制到其他日期」并填写新的送货日期。",
          },
          label: "Auf anderes Datum kopieren",
          result: "Kopie als Entwurf angelegt.",
        },
        {
          text: {
            de: "Zum Stornieren «Stornieren» wählen und mit «Ja, stornieren» bestätigen.",
            zh: "要取消，选择「取消订单」并点击「确认取消」。",
          },
          label: "Stornieren",
        },
        {
          text: {
            de: "Den Dialog mit «Ja, stornieren» abschließen.",
            zh: "在对话框中点击「确认取消」完成操作。",
          },
          label: "Ja, stornieren",
          result: "Bestellung storniert.",
        },
      ],
      after: {
        de: "Stornieren kann nicht rückgängig gemacht werden. Der Kunde lässt sich nachträglich nicht ändern — bei einem falschen Kunden die Bestellung stornieren und neu erfassen.",
        zh: "取消无法撤销。客户无法事后更改——选错客户时，请取消订单后重新录入。",
      },
      route: "/de/admin/orders",
    },
    {
      id: "bestellungen-filtern-summen",
      area: "buero",
      title: { de: "Bestellungen filtern und Summen lesen", zh: "筛选订单并查看合计" },
      summary: {
        de: "Nach Zeitraum, Kunde, Status und Quelle filtern und die Mengen je Liefertag ablesen.",
        zh: "按时间范围、客户、状态和来源筛选，并查看每个送货日的数量合计。",
      },
      path: {
        de: "Seitenleiste → Betrieb → Bestellungen → «Filter» / «Summen je Liefertag»",
        zh: "侧边栏 → 运营 → 订单 →「筛选」/「每个送货日的合计」",
      },
      search: {
        de: [
          "bestellungen filtern",
          "summen",
          "summen je liefertag",
          "liefertag",
          "zeitraum",
          "filter",
          "mengen",
        ],
        zh: ["筛选订单", "合计", "送货日", "时间范围"],
      },
      steps: [
        {
          text: {
            de: "Unter «Bestellungen» den «Zeitraum» mit «Von» und «Bis» setzen.",
            zh: "在「订单」页面用「从」和「到」设置「时间范围」。",
          },
          label: "Zeitraum",
        },
        {
          text: {
            de: "Zusätzlich nach «Kunde», «Status» und «Quelle» filtern.",
            zh: "还可以按「客户」「状态」和「来源」筛选。",
          },
          label: "Status",
        },
        {
          text: {
            de: "Den Bereich «Summen je Liefertag» aufklappen.",
            zh: "展开「每个送货日的合计」。",
          },
          label: "Summen je Liefertag",
        },
        {
          text: {
            de: "Dort je Liefertag «Produkt» und «Menge» ablesen.",
            zh: "在这里按送货日查看「产品」和「数量」。",
          },
          label: "Menge",
        },
      ],
      after: {
        de: "In die Summen zählen nur bestätigte Bestellungen; Entwürfe und stornierte Bestellungen zählen nicht. Die Filter Kunde, Status und Quelle ändern die Summen nicht.",
        zh: "合计只统计已确认订单，草稿和已取消订单不计入。客户、状态和来源筛选不会影响合计。",
      },
      route: "/de/admin/orders",
    },
    {
      id: "tour-erstellen",
      area: "buero",
      title: { de: "Tour erstellen", zh: "生成配送线路" },
      summary: {
        de: "Aus allen bestätigten Bestellungen eines Liefertags eine Tour bauen.",
        zh: "把某个送货日的所有已确认订单生成一条配送线路。",
      },
      path: {
        de: "Seitenleiste → Betrieb → Touren → «Tour erstellen»",
        zh: "侧边栏 → 运营 → 配送线路 →「生成配送线路」",
      },
      search: {
        de: [
          "tour erstellen",
          "tour planen",
          "route",
          "liefertour",
          "tour anlegen",
          "planen",
          "tour",
        ],
        zh: ["生成配送线路", "规划行程", "配送线路", "路线"],
      },
      steps: [
        {
          text: {
            de: "Unter «Touren» das «Lieferdatum» wählen und mit «Vorheriger Tag» / «Nächster Tag» wechseln.",
            zh: "在「配送线路」页面选择「配送日期」，用「前一天」/「后一天」切换。",
          },
          label: "Lieferdatum",
        },
        {
          text: {
            de: "Auf «Tour erstellen» klicken.",
            zh: "点击「生成配送线路」。",
          },
          label: "Tour erstellen",
        },
        {
          text: {
            de: "Die Karte und die Liste «Stopps» prüfen.",
            zh: "检查地图和「站点」列表。",
          },
          label: "Stopps",
        },
        {
          text: {
            de: "Fehlt der Depot-Standort, zuerst in den «Einstellungen» den Depot-Standort setzen und bestätigen.",
            zh: "如果没有仓库位置，请先在「设置」中设置并确认仓库位置。",
          },
          label: "Einstellungen",
        },
      ],
      after: {
        de: "Die Tour entsteht als Entwurf. Ohne Fahrer und ohne Freigabe sieht sie der Fahrer nicht.",
        zh: "线路会先以草稿形式创建。没有指派司机并发布之前，司机看不到它。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "tour-umsortieren",
      area: "buero",
      title: { de: "Tour umsortieren und optimieren", zh: "调整顺序并重新优化" },
      summary: {
        de: "Stopps verschieben, die Reihenfolge sperren oder die Tour komplett neu optimieren.",
        zh: "移动站点、锁定顺序，或重新优化整条线路。",
      },
      path: {
        de: "Touren → Tour eines Tages → Stopps",
        zh: "配送线路 → 某天的线路 → 站点",
      },
      search: {
        de: [
          "tour umsortieren",
          "reihenfolge",
          "sperren",
          "neu optimieren",
          "stopps verschieben",
          "sortieren",
        ],
        zh: ["调整顺序", "锁定顺序", "重新优化", "站点排序"],
      },
      steps: [
        {
          text: {
            de: "In der Stopps-Liste einen Stopp mit «nach oben» oder «nach unten» verschieben.",
            zh: "在站点列表中用「上移」或「下移」移动站点。",
          },
          label: "nach oben",
          result: "Reihenfolge gespeichert, Zeiten neu berechnet.",
        },
        {
          text: {
            de: "Mit «Reihenfolge sperren» die Reihenfolge festhalten.",
            zh: "点击「锁定顺序」固定当前顺序。",
          },
          label: "Reihenfolge sperren",
          result: "Reihenfolge gesperrt.",
        },
        {
          text: {
            de: "Mit «Neu optimieren» die beste Reihenfolge neu berechnen lassen — manuelle Änderungen gehen dabei verloren.",
            zh: "点击「重新优化」重新计算最佳顺序——手动调整会被丢弃。",
          },
          label: "Neu optimieren",
        },
        {
          text: {
            de: "Ist die Tour gesperrt, neue Kunden nur mit «Aus Bestellungen aktualisieren» ans Ende hängen.",
            zh: "线路已锁定时，只用「根据订单更新」把新客户加到末尾。",
          },
          label: "Aus Bestellungen aktualisieren",
        },
      ],
      after: {
        de: "Eine freigegebene Tour lässt sich nicht mehr umsortieren; dann greift zuerst «Erneut freigeben».",
        zh: "已发布的线路不能再调整顺序；这种情况需要先用「重新发布」处理。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "fahrer-zuweisen-freigeben",
      area: "buero",
      title: { de: "Fahrer zuweisen und die Tour freigeben", zh: "指派司机并发布线路" },
      summary: {
        de: "Einen Fahrer auswählen und die Tour für ihn sichtbar machen.",
        zh: "选择司机，并让司机看到这条线路。",
      },
      path: {
        de: "Touren → Tour → «Fahrer» → «Tour freigeben»",
        zh: "配送线路 → 线路 →「司机」→「发布配送线路」",
      },
      search: {
        de: [
          "fahrer zuweisen",
          "tour freigeben",
          "fahrer wählen",
          "kein fahrer",
          "freigabe",
          "freigeben",
        ],
        zh: ["指派司机", "发布配送线路", "选择司机", "发布"],
      },
      steps: [
        {
          text: {
            de: "In der Tour das Feld «Fahrer» öffnen und einen Fahrer wählen.",
            zh: "在线路页面打开「司机」并选择一位司机。",
          },
          label: "Fahrer",
          result: "Fahrer zugewiesen.",
        },
        {
          text: {
            de: "Auf «Tour freigeben» klicken.",
            zh: "点击「发布配送线路」。",
          },
          label: "Tour freigeben",
        },
        {
          text: {
            de: "Im Dialog die Zusammenfassung prüfen und «Jetzt freigeben» klicken.",
            zh: "在对话框中检查摘要，然后点击「立即发布」。",
          },
          label: "Jetzt freigeben",
          result: "Tour freigegeben.",
        },
      ],
      after: {
        de: "Ohne Fahrer zeigt das Feld «Kein Fahrer gewählt». Nach der Freigabe kann die Tour im Büro nicht mehr geändert werden.",
        zh: "没有选择司机时，该栏显示「未选择司机」。发布之后，办公室就不能再修改这条线路。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "erneut-freigeben-und-folgetour",
      area: "buero",
      title: { de: "Erneut freigeben und Folgetour erstellen", zh: "重新发布并创建补充线路" },
      summary: {
        de: "Nach Änderungen an Bestellungen die Tour erneut freigeben oder eine Folgetour bauen.",
        zh: "订单变更后重新发布线路，或创建一条补充线路。",
      },
      path: {
        de: "Touren → Tour mit Hinweis «Bestellungen seit der Freigabe geändert» → «Erneut freigeben»",
        zh: "配送线路 → 带有「发布后订单已更改」提示的线路 →「重新发布」",
      },
      search: {
        de: [
          "erneut freigeben",
          "folgetour",
          "nachbestellung",
          "tour geändert",
          "neu freigeben",
          "tour aktualisiert",
        ],
        zh: ["重新发布", "补充线路", "补单", "线路已更新"],
      },
      steps: [
        {
          text: {
            de: "Beim Hinweis «Bestellungen seit der Freigabe geändert – prüfen und erneut freigeben» die Änderungen ansehen.",
            zh: "在「发布后订单已更改——请检查并重新发布」提示处查看变更内容。",
          },
          label: "Bestellungen seit der Freigabe geändert – prüfen und erneut freigeben",
        },
        {
          text: {
            de: "Auf «Erneut freigeben» klicken.",
            zh: "点击「重新发布」。",
          },
          label: "Erneut freigeben",
        },
        {
          text: {
            de: "Im Dialog «Jetzt erneut freigeben» bestätigen.",
            zh: "在对话框中点击「立即重新发布」确认。",
          },
          label: "Jetzt erneut freigeben",
          result: "Tour erneut freigegeben (Version {revision}).",
        },
        {
          text: {
            de: "Bestellungen, die erst nach Abschluss der Tour eingegangen sind, über «Folgetour erstellen» in eine zweite Tour geben.",
            zh: "线路完成之后才收到的订单，用「创建补充线路」放入另一条线路。",
          },
          label: "Folgetour erstellen",
        },
      ],
      after: {
        de: "Der Fahrer sieht nach der erneuten Freigabe «Tour wurde aktualisiert» und die geänderten Stopps. Eine Folgetour ist nur möglich, wenn alle Touren des Tages abgeschlossen sind.",
        zh: "重新发布后，司机会看到「线路已更新」以及有变动的站点。只有当当天所有线路都已完成时，才能创建补充线路。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "ladeliste-drucken",
      area: "buero",
      title: { de: "Ladeliste drucken", zh: "打印装车单" },
      summary: {
        de: "Die Ladeliste einer Tour öffnen, die Sprache des Ausdrucks wählen und drucken.",
        zh: "打开线路的装车单，选择打印语言并打印。",
      },
      path: {
        de: "Touren → Tour → «Ladeliste drucken» → «Sprache des Ausdrucks» → «Drucken»",
        zh: "配送线路 → 线路 →「打印装车单」→「打印语言」→「打印」",
      },
      search: {
        de: ["ladeliste drucken", "ladeliste", "drucken", "ausdruck", "sprache des ausdrucks"],
        zh: ["打印装车单", "装车单", "打印", "打印语言"],
      },
      steps: [
        {
          text: {
            de: "In der Tour auf «Ladeliste drucken» klicken.",
            zh: "在线路页面点击「打印装车单」。",
          },
          label: "Ladeliste drucken",
        },
        {
          text: {
            de: "Auf der Seite «Ladeliste» die «Sprache des Ausdrucks» wählen — unabhängig von der Sprache der Oberfläche.",
            zh: "在「装车单」页面选择「打印语言」——它与界面语言无关。",
          },
          label: "Sprache des Ausdrucks",
        },
        {
          text: {
            de: "Mit «Drucken» den Druckdialog öffnen und drucken.",
            zh: "点击「打印」打开打印对话框并打印。",
          },
          label: "Drucken",
        },
      ],
      after: {
        de: "Die Ladeliste ist für A4 mit 12 mm Rand gedacht. Ist die Tour veraltet, erscheint die Warnung «ACHTUNG: Bestellungen wurden nach der Freigabe dieser Tour geändert.»",
        zh: "装车单按 A4、12 毫米页边距设计。如果线路已过期，会出现警告「注意：此线路发布后订单已变更。」",
      },
      route: "/de/admin/tours",
    },
    {
      id: "fortschritt-beobachten",
      area: "buero",
      title: { de: "Fortschritt der Tour beobachten", zh: "查看线路进度" },
      summary: {
        de: "Auf der Übersicht sehen, was heute erledigt ist und was noch offen ist.",
        zh: "在总览中查看今天已完成和仍待处理的内容。",
      },
      path: {
        de: "Seitenleiste → Betrieb → Übersicht",
        zh: "侧边栏 → 运营 → 总览",
      },
      search: {
        de: ["fortschritt", "übersicht", "zu erledigen", "letzte aktivität", "heute", "dashboard"],
        zh: ["总览", "进度", "待处理", "最近活动", "今天"],
      },
      steps: [
        {
          text: {
            de: "In der Seitenleiste «Übersicht» öffnen.",
            zh: "在侧边栏中打开「总览」。",
          },
          label: "Übersicht",
        },
        {
          text: {
            de: "Unter «Fortschritt der heutigen Tour» den Stand ablesen.",
            zh: "在「今日行程进度」下查看当前进度。",
          },
          label: "Fortschritt der heutigen Tour",
        },
        {
          text: {
            de: "Im Abschnitt «Zu erledigen» offene Punkte sehen, z. B. Kunden ohne Parkplatz.",
            zh: "在「待处理」中查看未完成事项，例如没有停车位的客户。",
          },
          label: "Zu erledigen",
        },
        {
          text: {
            de: "Unter «Letzte Aktivität» die neuesten Einträge lesen.",
            zh: "在「最近活动」中查看最新记录。",
          },
          label: "Letzte Aktivität",
        },
      ],
      after: {
        de: "Die Übersicht aktualisiert sich etwa alle 30 Sekunden.",
        zh: "总览大约每 30 秒自动刷新一次。",
      },
      route: "/de/admin",
    },
    {
      id: "fahrer-anlegen-pin",
      area: "buero",
      title: { de: "Fahrer anlegen und PIN vergeben", zh: "新增司机并设置 PIN 码" },
      summary: {
        de: "Ein Fahrerkonto mit Benutzername und Sprache erstellen und die einmalige PIN notieren.",
        zh: "创建司机的用户名和语言，并记下只显示一次的 PIN 码。",
      },
      path: {
        de: "Seitenleiste → Stammdaten → Fahrer → «Fahrer anlegen»",
        zh: "侧边栏 → 基础数据 → 司机 →「新增司机」",
      },
      search: {
        de: [
          "fahrer anlegen",
          "pin",
          "pin kopieren",
          "fahrer erstellen",
          "benutzername",
          "pin zurücksetzen",
        ],
        zh: ["新增司机", "PIN码", "复制PIN码", "重置PIN码"],
      },
      steps: [
        {
          text: {
            de: "Unter «Fahrer» auf «Fahrer anlegen» klicken.",
            zh: "在「司机」页面点击「新增司机」。",
          },
          label: "Fahrer anlegen",
        },
        {
          text: {
            de: "«Anzeigename» und «Benutzername» eintragen (3 bis 32 Zeichen: Kleinbuchstaben, Ziffern, Punkt, Bindestrich, Unterstrich).",
            zh: "填写「显示名称」和「用户名」（3 至 32 个字符：小写字母、数字、点、连字符、下划线）。",
          },
          label: "Benutzername",
        },
        {
          text: {
            de: "Die «Sprache» wählen — der Fahrer sieht die App in dieser Sprache.",
            zh: "选择「语言」——司机将以该语言使用应用。",
          },
          label: "Sprache",
        },
        {
          text: {
            de: "Mit «Anlegen» bestätigen; der Dialog «PIN für {name}» erscheint.",
            zh: "点击「创建」确认，随后出现「{name}的PIN码」对话框。",
          },
          label: "Anlegen",
        },
        {
          text: {
            de: "Die PIN mit «PIN kopieren» kopieren oder «Drucken» — sie wird nur einmal angezeigt.",
            zh: "用「复制PIN码」复制或「打印」——PIN 码只显示一次。",
          },
          label: "PIN kopieren",
          result: "PIN kopiert.",
        },
        {
          text: {
            de: "Den Dialog mit «Fertig» schließen.",
            zh: "点击「完成」关闭对话框。",
          },
          label: "Fertig",
        },
      ],
      after: {
        de: "Ist die PIN verloren, hilft nur «PIN zurücksetzen» — die alte PIN gilt dann sofort nicht mehr.",
        zh: "如果 PIN 码丢失，只能用「重置PIN码」——旧 PIN 码会立即失效。",
      },
      route: "/de/admin/drivers",
    },
    {
      id: "fahrer-deaktivieren-sprache",
      area: "buero",
      title: { de: "Fahrer deaktivieren und Sprache ändern", zh: "停用司机并修改语言" },
      summary: {
        de: "Ein Fahrerkonto sperren oder wieder freigeben und seine App-Sprache wechseln.",
        zh: "停用或重新启用司机账号，并更改他的应用语言。",
      },
      path: {
        de: "Fahrer → Zeilenmenü → «Deaktivieren» / «Sprache bearbeiten»",
        zh: "司机 → 行菜单 →「停用」/「修改语言」",
      },
      search: {
        de: [
          "fahrer deaktivieren",
          "reaktivieren",
          "sprache ändern",
          "fahrer sperren",
          "sprache bearbeiten",
        ],
        zh: ["停用司机", "重新启用", "修改语言"],
      },
      steps: [
        {
          text: {
            de: "Unter «Fahrer» im Zeilenmenü «Deaktivieren» wählen und bestätigen.",
            zh: "在「司机」的行菜单中选择「停用」并确认。",
          },
          label: "Deaktivieren",
          result: "{name} wurde deaktiviert.",
        },
        {
          text: {
            de: "Zum Wiederaufnehmen im Zeilenmenü «Reaktivieren» wählen.",
            zh: "要恢复使用，在行菜单中选择「重新启用」。",
          },
          label: "Reaktivieren",
          result: "{name} wurde reaktiviert.",
        },
        {
          text: {
            de: "Mit «Sprache bearbeiten» die Sprache des Fahrers ändern; die Änderung gilt sofort.",
            zh: "用「修改语言」更改司机的语言，更改立即生效。",
          },
          label: "Sprache bearbeiten",
          result: "Sprache von {name} geändert.",
        },
      ],
      after: {
        de: "Das eigene Konto lässt sich nicht deaktivieren.",
        zh: "不能停用自己的账号。",
      },
      route: "/de/admin/drivers",
    },
    {
      id: "admin-anlegen",
      area: "buero",
      title: { de: "Admin (Büro-Konto) anlegen", zh: "新增管理员（办公室账号）" },
      summary: {
        de: "Ein Büro-Konto mit E-Mail und Passwort erstellen.",
        zh: "使用电子邮箱和密码创建一个办公室账号。",
      },
      path: {
        de: "Fahrer-Seite → Abschnitt «Administratoren» → «Admin anlegen»",
        zh: "司机页面 →「管理员」部分 →「新增管理员」",
      },
      search: {
        de: [
          "admin anlegen",
          "administrator",
          "büro konto",
          "passwort",
          "benutzer anlegen",
          "administratoren",
        ],
        zh: ["新增管理员", "管理员", "密码", "创建账号"],
      },
      steps: [
        {
          text: {
            de: "Unter «Fahrer» zum Abschnitt «Administratoren» scrollen und «Admin anlegen» klicken.",
            zh: "在「司机」页面滚动到「管理员」部分，点击「新增管理员」。",
          },
          label: "Admin anlegen",
        },
        {
          text: {
            de: "Die «E-Mail» eintragen.",
            zh: "填写「电子邮箱」。",
          },
          label: "E-Mail",
        },
        {
          text: {
            de: "Ein «Passwort» mit mindestens 10 Zeichen vergeben.",
            zh: "设置「密码」，至少 10 个字符。",
          },
          label: "Passwort",
        },
        {
          text: {
            de: "Mit «Anlegen» bestätigen.",
            zh: "点击「创建」确认。",
          },
          label: "Anlegen",
        },
      ],
      after: {
        de: "Es gibt keine Funktion zum Ändern oder Zurücksetzen eines Büro-Passworts — ein neues Konto muss von einem Admin angelegt werden.",
        zh: "应用没有修改或重置办公室密码的功能——只能由管理员新建账号。",
      },
      route: "/de/admin/drivers",
    },
    {
      id: "einstellungen-depot-planung",
      area: "buero",
      title: {
        de: "Einstellungen: Depot, Abfahrtszeit und Liefertage",
        zh: "设置：仓库、出发时间和配送日",
      },
      summary: {
        de: "Depot-Standort bestätigen und die Planungswerte festlegen, mit denen Touren berechnet werden.",
        zh: "确认仓库位置，并设置用于计算线路的规划参数。",
      },
      path: {
        de: "Seitenleiste → System → Einstellungen",
        zh: "侧边栏 → 系统 → 设置",
      },
      search: {
        de: [
          "einstellungen",
          "depot",
          "fabrik",
          "abfahrtszeit",
          "minuten pro stopp",
          "liefertage",
          "planung",
          "depot pin",
        ],
        zh: ["设置", "仓库", "默认出发时间", "配送日", "每个站点停留分钟数"],
      },
      steps: [
        {
          text: {
            de: "In der Seitenleiste unter «System» «Einstellungen» öffnen.",
            zh: "在侧边栏「系统」下打开「设置」。",
          },
          label: "Einstellungen",
        },
        {
          text: {
            de: "Im Abschnitt «Depot (Fabrik)» Name und «Adresse» eintragen.",
            zh: "在「仓库（工厂）」部分填写名称和「地址」。",
          },
          label: "Depot (Fabrik)",
        },
        {
          text: {
            de: "Im Abschnitt «Standort auf der Karte» den Standort setzen und «Ich habe geprüft, dass der Standort am richtigen Ort liegt.» anhaken.",
            zh: "在「地图上的仓库位置」部分设置位置，并勾选「我已核实位置正确。」",
          },
          label: "Ich habe geprüft, dass der Standort am richtigen Ort liegt.",
        },
        {
          text: {
            de: "Im Abschnitt «Planung» «Standard-Abfahrtszeit», «Minuten pro Stopp» und «Liefertage» setzen.",
            zh: "在「规划」部分设置「默认出发时间」「每个站点停留分钟数」和「配送日」。",
          },
          label: "Standard-Abfahrtszeit",
        },
        {
          text: {
            de: "Mit «Speichern» sichern.",
            zh: "点击「保存」。",
          },
          label: "Speichern",
          result: "Einstellungen gespeichert.",
        },
      ],
      after: {
        de: "Solange der Depot-Standort nicht bestätigt ist, meldet die App «Der Depot-Standort ist noch nicht bestätigt» und es kann keine Tour erstellt werden.",
        zh: "只要仓库位置尚未确认，应用就会提示「仓库位置尚未确认」，并且无法生成配送线路。",
      },
      route: "/de/admin/settings",
    },
    {
      id: "verlauf-lesen",
      area: "buero",
      title: { de: "Verlauf lesen", zh: "查看变更记录" },
      summary: {
        de: "Nachschauen, wer wann welche Änderung gemacht hat.",
        zh: "查看谁在什么时候做了什么修改。",
      },
      path: {
        de: "Seitenleiste → Betrieb → Touren → Tour eines Tages → Abschnitt «Verlauf»",
        zh: "侧边栏 → 运营 → 配送线路 → 某天的线路 →「变更记录」部分",
      },
      search: {
        de: ["verlauf", "wer hat geändert", "protokoll", "änderungen", "historie", "audit"],
        zh: ["变更记录", "历史", "谁修改了", "记录"],
      },
      steps: [
        {
          text: {
            de: "Unter «Touren» die Tour eines Tages öffnen und zum Abschnitt «Verlauf» scrollen.",
            zh: "在「配送线路」中打开某天的线路，滚动到「变更记录」部分。",
          },
          label: "Verlauf",
        },
        {
          text: {
            de: "Die Einträge lesen, z. B. «Bestellung geändert», «Tour freigegeben» oder «Als geliefert markiert».",
            zh: "查看记录，例如「修改订单」「发布路线」或「标记为已送达」。",
          },
          label: "Bestellung geändert",
        },
        {
          text: {
            de: "Beim Eintrag den Wechsel «vorher → nachher» und Felder wie «Status» oder «Fahrer» ansehen.",
            zh: "在记录中查看「修改前 → 修改后」，以及「状态」「司机」等字段。",
          },
          label: "Status",
        },
      ],
      after: {
        de: "Einträge können weder geändert noch gelöscht werden. Den Verlauf einer Bestellung findest du in deren Detailansicht.",
        zh: "记录无法修改或删除。订单的变更记录可以在订单详情页查看。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "notizen-uebersetzen",
      area: "buero",
      title: { de: "Kundennotizen übersetzen", zh: "翻译客户备注" },
      summary: {
        de: "Den deutschen Fahrerhinweis eines Kunden prüfen, neu übersetzen und als geprüft markieren.",
        zh: "检查客户的德语备注，重新翻译并标记为已检查。",
      },
      path: {
        de: "Kunden → Kunde öffnen → Tab «Übersetzungen»",
        zh: "客户 → 打开客户 →「翻译」选项卡",
      },
      search: {
        de: [
          "übersetzungen",
          "notiz übersetzen",
          "neu übersetzen",
          "chin übersetzen",
          "als geprüft markieren",
          "hinweis übersetzen",
        ],
        zh: ["翻译", "重新翻译", "标记为已检查", "备注翻译"],
      },
      steps: [
        {
          text: {
            de: "In der Kundenansicht den Tab «Übersetzungen» öffnen.",
            zh: "在客户页面打开「翻译」选项卡。",
          },
          label: "Übersetzungen",
        },
        {
          text: {
            de: "Den deutschen Text als «Vorlage» und die chinesischen Fassungen darunter prüfen.",
            zh: "查看作为「原文」的德语文本，以及下面的中文版本。",
          },
          label: "Übersetzungen speichern",
        },
        {
          text: {
            de: "Mit «Neu übersetzen» alle drei chinesischen Versionen neu erzeugen lassen — von Hand bearbeitete Übersetzungen gehen verloren.",
            zh: "用「重新翻译」重新生成三个中文版本——手动编辑过的译文会被替换。",
          },
          label: "Neu übersetzen",
        },
        {
          text: {
            de: "Eine geprüfte Fassung mit «Als geprüft markieren» kennzeichnen.",
            zh: "对已检查的版本点击「标记为已检查」。",
          },
          label: "Als geprüft markieren",
        },
        {
          text: {
            de: "Die Änderungen mit «Übersetzungen speichern» sichern.",
            zh: "点击「保存翻译」保存修改。",
          },
          label: "Übersetzungen speichern",
          result: "Übersetzungen gespeichert.",
        },
      ],
      after: {
        de: "Geänderte Übersetzungen gelten als von Hand bearbeitet; bei späteren Änderungen am deutschen Text werden sie nicht automatisch überschrieben, sondern zur Prüfung markiert.",
        zh: "修改过的译文被视为手动编辑；之后德语原文变更时不会被自动覆盖，而是被标记为需要检查。",
      },
      route: "/de/admin/customers",
    },

    // ── Anmeldung & Konto ────────────────────────────────────────────────────────────────────
    {
      id: "buero-anmelden-abmelden",
      area: "konto",
      title: {
        de: "Büro: Anmelden, Sprache wechseln, abmelden",
        zh: "办公室：登录、切换语言、退出登录",
      },
      summary: {
        de: "Mit E-Mail und Passwort ins Büro kommen, die Sprache wechseln und sich abmelden.",
        zh: "使用电子邮箱和密码登录办公室，切换语言并退出登录。",
      },
      path: {
        de: "Anmeldeseite → «Anmeldung Büro» → Seitenleiste/Kopfzeile → «Abmelden»",
        zh: "登录页 →「办公室登录」→ 侧边栏/页头 →「退出登录」",
      },
      search: {
        de: [
          "büro anmelden",
          "login",
          "anmelden",
          "abmelden",
          "passwort vergessen",
          "sprache wechseln",
        ],
        zh: ["办公室登录", "登录", "退出登录", "语言"],
      },
      steps: [
        {
          text: {
            de: "Die Büro-Anmeldeseite öffnen; sie heißt «Anmeldung Büro».",
            zh: "打开办公室登录页，页面标题是「办公室登录」。",
          },
          label: "Anmeldung Büro",
        },
        {
          text: {
            de: "Die «E-Mail» und das «Passwort» eingeben.",
            zh: "输入「电子邮箱」和「密码」。",
          },
          label: "E-Mail",
        },
        {
          text: {
            de: "Auf «Anmelden» klicken.",
            zh: "点击「登录」。",
          },
          label: "Anmelden",
        },
        {
          text: {
            de: "Die Sprache der Oberfläche über die Kopfzeile wechseln — sie gilt nur für dieses Konto.",
            zh: "通过页头切换界面「语言」——它只对当前账号有效。",
          },
          label: "Sprache",
        },
        {
          text: {
            de: "Zum Beenden im Benutzermenü «Abmelden» wählen.",
            zh: "结束时在用户菜单中选择「退出登录」。",
          },
          label: "Abmelden",
        },
      ],
      after: {
        de: "Ein vergessenes Büro-Passwort kann nicht selbst zurückgesetzt werden; ein Admin muss ein neues Konto anlegen.",
        zh: "忘记办公室密码无法自助重置，只能由管理员新建账号。",
      },
      route: "/de/login",
    },
    {
      id: "fahrer-anmelden",
      area: "konto",
      title: {
        de: "Fahrer: Anmelden mit Benutzername und PIN",
        zh: "司机：使用用户名和 PIN 码登录",
      },
      summary: {
        de: "Mit Benutzername und sechsstelliger PIN in die Fahrer-App kommen.",
        zh: "使用用户名和 6 位 PIN 码登录司机应用。",
      },
      path: {
        de: "Fahrer-Anmeldung → «Benutzername» → «PIN (6 Ziffern)» → «Anmelden»",
        zh: "司机登录 →「用户名」→「PIN（6位数字）」→「登录」",
      },
      search: {
        de: [
          "fahrer anmelden",
          "pin",
          "benutzername",
          "anmeldung fehlgeschlagen",
          "zu viele fehlversuche",
          "passwort",
        ],
        zh: ["司机登录", "用户名", "PIN码", "登录失败"],
      },
      steps: [
        {
          text: {
            de: "Die «Fahrer-Anmeldung» öffnen.",
            zh: "打开「司机登录」页面。",
          },
          label: "Fahrer-Anmeldung",
        },
        {
          text: {
            de: "Den «Benutzername» eintragen, den das Büro vergeben hat.",
            zh: "填写办公室分配的「用户名」。",
          },
          label: "Benutzername",
        },
        {
          text: {
            de: "Die «PIN (6 Ziffern)» eingeben.",
            zh: "输入「PIN（6位数字）」。",
          },
          label: "PIN (6 Ziffern)",
        },
        {
          text: {
            de: "Auf «Anmelden» tippen.",
            zh: "点击「登录」。",
          },
          label: "Anmelden",
        },
        {
          text: {
            de: "Bei falscher Eingabe erscheint «Benutzername oder PIN falsch»; nach zu vielen Versuchen erscheint «Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.»",
            zh: "输入错误时会显示「用户名或 PIN 错误」；尝试次数过多会显示「失败次数过多，请15分钟后再试。」",
          },
          label: "Benutzername oder PIN falsch",
        },
      ],
      after: {
        de: "Die PIN wird vom Büro einmalig angezeigt. Ist sie weg, muss das Büro sie mit «PIN zurücksetzen» neu erzeugen.",
        zh: "PIN 码由办公室一次性显示。如果丢失，需要办公室用「重置PIN码」重新生成。",
      },
      route: "/de/driver/login",
    },
    {
      id: "sprachauswahl-erststart",
      area: "konto",
      title: { de: "Erster Start: Sprache wählen", zh: "首次启动：选择语言" },
      summary: {
        de: "Beim allerersten Start die Sprache der Fahrer-App über vier große Knöpfe wählen.",
        zh: "第一次启动时，用四个大按钮选择司机应用的语言。",
      },
      path: {
        de: "Fahrer-Anmeldung → Startseite mit vier Sprachknöpfen",
        zh: "司机登录 → 带四个语言按钮的启动页面",
      },
      search: {
        de: ["sprache", "chinesisch", "sprachauswahl", "erster start", "简体", "traditionell"],
        zh: ["语言", "中文", "简体中文", "繁体中文", "首次启动"],
      },
      steps: [
        {
          text: {
            de: "Nach der ersten Anmeldung erscheint ein Bildschirm mit vier Sprachknöpfen.",
            zh: "第一次登录后会出现一个带四个语言按钮的页面。",
          },
        },
        {
          text: {
            de: "Den Knopf der eigenen Sprache antippen: «简体中文», «繁體中文（香港）», «繁體中文（台灣）» oder «Deutsch».",
            zh: "点击自己语言的按钮：「简体中文」「繁體中文（香港）」「繁體中文（台灣）」或「Deutsch」。",
          },
        },
        {
          text: {
            de: "Die Wahl gilt sofort; die App öffnet sich in dieser Sprache.",
            zh: "选择立即生效，应用会以该语言打开。",
          },
        },
      ],
      after: {
        de: "Die Sprache lässt sich später jederzeit wieder ändern («Sprache ändern»).",
        zh: "之后随时可以再次更改语言（「更改语言」）。",
      },
      route: "/de/driver/start",
    },
    {
      id: "sprache-wechseln-app",
      area: "konto",
      title: { de: "Sprache in der Fahrer-App wechseln", zh: "在司机应用中切换语言" },
      summary: {
        de: "Die Sprache der Fahrer-App später umstellen.",
        zh: "之后更改司机应用的语言。",
      },
      path: {
        de: "Fahrer-App → Kopfzeile → «Sprache ändern»",
        zh: "司机应用 → 页头 →「更改语言」",
      },
      search: {
        de: ["sprache ändern", "sprache wechseln", "chinesisch", "deutsch", "fahrersprache"],
        zh: ["更改语言", "切换语言", "中文", "德语"],
      },
      steps: [
        {
          text: {
            de: "In der Fahrer-App in der Kopfzeile «Sprache ändern» öffnen.",
            zh: "在司机应用的页头点击「更改语言」。",
          },
          label: "Sprache ändern",
        },
        {
          text: {
            de: "Die gewünschte Sprache auswählen; die App wechselt sofort.",
            zh: "选择想要的语言，应用会立即切换。",
          },
        },
      ],
      after: {
        de: "Die Wahl gilt für dieses Gerät und diesen Fahrer. Die deutschen Beschriftungen auf gedruckten Listen bleiben deutsch — dafür gibt es das Glossar.",
        zh: "该选择对这台设备和这位司机有效。打印清单上的德语标注仍是德语——可以查阅术语表。",
      },
      route: "/de/driver",
    },
    {
      id: "fahrer-abmelden-offline-daten",
      area: "konto",
      title: { de: "Fahrer: Abmelden und Offline-Daten", zh: "司机：退出登录与离线数据" },
      summary: {
        de: "Sich in der Fahrer-App abmelden und wissen, was mit noch nicht gesendeten Eingaben passiert.",
        zh: "在司机应用中退出登录，并了解尚未发送的内容会怎样。",
      },
      path: {
        de: "Fahrer-App → Menü «Weitere Optionen» → «Abmelden»",
        zh: "司机应用 →「更多选项」→「退出登录」",
      },
      search: {
        de: ["abmelden", "logout", "offline daten", "übertragung", "wartet auf übertragung"],
        zh: ["退出登录", "离线数据", "等待发送", "同步"],
      },
      steps: [
        {
          text: {
            de: "In der Fahrer-App «Weitere Optionen» öffnen.",
            zh: "在司机应用中打开「更多选项」。",
          },
          label: "Weitere Optionen",
        },
        {
          text: {
            de: "Vor dem Abmelden prüfen, ob etwas «Wartet auf Übertragung» — diese Eingaben liegen noch auf dem Gerät.",
            zh: "退出前先检查是否有「等待发送」的内容——这些内容还保存在设备上。",
          },
          label: "Wartet auf Übertragung",
        },
        {
          text: {
            de: "Mit «Jetzt senden» alles übertragen, solange noch Internet da ist.",
            zh: "在有网络时点「立即发送」把内容发送出去。",
          },
          label: "Jetzt senden",
        },
        {
          text: {
            de: "Erst dann «Abmelden» wählen.",
            zh: "然后再选择「退出登录」。",
          },
          label: "Abmelden",
        },
      ],
      after: {
        de: "Beim Abmelden werden die Zugangsdaten vom Gerät entfernt. Nicht gesendete Eingaben können verloren gehen — deshalb zuerst senden.",
        zh: "退出登录会从设备上移除登录信息。未发送的内容可能会丢失，所以请先发送。",
      },
      route: "/de/driver",
    },

    // ── Fahrer ───────────────────────────────────────────────────────────────────────────────
    {
      id: "heutige-tour",
      area: "fahrer",
      title: { de: "Tages-Tour ansehen", zh: "查看当日配送线路" },
      summary: {
        de: "Die heutige Tour mit Fortschritt, nächstem Stopp und allen Stopps sehen.",
        zh: "查看今天的线路、进度、下一站和全部站点。",
      },
      path: {
        de: "Fahrer-App → «Heutige Tour»",
        zh: "司机应用 →「今日行程」",
      },
      search: {
        de: [
          "heutige tour",
          "tages tour",
          "tour ansehen",
          "fortschritt",
          "alle stopps",
          "nächster stopp",
        ],
        zh: ["今日行程", "查看线路", "进度", "全部站点", "下一站"],
      },
      steps: [
        {
          text: {
            de: "Die App öffnet die «Heutige Tour»; oben stehen «Fortschritt» und «Nächster Stopp».",
            zh: "应用打开「今日行程」；上方显示「进度」和「下一站」。",
          },
          label: "Heutige Tour",
        },
        {
          text: {
            de: "Unter dem nächsten Stopp steht «Ankunft ca. {time}».",
            zh: "下一站下面显示「预计 {time} 到达」。",
          },
          label: "Ankunft ca. {time}",
        },
        {
          text: {
            de: "Mit «Liste» und «Karte» zwischen der Stoppliste und der Karte wechseln.",
            zh: "用「列表」和「地图」在站点列表和地图之间切换。",
          },
          label: "Liste",
        },
        {
          text: {
            de: "In «Alle Stopps» sind offene und bereits erledigte Stopps getrennt.",
            zh: "在「全部站点」中，待送和已完成的站点是分开显示的。",
          },
          label: "Alle Stopps",
        },
      ],
      after: {
        de: "Zeigt die App «Heute keine Tour», hat das Büro noch keine Tour freigegeben.",
        zh: "如果显示「今天没有配送线路」，说明办公室还没有发布线路。",
      },
      route: "/de/driver",
    },
    {
      id: "stopp-details",
      area: "fahrer",
      title: { de: "Stopp-Details", zh: "站点详情" },
      summary: {
        de: "Liefermengen, Hinweis, Lieferzeiten, Fotos und Adresse eines Stopps sehen.",
        zh: "查看某一站的送货内容、备注、收货时间、照片和地址。",
      },
      path: {
        de: "Heutige Tour → Stopp antippen",
        zh: "今日行程 → 点击某一站",
      },
      search: {
        de: [
          "stopp details",
          "lieferung",
          "gesamt",
          "hinweis",
          "lieferzeiten",
          "fotos",
          "adresse kopieren",
        ],
        zh: ["站点详情", "送货内容", "合计", "备注", "收货时间", "照片", "复制地址"],
      },
      steps: [
        {
          text: {
            de: "In der Tour einen Stopp antippen.",
            zh: "在线路中点击一个站点。",
          },
          label: "Lieferung",
        },
        {
          text: {
            de: "Unter «Lieferung» stehen die Mengen; darunter steht «Gesamt».",
            zh: "「送货内容」中列出各项数量，下面是「合计」。",
          },
          label: "Gesamt",
        },
        {
          text: {
            de: "Der «Hinweis» des Büros erscheint in der eigenen Sprache.",
            zh: "办公室的「备注」会以你自己的语言显示。",
          },
          label: "Hinweis",
        },
        {
          text: {
            de: "Die «Lieferzeiten» sind ein freier Text und nur eine Information.",
            zh: "「收货时间」是自由文本，仅供参考。",
          },
          label: "Lieferzeiten",
        },
        {
          text: {
            de: "Mit «Adresse kopieren» die Adresse in eine andere App übernehmen.",
            zh: "点「复制地址」可把地址复制到其他应用。",
          },
          label: "Adresse kopieren",
          result: "Adresse kopiert",
        },
      ],
      after: {
        de: "Steht «Text nur auf Deutsch vorhanden», ist der Hinweis noch nicht übersetzt.",
        zh: "如果显示「仅有德语文本」，说明这条备注还没有翻译。",
      },
      route: "/de/driver/stops/[stopId]",
    },
    {
      id: "navigation-starten",
      area: "fahrer",
      title: { de: "Navigation starten", zh: "开始导航" },
      summary: {
        de: "Die Route zum Kunden im Kartenprogramm des Handys öffnen.",
        zh: "在手机的地图应用中打开到客户的路线。",
      },
      path: {
        de: "Stopp-Details → «Navigation starten»",
        zh: "站点详情 →「开始导航」",
      },
      search: {
        de: ["navigation starten", "google maps", "apple karten", "route", "navigieren", "maps"],
        zh: ["开始导航", "导航", "地图", "路线"],
      },
      steps: [
        {
          text: {
            de: "In der Tour oder in den Stopp-Details «Navigation starten» antippen.",
            zh: "在行程或站点详情中点击「开始导航」。",
          },
          label: "Navigation starten",
        },
        {
          text: {
            de: "Im Handy die Karten-App wählen, z. B. Google Maps oder «Apple Karten».",
            zh: "在手机上选择地图应用，例如 Google Maps 或「Apple 地图」。",
          },
          label: "Apple Karten",
        },
        {
          text: {
            de: "Die Navigation führt zum Parkplatz des Kunden, nicht zur getippten Adresse.",
            zh: "导航会指向客户的停车位，而不是输入的地址。",
          },
        },
      ],
      after: {
        de: "Hat der Kunde keinen Parkplatz, führt die Navigation zur Lieferadresse. Fehlt auch der Adresspunkt («Kein Adresspunkt – bitte beim Büro nachfragen»), führt die Navigation nicht zum richtigen Ort.",
        zh: "如果客户没有停车位，导航会前往送货地址。如果连地址点也没有（「没有地址点，请联系办公室」），导航无法带你到正确位置。",
      },
      route: "/de/driver/stops/[stopId]",
    },
    {
      id: "geliefert-rueckgaengig",
      area: "fahrer",
      title: { de: "Geliefert melden und Rückgängig", zh: "报告已送达与撤销" },
      summary: {
        de: "Einen Stopp als geliefert markieren und einen Fehler innerhalb von fünf Minuten zurücknehmen.",
        zh: "把站点标记为已送达，并在五分钟内撤销错误的操作。",
      },
      path: {
        de: "Stopp-Details → «Geliefert» → «Rückgängig»",
        zh: "站点详情 →「已送达」→「撤销」",
      },
      search: {
        de: ["geliefert", "rückgängig", "undo", "falsch getippt", "5 minuten"],
        zh: ["已送达", "撤销", "送错了", "5分钟"],
      },
      steps: [
        {
          text: {
            de: "In den Stopp-Details «Geliefert» antippen.",
            zh: "在站点详情中点击「已送达」。",
          },
          label: "Geliefert",
          result: "Geliefert: {name}",
        },
        {
          text: {
            de: "Bei einem Fehler sofort «Rückgängig» antippen — das geht nur in den ersten 5 Minuten.",
            zh: "如果点错了，立即点击「撤销」——只能在 5 分钟内操作。",
          },
          label: "Rückgängig",
          result: "Rückgängig gemacht",
        },
        {
          text: {
            de: "Kommst du zu spät, meldet die App «Rückgängig geht nur in den ersten 5 Minuten.»",
            zh: "如果太晚，应用会提示「只能在 5 分钟内撤销。」",
          },
          label: "Rückgängig geht nur in den ersten 5 Minuten.",
        },
      ],
      after: {
        de: "Ein erledigter Stopp bleibt erledigt, wenn die fünf Minuten vorbei sind.",
        zh: "超过五分钟后，已完成的站点就无法再撤销。",
      },
      route: "/de/driver/stops/[stopId]",
    },
    {
      id: "problem-melden",
      area: "fahrer",
      title: { de: "Problem melden", zh: "报告问题" },
      summary: {
        de: "Einen Stopp als Problem markieren, einen Grund wählen und freiwillig etwas dazu schreiben.",
        zh: "把站点标记为有问题，选择原因并可选填写说明。",
      },
      path: {
        de: "Stopp-Details → «Problem melden»",
        zh: "站点详情 →「报告问题」",
      },
      search: {
        de: [
          "problem melden",
          "problem",
          "grund",
          "geschlossen",
          "niemand anwesend",
          "kein parkplatz",
          "annnahme verweigert",
          "anmerkung",
        ],
        zh: ["报告问题", "问题", "原因", "店铺关门", "无人在场", "拒收", "补充说明"],
      },
      steps: [
        {
          text: {
            de: "In den Stopp-Details «Problem melden» antippen.",
            zh: "在站点详情中点击「报告问题」。",
          },
          label: "Problem melden",
        },
        {
          text: {
            de: "Im Dialog «Was ist das Problem?» einen der sieben Gründe wählen: «Geschlossen», «Niemand anwesend», «Kein Parkplatz», «Falsche Menge», «Annahme verweigert», «Adresse nicht gefunden» oder «Sonstiges».",
            zh: "在「遇到什么问题？」对话框中选择七个原因之一：「店铺关门」「无人在场」「无处停车」「数量不符」「拒收」「找不到地址」或「其他」。",
          },
          label: "Geschlossen",
        },
        {
          text: {
            de: "In «Anmerkung (freiwillig)» bei Bedarf einen kurzen Text schreiben, z. B. «Tor war zu».",
            zh: "需要时在「补充说明（可不填）」中写一句简短说明，例如「大门没开」。",
          },
          label: "Anmerkung (freiwillig)",
        },
        {
          text: {
            de: "Mit «Problem melden» absenden.",
            zh: "点击「报告问题」提交。",
          },
          label: "Problem melden",
          result: "Problem gemeldet: {name}",
        },
      ],
      after: {
        de: "Die Anmerkung wird auf Deutsch ans Büro übertragen und dort übersetzt; das Büro sieht Original und Übersetzung.",
        zh: "补充说明会以德语传回办公室并在那里翻译；办公室会看到原文和译文。",
      },
      route: "/de/driver/stops/[stopId]",
    },
    {
      id: "foto-aufnehmen",
      area: "fahrer",
      title: { de: "Foto aufnehmen oder ersetzen", zh: "拍照或更换照片" },
      summary: {
        de: "Ein Beweisfoto aufnehmen, verwenden oder neu aufnehmen und den Versand verfolgen.",
        zh: "拍摄凭证照片、使用或重拍，并查看发送状态。",
      },
      path: {
        de: "Stopp-Details → «Foto aufnehmen» → «Foto verwenden»",
        zh: "站点详情 →「拍照」→「使用此照片」",
      },
      search: {
        de: [
          "foto aufnehmen",
          "foto",
          "foto verwenden",
          "neu aufnehmen",
          "wartet auf versand",
          "gesendet",
          "beweisfoto",
        ],
        zh: ["拍照", "照片", "使用此照片", "重拍", "等待发送", "已发送"],
      },
      steps: [
        {
          text: {
            de: "In den Stopp-Details «Foto aufnehmen» antippen.",
            zh: "在站点详情中点击「拍照」。",
          },
          label: "Foto aufnehmen",
        },
        {
          text: {
            de: "Das Bild prüfen und mit «Foto verwenden» übernehmen oder mit «Neu aufnehmen» wiederholen.",
            zh: "检查照片，点「使用此照片」确认，或点「重拍」重新拍摄。",
          },
          label: "Foto verwenden",
        },
        {
          text: {
            de: "Offline zeigt das Foto «Wartet auf Versand»; sobald es übertragen ist, steht dort «Gesendet».",
            zh: "离线时照片显示「等待发送」；发送完成后会显示「已发送」。",
          },
          label: "Wartet auf Versand",
        },
        {
          text: {
            de: "Ein vorhandenes Foto lässt sich mit «Foto ersetzen» austauschen.",
            zh: "已有照片可以用「重新拍照」替换。",
          },
          label: "Foto ersetzen",
        },
      ],
      after: {
        de: "Fotos werden zusätzlich offline gespeichert und später automatisch gesendet.",
        zh: "照片也会保存在离线缓存中，之后自动发送。",
      },
      route: "/de/driver/stops/[stopId]",
    },
    {
      id: "tour-abschliessen",
      area: "fahrer",
      title: { de: "Tour abschließen", zh: "结束配送线路" },
      summary: {
        de: "Nach dem letzten Stopp zurück zum Depot und die Tour abschließen.",
        zh: "送完最后一站后返回仓库并结束线路。",
      },
      path: {
        de: "Heutige Tour → «Alle Stopps erledigt» → «Zurück zum Depot»",
        zh: "今日行程 →「所有站点已完成」→「返回仓库」",
      },
      search: {
        de: [
          "tour abschließen",
          "alle stopps erledigt",
          "zurück zum depot",
          "tour beenden",
          "abschluss",
        ],
        zh: ["结束线路", "所有站点已完成", "返回仓库", "完成配送"],
      },
      steps: [
        {
          text: {
            de: "Alle Stopps abarbeiten, bis «Alle Stopps erledigt» erscheint.",
            zh: "完成所有站点，直到出现「所有站点已完成」。",
          },
          label: "Alle Stopps erledigt",
        },
        {
          text: {
            de: "Zurück zum Depot fahren und «Zurück zum Depot» antippen.",
            zh: "返回仓库后点击「返回仓库」。",
          },
          label: "Zurück zum Depot",
        },
        {
          text: {
            de: "Die Zusammenfassung lesen; die Tour ist jetzt abgeschlossen.",
            zh: "查看汇总信息，线路就结束了。",
          },
        },
      ],
      after: {
        de: "Nach dem Abschluss lässt sich an der Tour nichts mehr ändern. Kommen später Bestellungen dazu, erstellt das Büro eine Folgetour.",
        zh: "线路结束后就不能再修改。如果之后又有订单，办公室会创建补充线路。",
      },
      route: "/de/driver",
    },
    {
      id: "offline-arbeiten",
      area: "fahrer",
      title: { de: "Offline arbeiten", zh: "离线工作" },
      summary: {
        de: "Ohne Internet liefern: Eingaben werden gespeichert und später automatisch gesendet.",
        zh: "在没有网络时配送：操作会先保存，稍后自动发送。",
      },
      path: {
        de: "Fahrer-App → «Übertragung und Hinweise öffnen»",
        zh: "司机应用 →「打开同步与提示」",
      },
      search: {
        de: [
          "offline",
          "offline bereit",
          "wartet auf übertragung",
          "jetzt senden",
          "hinweise",
          "ohne internet",
        ],
        zh: ["离线", "已可离线使用", "等待发送", "立即发送", "提示"],
      },
      steps: [
        {
          text: {
            de: "Zeigt die App «Offline bereit ✓», liegt die heutige Tour vollständig auf dem Handy.",
            zh: "如果应用显示「已可离线使用 ✓」，说明今天的线路已完整保存在手机上。",
          },
          label: "Offline bereit ✓",
        },
        {
          text: {
            de: "Eingaben funktionieren weiter; sie stehen dann unter «Wartet auf Übertragung».",
            zh: "操作仍然可以继续，之后会显示在「等待发送」中。",
          },
          label: "Wartet auf Übertragung",
        },
        {
          text: {
            de: "Mit «Jetzt senden» alles sofort übertragen, sobald wieder Internet da ist.",
            zh: "恢复网络后点「立即发送」，立即把所有内容发送出去。",
          },
          label: "Jetzt senden",
        },
        {
          text: {
            de: "Unter «Hinweise» erklärt die App, wenn das Büro einen Stopp geändert hat oder eine Eingabe nicht übernommen wurde.",
            zh: "在「提示」中，应用会说明办公室是否修改了站点，或某次操作是否未被采用。",
          },
          label: "Hinweise",
        },
      ],
      after: {
        de: "Ohne Internet werden höchstens 50 Einträge, 256 KiB und 24 Stunden gepuffert. Danach muss wieder eine Verbindung bestehen.",
        zh: "离线时最多缓存 50 条记录、256 KiB、24 小时。超过后需要重新联网。",
      },
      route: "/de/driver",
    },
    {
      id: "app-installieren",
      area: "fahrer",
      title: { de: "App installieren", zh: "安装应用" },
      summary: {
        de: "Die App auf dem Startbildschirm des Handys ablegen, damit sie wie eine App startet.",
        zh: "把应用添加到手机主屏幕，让它像普通应用一样启动。",
      },
      path: {
        de: "Fahrer-App → «App installieren» → «Installieren» / «So geht's»",
        zh: "司机应用 →「安装应用」→「安装」/「查看方法」",
      },
      search: {
        de: [
          "app installieren",
          "installieren",
          "home bildschirm",
          "zum home-bildschirm",
          "so geht's",
          "pwa",
        ],
        zh: ["安装应用", "添加到主屏幕", "查看方法", "安装"],
      },
      steps: [
        {
          text: {
            de: "Den Hinweis «App installieren» öffnen.",
            zh: "打开「安装应用」提示。",
          },
          label: "App installieren",
        },
        {
          text: {
            de: "Auf Android «Installieren» antippen.",
            zh: "在 Android 上点击「安装」。",
          },
          label: "Installieren",
        },
        {
          text: {
            de: "Auf dem iPhone «So geht's» öffnen und die drei Schritte befolgen (Teilen → «Zum Home-Bildschirm» → «Hinzufügen»).",
            zh: "在 iPhone 上点「查看方法」并按照三个步骤操作（分享 →「添加到主屏幕」→「添加」）。",
          },
          label: "So geht's",
        },
        {
          text: {
            de: "Mit «Nicht jetzt» lässt sich der Hinweis überspringen.",
            zh: "点「暂不」可以跳过该提示。",
          },
          label: "Nicht jetzt",
        },
      ],
      after: {
        de: "Eine installierte App startet schneller und funktioniert besser offline.",
        zh: "安装后的应用启动更快，离线时也更可靠。",
      },
      route: "/de/driver",
    },

    // ── System & Fehler ──────────────────────────────────────────────────────────────────────
    {
      id: "fehler-etwas-ist-schiefgelaufen",
      area: "system",
      title: { de: "«Etwas ist schiefgelaufen» erscheint", zh: "出现「出错了」时怎么办" },
      summary: {
        de: "Was tun, wenn eine Seite nicht geladen werden kann und eine Fehler-ID angezeigt wird.",
        zh: "当页面无法加载并显示错误编号时该怎么做。",
      },
      path: {
        de: "Fehlerseite → «Erneut versuchen» / «Fehler-ID»",
        zh: "错误页面 →「重试」/「错误编号」",
      },
      search: {
        de: [
          "etwas ist schiefgelaufen",
          "fehler",
          "fehler-id",
          "seite lädt nicht",
          "error",
          "absturz",
        ],
        zh: ["出错了", "错误", "错误编号", "页面打不开", "报错"],
      },
      steps: [
        {
          text: {
            de: "Zuerst «Erneut versuchen» antippen bzw. klicken — meistens genügt das.",
            zh: "先点击「重试」——通常这样就能解决。",
          },
          label: "Etwas ist schiefgelaufen",
        },
        {
          text: {
            de: "Bleibt der Fehler, die Seite neu laden; bereits gespeicherte Daten sind nicht betroffen.",
            zh: "如果仍然出错，请重新加载页面；已保存的数据不受影响。",
          },
          label: "Erneut versuchen",
        },
        {
          text: {
            de: "Im Büro steht unter der Meldung «Fehler-ID: {digest}». Diese Nummer beim Melden angeben.",
            zh: "办公室界面在提示下方显示「错误编号：{digest}」。报告问题时请提供这个编号。",
          },
          label: "Fehler-ID",
        },
      ],
      after: {
        de: "Die Fehler-ID hilft dem Support, den Vorfall im Protokoll zu finden.",
        zh: "错误编号可以帮助技术支持在日志中找到这次故障。",
      },
      route: "/de/admin",
    },
    {
      id: "offline-nicht-verfuegbar",
      area: "system",
      title: {
        de: "Keine Verbindung / «Offline nicht verfügbar»",
        zh: "没有网络 /「无法离线使用」",
      },
      summary: {
        de: "Was es bedeutet, wenn offline keine Tour gespeichert ist.",
        zh: "离线时没有保存线路是什么意思。",
      },
      path: {
        de: "Fahrer-App → «Offline nicht verfügbar» / «Keine gespeicherte Tour»",
        zh: "司机应用 →「无法离线使用」/「没有已保存的行程」",
      },
      search: {
        de: [
          "offline nicht verfügbar",
          "keine gespeicherte tour",
          "keine verbindung",
          "offline",
          "kein netz",
        ],
        zh: ["无法离线使用", "没有已保存的行程", "没有网络连接", "离线"],
      },
      steps: [
        {
          text: {
            de: "Erscheint «Offline nicht verfügbar», konnte die Tour nicht für offline gespeichert werden.",
            zh: "如果出现「无法离线使用」，说明线路没能保存到离线缓存。",
          },
          label: "Offline nicht verfügbar",
        },
        {
          text: {
            de: "Steht «Keine gespeicherte Tour», gab es vor dem Verbindungsverlust keine gespeicherte Tour.",
            zh: "如果显示「没有已保存的行程」，说明断网之前没有保存过线路。",
          },
          label: "Keine gespeicherte Tour",
        },
        {
          text: {
            de: "Mit Internet verbinden, die App neu öffnen und «Erneut versuchen» antippen.",
            zh: "连接网络，重新打开应用，然后点击「重试」。",
          },
          label: "Erneut versuchen",
        },
      ],
      after: {
        de: "Bei bestehender Verbindung zeigt die App «Offline bereit ✓», sobald die Tour gespeichert ist.",
        zh: "在有网络的情况下，线路保存完成后应用会显示「已可离线使用 ✓」。",
      },
      route: "/de/driver/offline-shell",
    },
    {
      id: "karte-leer",
      area: "system",
      title: { de: "Karte bleibt leer", zh: "地图空白" },
      summary: {
        de: "Warum der Kartenhintergrund fehlen kann, obwohl Stopps und Route da sind.",
        zh: "为什么地图背景可能不显示，但站点和线路仍然存在。",
      },
      path: {
        de: "Karte → Hinweis «Kartenhintergrund nicht verfügbar»",
        zh: "地图 → 提示「地图背景暂时无法加载」",
      },
      search: {
        de: [
          "karte leer",
          "kartenhintergrund",
          "kartenhintergrund nicht verfügbar",
          "offline karte",
          "kacheln",
        ],
        zh: ["地图空白", "地图背景", "离线地图", "地图不显示"],
      },
      steps: [
        {
          text: {
            de: "Bleibt der Hintergrund weiß, steht dort «Kartenhintergrund nicht verfügbar».",
            zh: "如果背景是空白的，会显示「地图背景暂时无法加载」。",
          },
          label: "Kartenhintergrund nicht verfügbar",
        },
        {
          text: {
            de: "Offline lautet der Hinweis «Kartenhintergrund offline nicht verfügbar».",
            zh: "离线时提示为「离线时无法显示地图背景」。",
          },
          label: "Kartenhintergrund offline nicht verfügbar",
        },
        {
          text: {
            de: "Wichtig: «Stopps, Depot und Route werden weiterhin angezeigt.» Die Tour bleibt also benutzbar.",
            zh: "请注意：「站点、仓库和线路仍会显示。」所以线路仍然可以使用。",
          },
          label: "Stopps, Depot und Route werden weiterhin angezeigt.",
        },
      ],
      after: {
        de: "Der Kartenhintergrund kommt aus dem Internet; ohne Verbindung oder bei einem Anbieterproblem bleibt er leer.",
        zh: "地图背景来自网络；没有连接或服务商出问题时就会空白。",
      },
      route: "/de/driver",
    },
    {
      id: "naeherungswerte",
      area: "system",
      title: { de: "«Näherungswerte» erklären", zh: "「估算值」是什么意思" },
      summary: {
        de: "Warum Zeiten, Entfernungen und die Linie nur ungefähr sind.",
        zh: "为什么时间、距离和线路只是大致数值。",
      },
      path: {
        de: "Tour → Abzeichen «Näherungswerte»",
        zh: "线路 →「估算值」标记",
      },
      search: {
        de: ["näherungswerte", "geschätzt", "kein routing", "strecke", "ungefähr", "approximation"],
        zh: ["估算值", "估算", "路线服务", "大致数值"],
      },
      steps: [
        {
          text: {
            de: "In der Tour das Abzeichen «Näherungswerte» suchen.",
            zh: "在线路页面找到「估算值」标记。",
          },
          label: "Näherungswerte",
        },
        {
          text: {
            de: "Beim Darüberfahren bzw. Antippen erscheint «Die Strecke wurde geschätzt (kein Routing-Dienst): Zeiten, Entfernungen und Linie sind nur ungefähr.»",
            zh: "鼠标悬停或点击时会显示「配送线路是估算的（未使用路线服务）：时间、距离和线路都只是大致数值。」",
          },
          label:
            "Die Strecke wurde geschätzt (kein Routing-Dienst): Zeiten, Entfernungen und Linie sind nur ungefähr.",
        },
      ],
      after: {
        de: "Sobald ein Routing-Dienst verbunden ist, verschwindet das Abzeichen und die Werte werden genauer.",
        zh: "接入路线服务后，该标记会消失，数值也会更准确。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "tour-nicht-erstellbar",
      area: "system",
      title: { de: "Warum keine Tour erstellt werden kann", zh: "为什么无法生成配送线路" },
      summary: {
        de: "Die drei häufigen Gründe: kein Depot-Standort, keine Stopps, zu viele Stopps.",
        zh: "三个常见原因：没有仓库位置、没有站点、站点太多。",
      },
      path: {
        de: "Touren → «Tour erstellen» → Fehlermeldung",
        zh: "配送线路 →「生成配送线路」→ 错误提示",
      },
      search: {
        de: [
          "tour nicht erstellt",
          "depot pin",
          "keine stopps",
          "zu viele stopps",
          "tour erstellen fehler",
        ],
        zh: ["无法生成", "仓库位置", "没有站点", "站点太多"],
      },
      steps: [
        {
          text: {
            de: "Meldet die App «Der Depot-Standort ist noch nicht bestätigt», zuerst in den «Einstellungen» den Depot-Standort bestätigen.",
            zh: "如果提示「仓库位置尚未确认」，请先在「设置」中确认仓库位置。",
          },
          label:
            "Der Depot-Standort ist noch nicht bestätigt. Solange das so ist, können keine Touren erstellt werden.",
        },
        {
          text: {
            de: "Erscheint «Keine Stopps», gibt es keine bestätigten Bestellungen mit Parkplatz oder Adresspunkt für diesen Tag.",
            zh: "如果出现「没有站点」，说明该日期没有已确认订单且有停车位或地址点的客户。",
          },
          label: "Keine Stopps",
        },
        {
          text: {
            de: "Erscheint «Zu viele Stopps», die Tour auf zwei Fahrzeuge bzw. zwei Touren aufteilen.",
            zh: "如果出现「站点太多」，请把线路分到两辆车或两条线路上。",
          },
          label: "Zu viele Stopps",
        },
      ],
      after: {
        de: "Ein Kunde ohne Parkplatz und ohne Adresspunkt ist der häufigste Grund, warum eine Bestellung in keiner Tour landet.",
        zh: "客户既没有停车位也没有地址点，是订单无法进入线路的最常见原因。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "kunde-nicht-in-tour",
      area: "system",
      title: { de: "Warum ein Kunde nicht in der Tour ist", zh: "为什么客户不在线路中" },
      summary: {
        de: "Bestätigte Bestellung, aber der Kunde fehlt in der Tour — meistens, weil weder Parkplatz noch Adresspunkt vorhanden ist.",
        zh: "订单已确认但客户不在线路中——通常是因为既没有停车位也没有地址点。",
      },
      path: {
        de: "Touren → Hinweis «Nicht in der Tour: kein Parkplatz und kein Adresspunkt»",
        zh: "配送线路 → 提示「未纳入配送线路：没有停车位和地址点」",
      },
      search: {
        de: [
          "kunde nicht in der tour",
          "kein parkplatz",
          "kein adresspunkt",
          "nicht in der tour",
          "warnung tour",
        ],
        zh: ["客户不在线路中", "没有停车位", "未纳入配送线路"],
      },
      steps: [
        {
          text: {
            de: "In der Tour den Abschnitt «Nicht in der Tour: kein Parkplatz und kein Adresspunkt» lesen.",
            zh: "在线路页面查看「未纳入配送线路：没有停车位和地址点」部分。",
          },
          label: "Nicht in der Tour: kein Parkplatz und kein Adresspunkt",
        },
        {
          text: {
            de: "Über «Kunde öffnen» zum Kunden springen.",
            zh: "点击「打开客户」跳转到该客户。",
          },
          label: "Kunde öffnen",
        },
        {
          text: {
            de: "Dort über «Parkplatz hinzufügen» einen Parkplatz festlegen (oder die Adresse korrigieren und speichern).",
            zh: "在那里通过「添加停车位」设置停车位（或更正地址后保存）。",
          },
          label: "Parkplatz hinzufügen",
        },
        {
          text: {
            de: "Zurück zur Tour und mit «Tour erstellen» bzw. «Neu optimieren» neu rechnen.",
            zh: "返回线路，用「生成配送线路」或「重新优化」重新计算。",
          },
          label: "Tour erstellen",
        },
      ],
      after: {
        de: "Sobald ein Parkplatz oder ein Adresspunkt vorhanden ist, nimmt die Tour den Kunden auf.",
        zh: "只要有停车位或地址点，线路就会纳入该客户。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "betrieb-health-support",
      area: "system",
      title: { de: "Betrieb: Zustandsprüfung und Kontakt", zh: "运维：健康检查与联系方式" },
      summary: {
        de: "Wie der Betrieb prüft, ob Datenbank und Dateispeicher laufen, und wen man bei Problemen fragt.",
        zh: "运维如何检查数据库和文件存储是否正常，以及遇到问题时联系谁。",
      },
      path: {
        de: "Browser → «/api/health» (Betrieb) / Büro → Support",
        zh: "浏览器 →「/api/health」（运维）/ 办公室 → 技术支持",
      },
      search: {
        de: ["health", "zustandsprüfung", "betrieb", "support", "kontakt", "server", "api health"],
        zh: ["健康检查", "运维", "技术支持", "联系", "服务器"],
      },
      steps: [
        {
          text: {
            de: 'Im Browser «/api/health» öffnen; die Antwort enthält «"status":"ok"», wenn Datenbank und Speicher laufen.',
            zh: '在浏览器中打开「/api/health」；如果数据库和存储正常，返回内容会包含「"status":"ok"」。',
          },
          label: "status",
        },
        {
          text: {
            de: "Meldet die Anwendung einen Fehler, dem Support die «Fehler-ID» aus der Fehlermeldung nennen.",
            zh: "如果应用报错，请把错误提示中的「错误编号」告诉技术支持。",
          },
          label: "Fehler-ID",
        },
        {
          text: {
            de: "Für Inhalts- und Zugangsfragen den Admin des Betriebs kontaktieren.",
            zh: "有关内容和账号的问题，请联系运营方的管理员。",
          },
        },
      ],
      after: {
        de: "Der Zustandsendpunkt ist die erste Prüfung nach einem Neustart des Servers.",
        zh: "服务器重启后，健康检查端点是第一个要查看的地方。",
      },
      route: "/api/health",
    },
    {
      id: "funktionen-die-es-nicht-gibt",
      area: "system",
      title: { de: "Diese Funktionen gibt es nicht", zh: "这些功能并不存在" },
      summary: {
        de: "Was die App bewusst nicht kann — damit niemand lange danach sucht.",
        zh: "应用刻意没有的功能——免得大家反复查找。",
      },
      path: {
        de: "Hilfe → «Diese Funktionen gibt es nicht»",
        zh: "帮助 →「这些功能并不存在」",
      },
      search: {
        de: [
          "passwort vergessen",
          "passwort ändern",
          "waren-typ",
          "rechnung",
          "vorlage",
          "unterschrift",
          "fehlmenge",
          "zeitfenster",
          "waren typ",
        ],
        zh: ["忘记密码", "修改密码", "发票", "模板", "签名", "时间段"],
      },
      steps: [
        {
          text: {
            de: "Es gibt kein «Passwort vergessen» und kein Ändern des Büro-Passworts. Ein Admin legt mit «Admin anlegen» ein neues Konto an.",
            zh: "应用没有「忘记密码」，也不能修改办公室密码。管理员可通过「新增管理员」创建新账号。",
          },
          label: "Admin anlegen",
        },
        {
          text: {
            de: "Es gibt keinen «Waren-Typ». Das Produkt heißt «Produkt» und wird unter «Produkte» mit «Neues Produkt» angelegt.",
            zh: "应用中没有「Waren-Typ」。这类对象叫「产品」，在「产品」页面用「新建产品」创建。",
          },
          label: "Neues Produkt",
        },
        {
          text: {
            de: "Es gibt keine Rechnungen, Belege oder Sammelrechnungen, keine Tour-Vorlagen, keine Unterschriftenerfassung, kein Feld für Fehlmengen und keine Kapazitätsplanung.",
            zh: "应用没有发票、凭证或汇总账单，没有线路模板，没有签名采集，没有缺货数量字段，也没有产能规划。",
          },
        },
        {
          text: {
            de: "«Lieferzeiten» sind freier Text und keine festen Zeitfenster. Rollen sind nur «Büro» und «Fahrer» — einen Rolleneditor gibt es nicht.",
            zh: "「收货时间」是自由文本，不是固定的时间段。角色只有「办公室」和「司机」——没有角色编辑器。",
          },
          label: "Lieferzeiten",
        },
        {
          text: {
            de: "Bezahlte Bestellungen, ihre Touren und Monatsrechnungen werden 30 Tage nach der Bezahlung automatisch und endgültig gelöscht, sobald das Löschen auf dem Server eingeschaltet ist. Was nicht bezahlt ist, bleibt. Kunden, Produkte und Einstellungen bleiben immer. Fotos, Protokolleinträge und Fahrertexte werden nach längerer Zeit automatisch aufgeräumt.",
            zh: "服务器上开启自动删除后，已付款的订单及其线路和月度账单会在付款 30 天后被自动永久删除。未付款的会保留。客户、产品和设置始终保留。照片、日志记录和司机文本会在较长时间之后被自动清理。",
          },
          label: "Löschen",
        },
      ],
      after: {
        de: "Wer eine dieser Funktionen braucht, wendet sich an das Büro — sie sind bewusst nicht Teil der App.",
        zh: "如果需要其中某项功能，请联系办公室——它们是有意不放进这个应用的。",
      },
    },

    // ── Zusätzliche Themen (§8.1 Nr. 49 und Nr. 50) ──────────────────────────────────────────
    {
      id: "ladeliste-lesen",
      area: "buero",
      title: { de: "Ladeliste lesen und verstehen", zh: "读懂装车单" },
      summary: {
        de: "Die zwei Abschnitte der Ladeliste richtig benutzen und die Warnung ernst nehmen.",
        zh: "正确使用装车单的两个部分，并重视警告提示。",
      },
      path: {
        de: "Touren → Tour → «Ladeliste drucken» → Abschnitte «1. Gesamtmenge pro Produkt» und «2. Beladereihenfolge»",
        zh: "配送线路 → 线路 →「打印装车单」→「1. 各产品总数量」和「2. 装车顺序」",
      },
      search: {
        de: [
          "ladeliste lesen",
          "ladeliste",
          "beladereihenfolge",
          "gesamtmenge pro produkt",
          "beladen",
          "a4",
        ],
        zh: ["装车单", "装车顺序", "总数量", "装车", "A4"],
      },
      steps: [
        {
          text: {
            de: "Abschnitt «1. Gesamtmenge pro Produkt» zeigt, wie viel von jeder Sorte insgesamt eingeladen wird.",
            zh: "「1. 各产品总数量」显示每种面条总共要装多少。",
          },
          label: "1. Gesamtmenge pro Produkt",
        },
        {
          text: {
            de: "Abschnitt «2. Beladereihenfolge» zeigt die Stopps in Lade-Reihenfolge.",
            zh: "「2. 装车顺序」按装车顺序列出各个站点。",
          },
          label: "2. Beladereihenfolge",
        },
        {
          text: {
            de: "Merksatz beachten: «Der letzte Stopp wird zuerst eingeladen, der erste Stopp zuletzt (liegt dann oben).»",
            zh: "记住这条规则：「最后一站最先装车，第一站最后装车（放在最上面）。」",
          },
          label: "Der letzte Stopp wird zuerst eingeladen, der erste Stopp zuletzt",
        },
        {
          text: {
            de: "Steht die Warnung «ACHTUNG: Bestellungen wurden nach der Freigabe dieser Tour geändert.», erst die Tour erneut freigeben und dann beladen.",
            zh: "如果出现警告「注意：此线路发布后订单已变更。」，请先重新发布线路再装车。",
          },
          label: "ACHTUNG: Bestellungen wurden nach der Freigabe dieser Tour geändert.",
        },
      ],
      after: {
        de: "Die Ladeliste ist für A4 mit 12 mm Rand gedacht und wird im gewählten Druckformat ausgegeben.",
        zh: "装车单按 A4、12 毫米页边距设计，按所选的打印语言输出。",
      },
      route: "/de/admin/tours",
    },
    {
      id: "bedienung-bildschirm",
      area: "system",
      title: { de: "Bedienung am Bildschirm", zh: "屏幕上的基本操作" },
      summary: {
        de: "Seitenleiste, Menü, Seitensuche, Toasts und ungespeicherte Änderungen.",
        zh: "侧边栏、菜单、页面搜索、提示消息和未保存的更改。",
      },
      path: {
        de: "Büro-Oberfläche → Kopfzeile / Seitenleiste / Tastatur",
        zh: "办公室界面 → 页头 / 侧边栏 / 键盘",
      },
      search: {
        de: [
          "seitenleiste",
          "menü",
          "seitensuche",
          "toast",
          "ungespeicherte änderungen",
          "verwerfen",
          "tastatur",
        ],
        zh: ["侧边栏", "菜单", "页面搜索", "提示消息", "未保存的更改", "放弃更改"],
      },
      steps: [
        {
          text: {
            de: "Mit «Seitenleiste einklappen» bzw. «Seitenleiste ausklappen» mehr Platz für Tabellen schaffen.",
            zh: "用「收起侧边栏」或「展开侧边栏」为表格腾出更多空间。",
          },
          label: "Seitenleiste einklappen",
        },
        {
          text: {
            de: "In schmalen Fenstern die Navigation über «Menü öffnen» aufklappen.",
            zh: "在窄窗口中用「打开菜单」展开导航。",
          },
          label: "Menü öffnen",
        },
        {
          text: {
            de: "Die Taste «/» springt direkt in die Seitensuche; mit Esc wieder verlassen.",
            zh: "按「/」键可直接跳到页面搜索；按 Esc 退出。",
          },
          label: "Suche",
        },
        {
          text: {
            de: "Ergebnisse erscheinen als Toast unten; Hinweise quittiert man mit «Verstanden».",
            zh: "操作结果会以提示消息显示在下方；提示用「我知道了」确认。",
          },
          label: "Verstanden",
        },
        {
          text: {
            de: "Beim Verlassen eines Formulars warnt «Ungespeicherte Änderungen»; mit «Verwerfen» gehen sie verloren.",
            zh: "离开表单时会警告「有未保存的更改」；点「放弃更改」会丢失这些更改。",
          },
          label: "Ungespeicherte Änderungen",
        },
      ],
      after: {
        de: "Alle Formulare speichern erst mit dem ausdrücklichen Speichern-Knopf.",
        zh: "所有表单都需要点击明确的保存按钮才会保存。",
      },
      route: "/de/admin",
    },

    // ── Glossar ──────────────────────────────────────────────────────────────────────────────
    {
      id: "glossar",
      area: "glossar",
      title: { de: "Begriffe (Glossar) Deutsch ↔ 简体中文", zh: "术语表：德语 ↔ 简体中文" },
      summary: {
        de: "Die wichtigsten deutschen Begriffe aus der App und von gedruckten Listen auf Chinesisch.",
        zh: "应用界面和打印清单上最重要的德语术语及其中文含义。",
      },
      path: {
        de: "Hilfe → «Begriffe (Glossar)»",
        zh: "帮助 →「术语表」",
      },
      search: {
        de: ["glossar", "begriffe", "wörterbuch", "übersetzung begriffe", "ladeliste begriffe"],
        zh: ["术语表", "词汇", "对照表", "翻译", "德语词汇"],
      },
      steps: [
        {
          text: {
            de: "Im Glossar den deutschen Begriff suchen, den man auf dem Bildschirm oder auf der Ladeliste sieht.",
            zh: "在术语表中查找你在屏幕或装车单上看到的德语词。",
          },
          label: "Suche",
        },
        {
          text: {
            de: "Die chinesische Bedeutung lesen; UI-Beschriftungen bleiben immer deutsch.",
            zh: "查看对应的中文含义；界面上的德语标注始终保留德语。",
          },
        },
        {
          text: {
            de: "Beachten: «Touren» heißt im Büro 配送线路 und in der Fahrer-App 行程 — beide Wörter sind richtig.",
            zh: "注意：「Touren」在办公室界面是「配送线路」，在司机应用中是「行程」——两种说法都对。",
          },
        },
      ],
      after: {
        de: "Die chinesischen Texte dieser Hilfe sind noch nicht von einem Muttersprachler geprüft.",
        zh: "本帮助页的中文文本尚未经过母语者审校。",
      },
      route: "/hand-off.html",
    },
  ],
  glossary: [
    { de: "Büro", zh: "办公室" },
    { de: "Fahrer", zh: "司机" },
    { de: "Übersicht", zh: "总览" },
    { de: "Bestellungen", zh: "订单" },
    { de: "Produkt (in einer Bestellung)", zh: "订单中的产品" },
    { de: "Touren (Büro)", zh: "配送线路" },
    { de: "Tour (Fahrer)", zh: "行程" },
    { de: "Stopp", zh: "站点" },
    { de: "Tour planen", zh: "规划行程" },
    { de: "Tour erstellen", zh: "生成配送线路" },
    { de: "Freigabe / freigeben", zh: "发布" },
    { de: "Erneut freigeben", zh: "重新发布" },
    { de: "Folgetour", zh: "补充线路" },
    { de: "Nachbestellung", zh: "补单" },
    { de: "Kunde", zh: "客户" },
    { de: "Kundennummer", zh: "客户编号" },
    { de: "Produkt / Nudelsorte", zh: "产品" },
    { de: "Artikelnummer (SKU)", zh: "货号（SKU）" },
    { de: "Einheit", zh: "单位" },
    { de: "kg", zh: "公斤" },
    { de: "Sackerl", zh: "袋" },
    { de: "Kiste", zh: "纸箱" },
    { de: "Stück", zh: "件" },
    { de: "Menge", zh: "数量" },
    { de: "Lieferdatum", zh: "送货日期" },
    { de: "Liefertag", zh: "送货日" },
    { de: "Lieferung", zh: "送货内容" },
    { de: "Lieferadresse", zh: "送货地址" },
    { de: "Lieferzeiten", zh: "送货时间" },
    { de: "Problem", zh: "问题" },
    { de: "Problem melden", zh: "报告问题" },
    { de: "Grund", zh: "原因" },
    { de: "Notiz", zh: "备注" },
    { de: "Interne Notiz", zh: "内部备注" },
    { de: "Hinweis", zh: "提示" },
    { de: "Archiv / archivieren", zh: "归档" },
    { de: "Import", zh: "导入" },
    { de: "Ladeliste", zh: "装车单" },
    { de: "Foto", zh: "照片" },
    { de: "Synchronisierung", zh: "同步" },
    { de: "Offline", zh: "离线" },
    { de: "Adresspunkt", zh: "地址点" },
    { de: "Parkplatz", zh: "停车位" },
    { de: "Adresse suchen", zh: "查找地址" },
    { de: "Depot / Fabrik", zh: "仓库（工厂）" },
    { de: "Einstellungen", zh: "设置" },
    { de: "Berechtigung", zh: "权限" },
    { de: "Verlauf", zh: "变更记录" },
    { de: "Entwurf", zh: "草稿" },
    { de: "Bestätigt", zh: "已确认" },
    { de: "Storniert", zh: "已取消" },
    { de: "Freigegeben", zh: "已发布" },
    { de: "Abgeschlossen", zh: "已完成" },
    { de: "Offen", zh: "待送" },
    { de: "Geliefert", zh: "已送达" },
    { de: "Standard-Abfahrtszeit", zh: "默认出发时间" },
    { de: "Zeitzone", zh: "时区" },
    { de: "Summen", zh: "合计" },
    { de: "Kennzahlen", zh: "关键指标" },
    { de: "Zu erledigen", zh: "待处理" },
    { de: "Letzte Aktivität", zh: "最近活动" },
    { de: "Nächster Stopp", zh: "下一站" },
    { de: "Navigation starten", zh: "开始导航" },
    { de: "Foto aufnehmen", zh: "拍照" },
    { de: "Gesendet", zh: "已发送" },
    { de: "Wartet auf Versand", zh: "等待发送" },
    { de: "Rückgängig", zh: "撤销" },
    { de: "Anmerkung", zh: "补充说明" },
    { de: "Screenshot", zh: "截图" },
    { de: "Manuell", zh: "手动录入" },
    { de: "PIN", zh: "PIN码" },
    { de: "PIN zurücksetzen", zh: "重置PIN码" },
    { de: "Passwort", zh: "密码" },
    { de: "Benutzername", zh: "用户名" },
    { de: "E-Mail", zh: "电子邮箱" },
    { de: "Anmelden", zh: "登录" },
    { de: "Abmelden", zh: "退出登录" },
    { de: "Sprache", zh: "语言" },
    { de: "Administratoren", zh: "管理员" },
    { de: "Gesamtmenge", zh: "总数量" },
    { de: "Beladereihenfolge", zh: "装车顺序" },
    { de: "Gesamtmenge pro Produkt", zh: "各产品总数量" },
    { de: "Laden", zh: "装车" },
    { de: "Freigabe-Version", zh: "发布版本" },
  ],
};
