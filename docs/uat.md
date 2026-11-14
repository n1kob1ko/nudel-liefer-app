# User acceptance test (UAT) – NUD-096

A test script for the office and for the drivers. A person who is not a developer can run it.
At the end the client decides whether the app is accepted (sign-off block, section 7).

**Status of this document:** prepared by the development agent. No step has been run yet, no result
and no sign-off is recorded here. The sign-off must be entered by the client, never by the developer
or the agent.

Contents: 1 How to use this script, 2 Preconditions and test data, 3 Office script, 4 Driver script,
5 Feedback form, 6 Device matrix, 7 Sign-off, 8 How the agent converts feedback into tickets,
9 Pre-UAT checklist for the developer, 10 Known open items.

## 1. How to use this script

- **Who:** the office tests part 3 (one or two people who really enter orders), at least one real
  driver per language that will be used tests part 4. A helper (the developer or a colleague) sits
  next to a driver and reads the steps out in the driver's language; the driver does the tapping.
  Do not explain the app to the driver before he has tried: watch where he hesitates.
- **Time:** part 3 about 90 minutes, part 4 about 60 minutes per driver (incl. install and the
  offline tests). Run part 3 first on the same day, because the driver sees only the tour of **today**.
- **Step IDs:** `O-nn` = office, `D-nn` = driver, `X-nn` = both together. Use the ID in the feedback
  form (section 5).
- **Words in quotes** ("Kunden", "Tour freigeben") are the German texts exactly as the app shows
  them. The office works in German. Drivers see the app in their own language: the helper tells
  them which button is meant (the German name in this script is the key, the screen shows the
  Chinese or German text of the same button).
- **Pass / fail:** tick `[x]` in the column. A step passes only when the **expected** result is seen.
  If it fails or something looks odd, write the step ID into the feedback table with a short
  comment. A screenshot or a phone video helps a lot (do not put real customer data into anything
  that is shared outside the company).
- **Do not fix things during the test.** Write them down, go on. If a step blocks the rest, note
  the ID, mark the dependent steps "skipped" and go on with the next part.
- **Severity** (used in the feedback form):
  - **S1 Blocker:** wrong or missing quantity/stop/photo shown to the driver, data lost, a task
    cannot be done at all.
  - **S2 Major:** the task works only with a workaround, or the user is badly confused.
  - **S3 Minor:** cosmetic problem, unclear or unnatural wording.
  - **S4 Wish:** nice to have, not a defect.

## 2. Preconditions and test data

### 2.1 Environment

Run the UAT on a deployed build (HTTPS, real phones cannot test an install or offline use on
`localhost`). Use a **separate UAT database**, or the production deployment before real operation
starts, with the data prepared as in 2.2. Write down the address and the build number:

| Item                                                                       | Value   |
| -------------------------------------------------------------------------- | ------- |
| App address (e.g. `https://<host>`)                                        |         |
| Build / release (shown in `https://<host>/api/health` as `release`)        |         |
| `/api/health` shows `"status": "ok"`                                       | [ ] yes |
| Date and time zone of the test day (factory time, default `Europe/Vienna`) |         |

The developer finishes the checklist in section 9 before the session.

### 2.2 Data: two ways to prepare

**Way A – demo data (dry run, or when the client's data is not ready).** Never on production.
On the UAT environment, with its `DATABASE_URL` and `S3_*` variables set (see `docs/env.md`,
section "Demo data", and `docs/demo.md`):

```
pnpm db:migrate
pnpm db:seed --demo --today
```

`--today` creates the orders for **today**, so the driver sees the tour right away (without it the
orders are for the next delivery day and the whole script must run on that day). The command is safe
to run again. It creates: the depot "Nudelfabrik Wien (Demo)" (pin confirmed), 20 customers
`D-001` to `D-020` with entrance and parking photos, 3 products (Nudeln Sackerl, Nudeln Kiste, Wantan-Teig) with names in all five languages, one
confirmed order per customer for the date it prints, an admin `admin@example.com` (password =
`SEED_ADMIN_PASSWORD`) and the driver accounts `fahrer-de`, `driver-hans`, `driver-en`, `driver-sr`, `driver-cs`
(language already chosen) and `driver-new` (**no language chosen yet: shows the language picker**).
All demo drivers use the PIN `123456` (or `SEED_DRIVER_PIN`). Real drivers must **not** use these
accounts: the office creates their own accounts in step O-100.

**Way B – the client's real data (preferred for the real UAT).** Prepare before the session:

- [ ] Real depot address (office sets it in O-04, backlog section 10).
- [ ] Real product list: article number, unit, German name, Chinese name (Simplified).
- [ ] The existing customer list as CSV or XLSX (used in O-30; it is also the real test of the
      import). Columns like "Kundennummer", "Name", "Straße und Hausnummer", "PLZ", "Ort",
      "Land", "Lieferzeiten", "Hinweise für den Fahrer" (header names may differ; you map them).
- [ ] Photos of at least 5 real customers: one of the entrance and one of the parking/unloading
      place each (JPEG from a phone; or take them in D-12).
- [ ] One real German and one real Chinese order screenshot (WhatsApp/WeChat) for O-50.
- [ ] For production-like data the seed is run **without** `--demo`; set `SEED_DRIVERS=false` so the
      demo drivers do not exist (see `docs/deploy.md` section 7).

### 2.3 People and devices

- [ ] One admin login for each office tester (password known).
- [ ] One driver account per real driver, created in O-100 (note user name and PIN on paper, the PIN
      is shown only once).
- [ ] Devices in the matrix of section 6: at least one Android phone (Chrome) and one iPhone
      (Safari) for the offline and install steps; a desktop browser for the office. Phones have
      mobile data **and** can be switched to airplane mode. The driver uses **his own phone** and
      his usual font-size setting, if he agrees.
- [ ] Printer (or "save as PDF") for O-70.

## 3. Office script (desktop browser, German)

Start at `https://<host>/de/login`. Admin pages are under `/de/admin/...`.

### 3.1 Login and overview

| ID   | Do                                                                                                                                                                                                                     | Expected                                                                                                                                                              | Pass / fail       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-01 | Open `/de/login`. Enter "E-Mail" and "Passwort", press "Anmelden". Try once with a wrong password first.                                                                                                               | Wrong password: "Anmeldung fehlgeschlagen. Bitte Eingaben prüfen." Correct login opens the office area "Übersicht".                                                   | [ ] pass [ ] fail |
| O-02 | Look at "Übersicht" and the menu on the left (on a narrow window: "Menü öffnen").                                                                                                                                      | Menu entries: "Übersicht", "Bestellungen", "Touren", "Kunden", "Produkte", "Fahrer", "Einstellungen". A card "Heute" is shown (e.g. "Für heute gibt es keine Tour."). | [ ] pass [ ] fail |
| O-03 | Change the language in the header to "简体中文" and back to "Deutsch".                                                                                                                                                 | The whole office UI changes language and comes back. No page breaks. (Office works in German; this is a smoke test.)                                                  | [ ] pass [ ] fail |
| O-04 | Open "Einstellungen". Check "Depot (Fabrik)": "Name", "Adresse", location on the map. Correct them to the real depot if needed, tick "Ich habe geprüft, dass der Standort am richtigen Ort liegt.", press "Speichern". | "Einstellungen gespeichert." The status shows "Standort bestätigt". The location is on the real loading place of the factory.                                         | [ ] pass [ ] fail |
| O-05 | In "Einstellungen" check "Planung": "Standard-Abfahrtszeit", "Minuten pro Stopp", "Liefertage".                                                                                                                        | Values fit the real operation. Saved values stay after reloading the page.                                                                                            | [ ] pass [ ] fail |

### 3.2 Products (with Chinese names)

| ID   | Do                                                                                                                                                              | Expected                                                                                                                                                                                                             | Pass / fail       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-10 | Open "Produkte".                                                                                                                                                | List with "Reihenfolge", "Artikelnr.", "Name (Deutsch)", "Name (vereinfacht)", "Einheit", "Gewicht pro Einheit", "Status". The three products (Nudeln Sackerl 3 kg, Nudeln Kiste 10 kg, Wantan-Teig 5 kg) are there. | [ ] pass [ ] fail |
| O-11 | Press "Neues Produkt". Enter "Artikelnummer (SKU)", "Einheit", "Name (Deutsch)" and "Name (vereinfachtes Chinesisch)" (a real Chinese name). Press "Speichern". | "Produkt angelegt." The names in English, Serbian and Czech ("Name (Englisch)", "Name (Serbisch, lateinisch)", "Name (Tschechisch)") are translated automatically when saving (marked "automatisch").                                                    | [ ] pass [ ] fail |
| O-12 | Ask a reader of each language (the driver, or the client) to read the names of the new product in that language.                                                            | The names are correct and natural for the product. Wrong or odd names go to section 5.3 (wording). Every translated name can be edited by hand in the product form.                                                     | [ ] pass [ ] fail |
| O-13 | Move a product with "{name} nach oben" / "{name} nach unten" (the arrow buttons next to the name).                                                              | The order changes. The same order is used in the product choice of a new order (check in O-40).                                                                                                                      | [ ] pass [ ] fail |
| O-14 | Press "Deaktivieren" on a product that has no orders yet.                                                                                                       | "Produkt deaktiviert. Es erscheint nicht mehr bei neuen Bestellungen." "Aktivieren" brings it back ("Produkt wieder aktiviert.").                                                                                    | [ ] pass [ ] fail |

### 3.3 Customers, photos and address points

| ID   | Do                                                                                                                                                                                                                                            | Expected                                                                                                                                                                                                                           | Pass / fail       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-20 | Open "Kunden", press "Neuer Kunde". Fill "Kundennummer", "Name", "Straße und Hausnummer", "PLZ", "Ort". Optionally press "Auf Karte suchen" and choose the right hit under "Gefundene Adresspunkte – bitte einen auswählen". | An address point appears on the map at the address. If you skip the search, the address point is looked up by itself when you save. | [ ] pass [ ] fail |
| O-21 | Fill "Lieferzeiten (Information)" and "Hinweise für den Fahrer" (German). Press "Kunde anlegen". There is nothing to confirm. | "Kunde angelegt." The customer page shows the coordinates of the address point and the flag "Ohne Parkplatz". The customer name is saved exactly as typed. | [ ] pass [ ] fail |
| O-22 | In "Kunden" find the new customer. | It carries the flags "Fotos fehlen" (no photos yet) and "Ohne Parkplatz". The filter "Fotos fehlen" and the filter "Ohne Parkplatz" list it. | [ ] pass [ ] fail |
| O-23 | Open the customer. Under "Fotos" add "Geschäft / Eingang" and "Parken / Entladen" with "Bild auswählen" (or drag a file in, or paste with Ctrl+V).                                                                                            | Progress, then "Hochgeladen". Both slots show the picture and the status "vorhanden". Clicking a picture enlarges it ("Bild vergrößern"). The flag "Fotos fehlen" is gone in the list.                                             | [ ] pass [ ] fail |
| O-24 | Replace one photo with "Foto ersetzen".                                                                                                                                                                                                       | "Foto gespeichert." The new photo is shown.                                                                                                                                                                                        | [ ] pass [ ] fail |
| O-25 | Search in the customer list for a part of a name, a number, a street and a city. Try a name without accents or capital letters.                                                                                                               | The search finds the customer ("Suche" ignores capitals and accents). A search without hit shows "Keine Treffer".                                                                                                                  | [ ] pass [ ] fail |
| O-26 | Open the customer, tab "Übersetzungen".                                                                                                                                                                                                       | The German note is the template ("Vorlage"). The three Chinese versions are shown with a badge such as "maschinell übersetzt" (or "Die Übersetzung steht noch aus ..." for a short time). A Chinese reader judges the translation. | [ ] pass [ ] fail |
| O-27 | Change one Chinese version, press "Übersetzungen speichern". Then press "Neu übersetzen" and confirm with "Ja, neu übersetzen".                                                                                                               | After saving: "Übersetzungen gespeichert." and the badge "von Hand bearbeitet". After re-translating: "Neu übersetzt." and the hand edit is replaced (this is warned about).                                                       | [ ] pass [ ] fail |
| O-28 | Press "Archivieren" on a test customer without orders, then show "Archivierte" in the filter "Anzeigen" and press "Wiederherstellen".                                                                                                         | "Kunde archiviert." The customer leaves the normal list, is found under "Archivierte", and "Kunde wiederhergestellt." brings it back. Nothing is deleted.                                                                          | [ ] pass [ ] fail |
| O-29 | Open the customer. In the section "Parkplätze" press "Parkplatz hinzufügen", click the real parking place on the map and press "Speichern". | "Parkplatz gespeichert." The spot is marked "Standard", the flag "Ohne Parkplatz" is gone, and the tour and the driver navigation use this place from now on. | [ ] pass [ ] fail |

### 3.4 Import of the existing customer list

Use the client's real file (Way B). With Way A use `tests/fixtures/customers-150.csv` from the repository
(150 invented customers, columns "Kundennr.;Name;Straße;PLZ;Ort;Land;Lieferzeiten;Hinweis").

| ID   | Do                                                                                                                                                                                                      | Expected                                                                                                                                                                                             | Pass / fail       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-30 | Open "Kunden" and press "Import" (page `/de/admin/customers/import`). Choose the file under "1. Datei auswählen".                                                                                       | The file is read ("Datei wird gelesen …"). Step "Spalten" appears with the number of data rows. Umlauts are correct (also for a CSV saved by German Excel).                                          | [ ] pass [ ] fail |
| O-31 | In "2. Spalten zuordnen" check the proposed assignment ("Feld" / "Spalte der Datei", examples in "Beispiele aus der Datei"). Correct it. Press "Weiter zur Vorschau".                                   | Required fields are marked "Pflicht". A missing or double assignment is reported and blocks the next step.                                                                                           | [ ] pass [ ] fail |
| O-32 | Read "3. Vorschau": counts "Neu", "Aktualisiert", "Unverändert", "Fehlerhaft". Use the filter "Nur fehlerhafte".                                                                                        | Wrong rows are listed with the reason and a line number. Faulty rows are not imported, all others are ("Fehlerhafte Zeilen werden nicht importiert, alle anderen schon.").                           | [ ] pass [ ] fail |
| O-33 | Press "{n} Zeilen importieren".                                                                                                                                                                         | "4. Ergebnis": "Neu angelegt", "Aktualisiert", "Unverändert", "Nicht importiert" add up to the number of rows. Customer names are exactly as in the file.                                            | [ ] pass [ ] fail |
| O-34 | Under "Adresspunkte suchen" the search starts by itself after the import. Wait until it is finished (or press "Abbrechen" once and press "Adresspunkte für {n} Kunden suchen" to continue later). | Progress "{done} von {total} Kunden bearbeitet", then "Fertig: ... Adresspunkte gefunden, ... Adressen nicht gefunden, ...". The address points are saved directly; nothing has to be confirmed. | [ ] pass [ ] fail |
| O-35 | Press "Parkplätze festlegen" (page `/de/admin/customers/parking`). For 10 customers: click the real parking place on the map (or drag the marker), press "Parkplatz speichern". Use "Überspringen" once. | "Parkplatz gespeichert." and the next customer is shown ("Kunde {current} von {total}"). At the end: "Alle durchgesehen" with the counts. One customer takes at most 3 clicks; time how long one customer takes: write it in the comment. | [ ] pass [ ] fail |
| O-36 | Import the **same file** again.                                                                                                                                                                         | All rows show "Unverändert"; nothing is duplicated. Then change the street of one customer in the file and import again: that customer shows "Aktualisieren" and "Adresspunkt wird neu ermittelt".   | [ ] pass [ ] fail |

### 3.5 Orders: manual entry and screenshot

Set the delivery date in these steps to **today** for the customers that will be in the tour you build in 3.6.

| ID   | Do                                                                                                                                                                                                                | Expected                                                                                                                                                                                                                             | Pass / fail       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| O-40 | Open "Bestellungen", press "Neue Bestellung". Choose the "Kunde" by typing a name or number, set "Lieferdatum" to today, choose a "Produkt" per line, "Menge" `3` for one line, press Enter for the next line.    | The customer and product lists filter while typing. A decimal quantity such as `2,5` is rejected with a message; whole numbers are accepted. Enter adds a new line ("Produkt hinzufügen"). Products appear in the order set in O-13. | [ ] pass [ ] fail |
| O-41 | Press "Bestätigt speichern".                                                                                                                                                                                      | "Bestellung gespeichert." The order is in the list "Bestellungen" (status "Bestätigt", source "Manuell") and in "Summen je Liefertag".                                                                                               | [ ] pass [ ] fail |
| O-42 | Enter a second order for the same customer and the same day.                                                                                                                                                      | A warning says that the customer already has a confirmed order that day and that all orders are merged into one stop.                                                                                                                | [ ] pass [ ] fail |
| O-43 | Try wrong input: quantity `0`, a date in the past, no product.                                                                                                                                                    | Each case gives a clear German error text, nothing is saved.                                                                                                                                                                         | [ ] pass [ ] fail |
| O-44 | Choose a customer without a Parkplatz. | No warning appears (a missing Parkplatz does not block anything). The order can be saved; the customer is delivered to the address. | [ ] pass [ ] fail |
| O-45 | Press "Als Entwurf speichern" for one order.                                                                                                                                                                      | "Entwurf gespeichert." Status "Entwurf". A draft does not count in the totals and will not be in a tour.                                                                                                                             | [ ] pass [ ] fail |
| O-46 | Open an order. Use "Bearbeiten" (change a quantity), "Auf anderes Datum kopieren" and "Stornieren" (confirm with "Ja, stornieren").                                                                               | "Änderungen gespeichert."; "Kopie als Entwurf angelegt."; "Bestellung storniert." and the order stays visible with status "Storniert" and is not counted any more.                                                                   | [ ] pass [ ] fail |
| O-47 | In "Bestellungen" use the filters "Von", "Bis", "Kunde", "Status", "Quelle", and "Zurücksetzen (nächster Liefertag)". Read "Summen je Liefertag".                                                                 | The list follows the filters. The totals per product equal the sum of the confirmed orders of that day (check one product by hand with a calculator).                                                                                | [ ] pass [ ] fail |
| O-50 | **Screenshot order.** Press "Neue Bestellung". In the box "Screenshot" upload a real German order screenshot (button, drag a file in, or Ctrl+V after copying it from the chat).                                  | The screenshot appears next to the form. Zoom with the mouse wheel, move by dragging, double-click to zoom in.                                                                                                                       | [ ] pass [ ] fail |
| O-51 | Enter the order from the screenshot (customer, products, quantities) and save with "Bestätigt speichern". Repeat with a **Chinese** screenshot (WeChat).                                                          | The order is saved. In the list the "Quelle" is "Screenshot". Opening the order shows the screenshot ("Zum Vergrößern anklicken."). Remove with "Screenshot entfernen" works before saving.                                          | [ ] pass [ ] fail |
| O-52 | While reading the Chinese screenshot, try to find the product by typing its Chinese name in the product field ("Nach Name oder Artikelnummer suchen"). **Observation, no requirement:** note whether it is found. | Write what happens in the comment (found / not found). A "not found" is a wish (S4), not a failure.                                                                                                                                  | [ ] pass [ ] fail |

### 3.6 Tour: generate, reorder, release

| ID   | Do                                                                                                                                                                                             | Expected                                                                                                                                                                                                               | Pass / fail       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-60 | Open "Touren". Choose "Lieferdatum" = today. If no tour exists the page says "Für diesen Tag gibt es noch keine Tour" and how many orders wait. Press "Tour erstellen".                        | "Tour mit {n} Stopps erstellt." A map shows the depot ("Depot") and numbered stops; the list "Stopps" shows the order with "Ankunft" times; the summary shows "Gesamtdauer" and "Strecke".                             | [ ] pass [ ] fail |
| O-61 | Check the order of the stops on the map. Is it a sensible round trip from the factory and back? Does "Gesamtdauer" fit your own experience?                                                    | The route looks sensible. **If the badge "Näherungswerte" is shown, the routing service is not connected** (section 9): the order is then only a rough estimate; note this and stop judging the route quality.         | [ ] pass [ ] fail |
| O-62 | Make sure a customer with a confirmed order but without any location exists (no Parkplatz and the address search found nothing). | The tour page warns "Nicht in der Tour: kein Parkplatz und kein Adresspunkt" with the customer and "Kunde öffnen". That customer is not a stop. Customers who only lack a Parkplatz are on the tour with the note "Parkplatz fehlt". | [ ] pass [ ] fail |
| O-63 | Move one stop to another place: drag it, or use the buttons "{name} nach oben" / "{name} nach unten".                                                                                          | "Reihenfolge gespeichert, Zeiten neu berechnet." Numbers, map and "Ankunft" times follow.                                                                                                                              | [ ] pass [ ] fail |
| O-64 | Press "Reihenfolge sperren". Add a confirmed order for another customer for today, then press "Aus Bestellungen aktualisieren".                                                                | "Reihenfolge gesperrt." Then "Tour aktualisiert: 1 neu, 0 entfernt." The existing order stays, the new customer is at the end. "Sperre aufheben" releases the lock.                                                    | [ ] pass [ ] fail |
| O-65 | Press "Neu optimieren".                                                                                                                                                                        | The order is recalculated and manual changes are dropped (the hint under the button says so).                                                                                                                          | [ ] pass [ ] fail |
| O-66 | Change an order of the day (e.g. a quantity) **before** releasing.                                                                                                                             | The tour page shows "Bestellungen wurden geändert" and asks to create the tour again before releasing. "Tour freigeben" is blocked until you have done so ("Neu optimieren" or "Tour erstellen").                      | [ ] pass [ ] fail |
| O-67 | Choose the "Fahrer" (a driver account from O-100, or `driver-hans`), press "Tour freigeben". Read the dialog "Tour freigeben?" (stops, "Gesamtdauer", driver). Confirm with "Jetzt freigeben". | "Tour freigegeben." The page says "Freigegeben am {time}" and "Diese Tour ist freigegeben und kann hier nicht mehr geändert werden." A tour without driver cannot be released ("Bitte zuerst einen Fahrer zuweisen."). | [ ] pass [ ] fail |

### 3.7 Print load sheet

| ID   | Do                                                                                                                                | Expected                                                                                                                                                                                                                | Pass / fail       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-70 | On the tour page press "Ladeliste drucken". Choose a "Sprache des Ausdrucks" and press "Drucken". Print on paper (or save a PDF). | The sheet has "1. Gesamtmenge pro Produkt" and "2. Beladereihenfolge" (last stop is loaded first). Date, driver, depot are right. Text is readable on paper, nothing is cut off, table rows are not split across pages. | [ ] pass [ ] fail |
| O-71 | Compare the "Gesamtmenge pro Produkt" with "Summen je Liefertag" in "Bestellungen" and with 3 single orders.                      | All quantities are identical. **A difference here is S1.**                                                                                                                                                              | [ ] pass [ ] fail |
| O-72 | Would the loaders work with this sheet in the warehouse? Ask the person who loads the van.                                        | Answer in the comment (layout, font size, language, what is missing).                                                                                                                                                   | [ ] pass [ ] fail |

### 3.8 Drivers

| ID    | Do                                                                                                                                                                  | Expected                                                                                                                                                                                            | Pass / fail       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-100 | Open "Fahrer". Press "Fahrer anlegen". Enter "Anzeigename" and "Benutzername" (3 to 32 characters, lower case) and leave "Sprache" at the default. Press "Anlegen". | A dialog "PIN für {name}" shows the 6-digit PIN **once**. Write it down; use "PIN kopieren" or "Drucken". After "Fertig" the PIN can not be shown again. The driver appears in the list as "Aktiv". | [ ] pass [ ] fail |
| O-101 | Press "PIN zurücksetzen" for the new driver and confirm.                                                                                                            | The old PIN stops working at once, a new PIN is shown once. (Test with the driver app login later.)                                                                                                 | [ ] pass [ ] fail |
| O-102 | Press "Deaktivieren" for a test driver, try to log in as this driver, then "Reaktivieren".                                                                          | "{name} wurde deaktiviert." The login fails; after "{name} wurde reaktiviert." it works again.                                                                                                      | [ ] pass [ ] fail |
| O-103 | After a driver has chosen his language in D-02, look at the column "Sprache" in the list "Fahrer".                                                                  | The column shows the language the driver chose. Copy it into section 5.2.                                                                                                                           | [ ] pass [ ] fail |

### 3.9 Change after release and re-release

Run this together with the driver (X-01 below) while the driver has the tour open.

| ID   | Do                                                                                                                                                                           | Expected                                                                                                                                                                                             | Pass / fail       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-80 | After the release change an order of today that is still open on the road: edit the quantity of a product, and add one new order for a customer that is not yet in the tour. | The tour page shows "Bestellungen seit der Freigabe geändert – prüfen und erneut freigeben" with the changed stops ("Menge geändert", "Neu seit Freigabe"). The driver still has the old quantities. | [ ] pass [ ] fail |
| O-81 | Open "Ladeliste drucken" now.                                                                                                                                                | The sheet is marked with a warning starting "ACHTUNG: Bestellungen wurden nach der Freigabe dieser Tour geändert."; it shows the quantities of the tour, not of the new orders.                      | [ ] pass [ ] fail |
| O-82 | Press "Erneut freigeben" and confirm with "Jetzt erneut freigeben".                                                                                                          | "Tour erneut freigegeben (Version {n})." The history ("Verlauf") of the tour lists the change. Stops that were already delivered stay as they are.                                                   | [ ] pass [ ] fail |
| O-83 | Open "Verlauf" on the tour page and on an order.                                                                                                                             | Entries say who did what and when (e.g. "Tour erstellt", "Tour freigegeben", "Bestellung geändert", "Als geliefert markiert"). Entries cannot be edited or deleted.                                  | [ ] pass [ ] fail |

### 3.10 Live progress

| ID   | Do                                                                       | Expected                                                                                                                                                                                                                                 | Pass / fail       |
| ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| O-90 | Keep "Übersicht" open while the driver delivers (D-10, D-11).            | The card "Heute" shows "{done} von {total} Stopps erledigt", "{delivered} geliefert · {open} offen", "Nächster Stopp" with "Ankunft ca. {time}", and "Probleme". It refreshes by itself within about 30 seconds.                         | [ ] pass [ ] fail |
| O-91 | Open the tour page ("Tour ansehen").                                     | Each stop shows its status, "Erledigt um {time}"; the progress bar "Fortschritt der Tour" matches the driver's phone.                                                                                                                    | [ ] pass [ ] fail |
| O-92 | Look at the stop where the driver reported a problem (D-11).             | "Grund: ..." with the reason, "Originaltext des Fahrers:" (Chinese) and "Deutsche Übersetzung:" marked "maschinell übersetzt". The office can understand the problem from the German text. Judge the translation quality in the comment. | [ ] pass [ ] fail |
| O-93 | After the last stop was delivered look at "Übersicht" and the tour page. | "Alle Stopps sind erledigt." The tour status is "Abgeschlossen".                                                                                                                                                                         | [ ] pass [ ] fail |
| O-94 | Open the customer of a stop where the driver took a photo (D-12).        | The photo is the current one and the page says "Aktualisiert von Fahrer {name} am {date}". The older photo is kept as history.                                                                                                           | [ ] pass [ ] fail |

## 4. Driver script (own phone)

Give the driver the address `https://<host>/de/driver/login` (any language prefix works, the app
changes to his language after step D-02), his user name and PIN. The helper reads each step in the
driver's language and writes down what the driver does without help. Tour of **today** must be
released (O-67).

### 4.1 Start: login, language, install

| ID   | Do                                                                                                                                                                                                                             | Expected                                                                                                                                                                                                                                               | Pass / fail       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| D-01 | Open the address. Enter "Benutzername" and "PIN (6 Ziffern)", press "Anmelden". Once with a wrong PIN first.                                                                                                                   | The login page has a language switch and large fields. The wrong PIN shows "Anmeldung fehlgeschlagen. Bitte Eingaben prüfen." The correct PIN logs in. The PIN field is a number keypad.                                                               | [ ] pass [ ] fail |
| D-02 | **First start:** a full screen with five big buttons appears, each in its own writing: "Deutsch", "English", "Srpski", "Čeština", "中文". Ask the driver: "Choose the language you read most easily." Do not help. | The driver chooses without help. The app switches at once to the chosen language. **Write the choice into section 5.2** (also if he first hesitated between languages and why). The picker does not appear again at the next login. | [ ] pass [ ] fail |
| D-03 | Ask: "Which of the other languages would you also understand? Is anything in the chosen language unusual for you?"                                                                                                       | Answers go to section 5.2 and, for single words, to 5.3. All five languages ship regardless of the answer.                                                                                                                                              | [ ] pass [ ] fail |
| D-04 | Look at the home screen "Heutige Tour" (top bar shows the date and "Online").                                                                                                                                                  | The next stop is on top ("Nächster Stopp") with the customer name, address, "Ankunft ca. {time}", number of products; "Noch ca. {duration}" and the progress ("{done} / {total}"). The list "Alle Stopps" follows in tour order.                       | [ ] pass [ ] fail |
| D-05 | **Android (Chrome):** the box "App installieren" is shown. Press "Installieren" and confirm. Open the new icon from the home screen.                                                                                           | The app is installed with the icon and the name "Lieferungen" (or the name in the driver's language), opens full screen without the browser bar and shows today's tour. Note the icon quality (is it cut off?).                                        | [ ] pass [ ] fail |
| D-06 | **iPhone (Safari):** the box "Zum Home-Bildschirm hinzufügen, dann öffnet die App direkt." is shown. Press "So geht's" and follow the three steps ("Teilen", "Zum Home-Bildschirm", "Hinzufügen"). Open the icon.              | The picture shows where the Share symbol is. After the three steps the icon is on the home screen and the app opens full screen. Could the driver do it alone? Note where he stopped.                                                                  | [ ] pass [ ] fail |
| D-07 | Press "Nicht jetzt" on the install box (before installing), then reload the page.                                                                                                                                              | The box goes away and stays away after the reload.                                                                                                                                                                                                     | [ ] pass [ ] fail |

### 4.2 The tour

| ID   | Do                                                                                                                                                                       | Expected                                                                                                                                                                                                                                                          | Pass / fail       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-10 | Switch between "Liste" and "Karte" (view switch). Look at the map.                                                                                                       | The map shows the stops with their numbers. The driver can find the next stop. (Without internet the map may be empty: see D-31.)                                                                                                                                 | [ ] pass [ ] fail |
| D-11 | Open the first stop ("Details" or tap the stop). Read out loud: customer, address, products with quantities and units.                                                   | Top: "Stopp 1 von {n}". "Lieferung" lists every product with the quantity in **large** numbers and the unit (kg, Packung, Kiste, Stück). Customer name and address are **not translated** (they match the shop sign). Product names are in the driver's language. | [ ] pass [ ] fail |
| D-12 | **Quantity check (most important):** for at least 3 stops compare quantities on the phone with the order in the office ("Bestellungen") and with the printed load sheet. | Identical. Also the merged quantity when one customer had two orders that day (O-42). **Any difference is S1.**                                                                                                                                                   | [ ] pass [ ] fail |
| D-13 | Look at the two photos "Geschäft / Eingang" and "Parken / Entladen". Tap a photo to enlarge it.                                                                          | Both are shown and enlarge (zoom). The driver says: "I would recognise the entrance / I know where to park." A stop without photo shows "Noch kein Foto".                                                                                                         | [ ] pass [ ] fail |
| D-14 | Read "Hinweis" and "Lieferzeiten" of a stop that has them. Press "Adresse kopieren".                                                                                     | The note is in the driver's language (or "Text nur auf Deutsch vorhanden"). The delivery hours are shown. "Adresse kopiert" appears. Chinese reader: is the note understandable? (Wording to 5.3.)                                                                | [ ] pass [ ] fail |
| D-15 | Press "Navigation starten".                                                                                                                                              | Google Maps opens (app if installed, else browser) with the route to the **Parkplatz first and the Lieferadresse second** (customer without Parkplatz: the address point), not just a street search. The stop also lists the customer's Parkplätze with their notes. On iPhone there is also "Apple Karten": the Parkplatz only. Go back to the app: it is on the same stop.                                      | [ ] pass [ ] fail |
| D-16 | Use "Zurück" / "Weiter" to move between stops, and "Zurück zur Tour" to go to the list.                                                                                  | The driver can look ahead and come back. He **cannot** change the order of the stops.                                                                                                                                                                             | [ ] pass [ ] fail |
| D-17 | At the first stop press "Geliefert".                                                                                                                                     | A message "Geliefert: {name}". The stop is marked "Geliefert" with the time ("um {time}"), progress moves on, the next stop is shown. Within 30 seconds the office sees it (O-90).                                                                                | [ ] pass [ ] fail |
| D-18 | Press "Rückgängig" right after a delivery.                                                                                                                               | "Rückgängig gemacht" and the stop is open again. (After 5 minutes undo is refused: "Rückgängig geht nur in den ersten 5 Minuten.")                                                                                                                                | [ ] pass [ ] fail |

### 4.3 Problem, photo, finishing

| ID   | Do                                                                                                                                                                                                                                                                                  | Expected                                                                                                                                                                                                                                                                                                                      | Pass / fail       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-20 | At another stop press "Problem". | A window "Problem? Ruf an" shows the office number (Einstellungen → "Problem beim Fahrer") and a big "Anrufen" button that starts the call. Nothing is reported, the stop stays open (owner 2026-11-14). "Schließen" goes back to the stop. | [ ] pass [ ] fail |
| D-21 | Report one problem **without** free text.                                                                                                                                                                                                                                           | Works. The office sees only the reason.                                                                                                                                                                                                                                                                                       | [ ] pass [ ] fail |
| D-22 | At a stop without photo (or any stop) press "Foto aufnehmen" (or "Foto ersetzen") and take a picture of the entrance or the parking place with the phone camera.                                                                                                                    | The camera opens. A preview is shown with "Foto verwenden" and "Neu aufnehmen". After "Foto verwenden": the photo shows with "Wartet auf Versand" and then "Gesendet". The office sees it on the customer page (O-94). Try also with a picture from a very high resolution camera setting; note if it is slow.                | [ ] pass [ ] fail |
| D-23 | Finish all stops.                                                                                                                                                                                                                                                                   | "Alle Stopps erledigt" and "Die Tour ist abgeschlossen. Danke!" with the summary "{delivered} geliefert · ..." (problems counted).                                                                                                                                                                                            | [ ] pass [ ] fail |
| D-24 | At the bottom of the home screen press "Abmelden", then log in again.                                                                                                                                                                                                               | Logout works; login again shows today's tour in the language chosen before (no picker).                                                                                                                                                                                                                                       | [ ] pass [ ] fail |

### 4.4 Language switch

| ID   | Do                                                                                                            | Expected                                                                                                                                                                                                    | Pass / fail       |
| ---- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-25 | Tap the language symbol in the top bar ("Sprache ändern") and choose another language, then each of the other four. | All text changes at once, on the home screen and on a stop. Product names and notes change language, customer names and addresses do not. The choice is still there after closing and reopening the app.    | [ ] pass [ ] fail |
| D-26 | Have a second reader of each language (English, Serbian, Czech, Chinese) look at the driver screens in that language.   | Wrong or unnatural words are written down with screen, current text and better text in section 5.3. (Texts were written by the development agent and are only verified once the review of NUD-073 is done.) | [ ] pass [ ] fail |

### 4.5 Offline behaviour (real dead spot)

Do this on the Android phone **and** on the iPhone. Open the app online first and wait on the home screen until it shows "Offline bereit ✓".

| ID   | Do                                                                                                                                                                                    | Expected                                                                                                                                                                                                                                                                       | Pass / fail       |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| D-30 | Online, at home screen: read the line about the offline copy.                                                                                                                         | "Tour wird für offline gespeichert …", then "Offline bereit ✓". **If it says "Offline teilweise bereit: {cached} von {total} Fotos", the photo storage does not allow downloads (R2 CORS rule, section 9): write it down (S2).**                                               | [ ] pass [ ] fail |
| D-31 | Switch on airplane mode. Look at the top bar and the bar below it. Open the list, 3 stops, their photos, and the map view.                                                            | The top bar shows "Offline", the bar "Offline – zuletzt aktualisiert {time}". List, stops, quantities and photos work. The map: note what you see (tiles, a hint, or an empty map). An empty map is a known gap (NUD-108).                                                     | [ ] pass [ ] fail |
| D-32 | Offline: press "Geliefert" at one stop and "Problem" (with text) at another.                                                                                                          | The stop changes at once. A note "Offline: Ihre Eingabe wird auf dem Handy gespeichert und automatisch gesendet, sobald wieder Internet da ist." and the marker "Wartet auf Übertragung". The top bar shows how many entries wait ("{count} Eingaben warten auf Übertragung"). | [ ] pass [ ] fail |
| D-33 | Offline: take a photo (D-22) of a stop.                                                                                                                                               | The photo is shown with "Wartet auf Versand" and counts in the top bar.                                                                                                                                                                                                        | [ ] pass [ ] fail |
| D-34 | Still offline: close the app completely (swipe it away) and open it again from the home screen icon.                                                                                  | The app starts and shows the saved tour with the offline bar (a cold start without internet). Taps and photos from D-32 and D-33 are still marked as waiting.                                                                                                                  | [ ] pass [ ] fail |
| D-35 | Switch off airplane mode. Keep the app open.                                                                                                                                          | Within about a minute the waiting entries are sent: the markers and the counter disappear ("Gesendet" for photos). The office sees the delivered stop, the problem and the photo (O-90, O-92, O-94).                                                                           | [ ] pass [ ] fail |
| D-36 | **Android only (Background Sync):** repeat D-32 in airplane mode, close the app, switch off airplane mode and **do not open the app**. Look at the office screen after a few minutes. | The stop appears as delivered in the office without opening the app. Write what you saw (this is not expected on iPhone: there the taps are sent when the app is opened again).                                                                                                | [ ] pass [ ] fail |
| D-37 | **iPhone:** repeat D-32 offline, close the app, go online, open the app.                                                                                                              | The taps are sent when the app is open again.                                                                                                                                                                                                                                  | [ ] pass [ ] fail |
| D-38 | Offline: tap "Geliefert" once, then press "Abmelden" (on the home screen) and log in again when online.                                                                               | The tap is not lost: it is sent after the login.                                                                                                                                                                                                                               | [ ] pass [ ] fail |
| D-39 | Offline: the office changes (re-releases) a stop that the driver has already delivered offline (agree this with the office, X-02).                                                    | After the connection is back the driver sees a notice such as "{name}: Das Büro hat diesen Stopp geändert. Ihre Eingabe wurde nicht übernommen, es gilt der aktuelle Stand." with "Verstanden". The office state wins.                                                         | [ ] pass [ ] fail |
| D-40 | Log out while online, then switch to airplane mode and open the app.                                                                                                                  | No tour of the previous user is shown (the login page, or "Keine gespeicherte Tour").                                                                                                                                                                                          | [ ] pass [ ] fail |

### 4.6 Together (office and driver)

| ID   | Do                                                                                                                                              | Expected                                                                                                                                                                                                                                                                  | Pass / fail       |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| X-01 | The driver has the tour open and has delivered at least one stop. The office does O-80 to O-82 (change a quantity, add a customer, re-release). | The driver's screen (after the app is opened again or comes back to the foreground) shows the banner "Tour wurde aktualisiert" with the marks "Neuer Stopp" / "Menge geändert" and the current quantities. "Verstanden" hides the banner. Delivered stops stay delivered. | [ ] pass [ ] fail |
| X-02 | The office changes a stop that the driver already delivered while the driver's phone is offline (used for D-39).                                | See D-39.                                                                                                                                                                                                                                                                 | [ ] pass [ ] fail |
| X-03 | The office cancels the only order of a customer who is still open in the tour (O-46) and re-releases the tour (O-82).                           | The stop disappears for the driver and is listed under "Entfernte Stopps" in the banner "Tour wurde aktualisiert".                                                                                                                                                        | [ ] pass [ ] fail |

### 4.7 Readability and use on the road

Do this at the driver's **usual font size** (phone setting), in daylight or near a window, and while standing or walking.

| ID   | Do                                                                                                                                                        | Expected                                                                                                                                              | Pass / fail       |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| D-50 | Ask the driver to set the phone's font size to his usual value (note it: normal / large / largest). Go through home screen, a stop and the problem sheet. | Nothing is cut off, no text overlaps, no sideways scrolling. Quantities are clearly the biggest text. All buttons can be read in the chosen language. | [ ] pass [ ] fail |
| D-51 | Outdoors (or at a bright window) read quantity, customer name and the buttons "Geliefert" / "Problem".                                                    | Readable without shading the screen. If the phone uses dark mode, check that too.                                                                     | [ ] pass [ ] fail |
| D-52 | Hold the phone in one hand and use only the thumb: "Navigation starten", "Geliefert", "Problem", "Weiter".                                                | The main buttons can be reached with the thumb without letting go. Buttons are big enough to hit without mistakes (write down any mis-tap).           | [ ] pass [ ] fail |
| D-53 | Ask a person (colleague) who does **not** read the chosen language to deliver one stop.                                                                   | He can find the quantity, the photos, the navigation and the delivered button from numbers, pictures and symbols alone.                               | [ ] pass [ ] fail |
| D-54 | Ask the driver: "What was unclear? What would you remove? What is missing for your day?"                                                                  | Free answers in the feedback form (section 5.1, ID `D-54`).                                                                                           | [ ] pass [ ] fail |

## 5. Feedback form

Copy this section into a separate file for each tester (for example `uat-results-<date>-<name>.md`
outside the repository, or print it) and fill it in. **Do not write real PINs, passwords or customer
phone numbers into it.** The developer collects the forms and the agent converts them into tickets
(section 8).

### 5.1 Findings

Severity: S1 blocker, S2 major, S3 minor, S4 wish (section 1). Result: pass, fail, skipped, observation.

| Step ID | Tester role (office / driver) | Result | Severity | Comment (what happened, what did you expect, device) |
| ------- | ----------------------------- | ------ | -------- | ---------------------------------------------------- |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |
|         |                               |        |          |                                                      |

### 5.2 Which Chinese variant did each driver choose?

Fill one row per driver (D-02, D-03, O-103). The choice is what the driver picked **himself** on the
first start, without help. This answers the open question in `backlog.md` section 10.

| Driver (first name or letter, no user name) | Date | Variant chosen (de / en / sr-Latn / cs / zh-Hans) | Shown in "Fahrer" > "Sprache" (O-103) | Hesitated between variants? (yes / no, why) | Would also understand (variants) | Preferred variant, if different | Comment |
| ------------------------------------------- | ---- | ------------------------------------------------------- | ------------------------------------- | ------------------------------------------- | -------------------------------- | ------------------------------- | ------- |
|                                             |      |                                                         |                                       |                                             |                                  |                                 |         |
|                                             |      |                                                         |                                       |                                             |                                  |                                 |         |
|                                             |      |                                                         |                                       |                                             |                                  |                                 |         |

Summary (filled in by the developer after the session): number of drivers per variant:
de ___ , en ___ , sr-Latn ___ , cs ___ , zh-Hans ___ .

### 5.3 Wording issues

One row per text. Take the **key** from the developer if you know it; otherwise describe the screen
(page, button, step ID). The agent or developer finds the key. Write the **complete** suggested text,
not a fragment. Do not report customer names or addresses (they are never translated). The rows feed
`pnpm i18n:import` (section 8, `docs/i18n.md`).

| Step ID | Key or screen | Locale (de / en / sr-Latn / cs / zh-Hans) | Current text | Suggested text | Comment (why) |
| ------- | ------------- | ----------------------------------------------- | ------------ | -------------- | ------------- |
|         |               |                                                 |              |                |               |
|         |               |                                                 |              |                |               |
|         |               |                                                 |              |                |               |
|         |               |                                                 |              |                |               |
|         |               |                                                 |              |                |               |

## 6. Device matrix

Record every device used, and which parts it covered. Tick the box when the part was run on it and
write the failed step IDs.

| Device (make, model) | OS and version | Browser and version | Installed as app? (yes / no) | Tester | Parts run (office / D-01..24 / offline D-30..40 / D-50..54) | Failed step IDs |
| -------------------- | -------------- | ------------------- | ---------------------------- | ------ | ----------------------------------------------------------- | --------------- |
| Android phone        |                | Chrome              |                              |        |                                                             |                 |
| iPhone               | iOS            | Safari              |                              |        |                                                             |                 |
| Driver's own phone 1 |                |                     |                              |        |                                                             |                 |
| Driver's own phone 2 |                |                     |                              |        |                                                             |                 |
| Office PC / laptop   |                |                     | -                            |        |                                                             |                 |
| Printer / PDF        | -              | -                   | -                            |        |                                                             |                 |

## 7. Sign-off

**To be completed by the client only.** The development agent and the developer never fill in or
tick anything in this section. Until it is filled in, the ticket NUD-096 stays `blocked` and the
acceptance criterion "Client sign-off recorded in `docs/uat.md`" stays unticked.

| Field                                                                 | Entry |
| --------------------------------------------------------------------- | ----- |
| Client name and function                                              |       |
| Date of the UAT session(s)                                            |       |
| App address and build tested (section 2.1)                            |       |
| Office testers                                                        |       |
| Drivers tested (first names or letters), languages used               |       |
| Number of failed steps S1 / S2 / S3 / S4 (from section 5.1)           |       |
| Decision (one of: accepted / accepted with open items / not accepted) |       |
| Open items that must be fixed before going live (ticket numbers)      |       |
| Open items that can follow after going live (ticket numbers)          |       |
| Signature or written confirmation (e-mail date and subject)           |       |

Rule of thumb for the decision: any open S1, or any open wrong-quantity finding, means "not
accepted". S2 findings are listed as open items that must be fixed or accepted explicitly.

## 8. How the agent converts feedback into tickets

After the session the developer gives the completed forms (sections 5.1 to 5.3 and the device
matrix) to the agent. The agent works through them in this order:

1. **One ticket per failed step (or per group of identical failures).** For each row in 5.1 with
   result "fail" and severity S1 to S3, add a ticket to `backlog.md`:
   - ID: the next free `NUD-nnn` number in the milestone M2 block (look at the highest existing
     number in section 7 and in the milestone block; **never renumber** or reuse an ID, never
     change the ID of an existing ticket). A ticket is also added to the ticket index in section 7
     of the backlog with status `todo`.
   - Title: short and in the form of the goal ("Driver app: ... ") and the UAT step ID in brackets.
   - Body: **severity** (S1 to S3), **Reproduction** (steps from the script, device/OS/browser from
     the matrix, build number from section 2.1), **Expected** and **Actual** result, the tester's
     comment, and `depends_on` (the ticket that built the feature, if clear).
   - Several testers hitting the same problem on one step make one ticket, naming all step IDs.
   - Findings that need a real device or an account (human steps) get the 👤 mark.
2. **S4 wishes** become a ticket only if the client names them as wanted for go-live. Otherwise
   they are collected in one ticket "UAT wishes" (one list, each with the step ID).
3. **Skipped steps** that were not run for a technical reason are repeated in the next session
   (note them in the ticket NUD-096 under "Human steps").
4. **Wording issues (5.3) do not become code tickets.** The agent copies the rows into the
   review CSV format of `docs/i18n.md` (`pnpm i18n:export`, then fill `corrected_en`,
   `corrected_sr-Latn`, `corrected_cs`, `corrected_zh-Hans`, `reviewer_comment`; German problems only in
   `reviewer_comment`), runs `pnpm i18n:import <file> --dry-run`, then the import, `pnpm i18n:check`,
   and commits the changed message files (see ticket NUD-073). The CSV itself is not committed.
   A correction goes into the message file of the language it was written for.
5. **Language choice (5.2):** the agent writes the numbers into the Decision log
   (section 9 of the backlog, one line) and resolves the open question in section 10. No locale is
   removed, whatever the numbers say; a variant nobody chose may be taken out of the first-start
   picker only after the client decides.
6. **Findings that belong to an existing open ticket** (for example NUD-099, NUD-106, NUD-108,
   or the real-device tickets in section 10 of this document) are written as a comment under that
   ticket instead of a new ticket.
7. **Do not change status of other tickets** and do not tick the sign-off criterion of NUD-096.
   When the client has signed in section 7 and all S1 tickets are done, the developer sets
   NUD-096 to `done`.
8. Every new ticket follows the Definition of Done (backlog section 5). Fixes for S1 tickets are
   done first, before any M3 work.

## 9. Pre-UAT checklist for the developer

Tick before the session. The steps behind each line are not repeated here: follow the ticket or
the document named.

- [ ] Deployed build is current (`/api/health` shows the commit in `release`, region `fra1`);
      accounts, environment variables and first deploy done: **NUD-007** (`docs/deploy.md`).
- [ ] **Real routing key `ORS_API_KEY`** set (routing and geocoding). Check: a new tour shows
      **no** "Näherungswerte" badge (O-61), address search finds real addresses.
      Vehicle type (`ORS_ROUTING_PROFILE`, car or truck) agreed with the client (backlog section 10).
- [ ] **Map tile provider** with a usage plan: `MAP_TILE_URL` and `MAP_TILE_ATTRIBUTION` set
      (the OpenStreetMap default is for development only), `docs/env.md`.
- [ ] **`DEEPL_API_KEY`** set (preferably DeepL Pro, see `docs/privacy.md`) and `CRON_SECRET` set.
      Check: a new customer note gets real Chinese translations, not a "[zh-Hans]" prefix (O-26).
- [ ] **R2 bucket CORS rule** allows `GET` and `PUT` from the app address (`docs/env.md`, ticket
      NUD-006 notes). Check: photo upload works (O-23) and the driver app shows "Offline bereit ✓"
      with all photos (D-30).
- [ ] **Sentry** project and DSN, uptime monitor, **backups** (first run green): **NUD-114**,
      `docs/runbook.md` section 13.
- [ ] **Security headers / CSP** on the real deployment, private bucket check, retention cron:
      **NUD-113** (`docs/deploy.md` section 11). Open the app on the real phones once and look for
      blocked content (map tiles, photos, upload, install).
- [ ] **Chinese UI texts reviewed** by native speakers and imported: **NUD-073** (`docs/i18n.md`).
      Without it the Chinese texts are unreviewed agent text: tell the client and the drivers that
      wording in this UAT is expected to change, and keep section 5.3 ready.
- [ ] **Real depot address** and pin entered and confirmed (O-04); **real product list** entered
      (O-11) or seeded; **customer list file** from the client available (O-30).
- [ ] Demo accounts: with Way A they exist and use a well-known PIN; with Way B the seed ran with
      `SEED_DRIVERS=false` and the admin has a real password.
- [ ] Real-device checks of the existing human tickets planned together with this session, because
      the same phones are used: **NUD-105** (install, Lighthouse), **NUD-107** (offline), **NUD-109**
      (offline queue), **NUD-115** (usability, TalkBack/VoiceOver, slow network). The steps D-05,
      D-06, D-30 to D-40 and D-50 to D-54 are the practical test for them; write the result under
      those tickets as well, do not copy the script there.
- [ ] Personal data: the UAT uses real customer data only if the data processing agreements of
      `docs/privacy.md` section 1 are settled (NUD-113 item 5); otherwise use the demo data (Way A).
- [ ] Printer or PDF printer available for O-70; test phones charged, SIM data available,
      airplane mode known to the testers.
- [ ] Forms (section 5, section 6) printed or copied for every tester.

## 10. Known open items that testers may meet

These are known and already in the backlog; a tester who meets one writes it down (as a comment under
that ticket) but it does not count as a new finding.

| Ticket  | What a tester may see                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| NUD-108 | Offline the map view of the tour can be empty (D-31).                                                              |
| NUD-099 | A confirmed order entered after the tour of its day is already `Abgeschlossen` is on no tour and nobody is warned. |
| NUD-073 | The Chinese texts are not yet reviewed by native speakers (this UAT collects the first feedback, section 5.3).     |
| NUD-097 | A harmless error line in the server log while opening admin pages (nothing visible).                               |
