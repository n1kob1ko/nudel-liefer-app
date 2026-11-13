# Parking-spot import from `2026-10/`

One-off import of the parking spots the client recorded by hand: 49 Google-Maps screenshots (a
dropped pin per shop) plus the parking photos taken at those spots. The target is the production
database and the production object storage.

The plan and its open questions live in [`PLAN-AND-ORCHESTRATOR-PROMPT.md`](./PLAN-AND-ORCHESTRATOR-PROMPT.md);
this file is the implementation note: what the pipeline does, how to run it, and where it deviates
from the plan.

## Pipeline

Every phase writes into `.parking-import/` (git-ignored, like `2026-10/`). Nothing before the last
phase writes to the database or the object storage.

| Phase             | Command                                    | Output                                      |
| ----------------- | ------------------------------------------ | ------------------------------------------- |
| 0 — manifest      | `pnpm parking:manifest`                    | `manifest.json`, `units/uNN.json`, `crops/` |
| 1 — customers     | `pnpm parking:export-customers`            | `customers.json`, `address-groups.json`     |
| 2 — matching      | _(orchestrator, one vision agent per pin)_ | `results/uNN.json`                          |
| 3 — cross-check   | `pnpm parking:check`                       | `check.json` + console summary              |
| 4 — review report | `pnpm parking:report`                      | `REPORT.html`, `REPORT.md`, `review.json`   |
| 5 — photo prep    | `pnpm parking:prepare-uploads`             | `upload/uNN.jpg`, `uploads.json`            |
| 6 — import        | `pnpm parking:import` (dry run)            | console table                               |
| 7 — write         | `pnpm parking:import -- --apply`           | `import-ledger.json`, `import-<time>.json`  |

Steps 0–2 need no database write access at all; step 6 is a dry run unless `--apply` is given.

### Phase 0 — manifest (`scripts/parking-import/build-manifest.py`)

Reads `2026-10/` read-only and computes, for every image, its sha256, size, mtime, kind, the
timestamp in its file name, and its EXIF timestamp / camera / GPS.

What the capture actually contains (the plan's "52 screenshots, 51 photos" was an estimate from
file sizes before hashing):

- **103 files → 7 byte-identical duplicate groups → 96 unique**: 49 screenshots, 47 photos
  (46 dated photos plus one `..._Burst01` frame).
- **EXIF GPS is useless**: all 47 photos carry a GPS IFD whose values are zeroed out (the
  `vivo V40 SE 5G` stripped the location). The coordinate text in the screenshot is the only
  source for the pin, and the plan's "cross-check the photo GPS against the screenshot" idea is
  dropped.
- One **review unit per screenshot** — a screenshot _is_ the dropped pin, i.e. the intended stop.
  Photos within ±400 s are attached as evidence (`photos`, `photoMeta`) instead of being forced
  into one-to-one pairs: in the dense parts of the run several photos sit between two screenshots
  and which one belongs to which pin cannot be decided from timestamps alone. 6 units have no
  photo at all, 27 units have more than one evidence photo.
- Besides the SHA-256 dedupe, 5 screenshots sit close to a neighbour and 2 have no photo nearby.
  They are all kept as units; the cross-check in Phase 3 detects the ones that are really the same
  pin (identical coordinates).

`crops/` holds, per unit, the search field upscaled 2× (`-searchbar.png`, the coordinates stay
readable with six decimals), the map band at native resolution (`-map.png`), the bottom address
card (`-bottom.png`) and up to two parking photos (`-photo-N.png`). The vision agents read these
instead of the 1080×2400 originals.

### Phase 1 — customer snapshot (`scripts/parking-import/export-customers.ts`)

Reads active customers with their coordinates, active Parkplätze and current photos, and groups
them by normalized address (`normalizeStreetName` folds accents and `ß`, turns `str.` into
`strasse`, strips punctuation; the postal code is part of the key). Everybody in one group shares
one parking spot and one photo.

Two sources:

- `pnpm parking:export-customers` — Prisma, against `PARKING_IMPORT_DATABASE_URL`, else
  `BACKUP_DATABASE_URL`, else `DATABASE_URL`.
- `pnpm parking:export-customers --from-dump .parking-import/raw` — the JSON files that
  `.parking-import/remote/dump-customers.sh` writes on the production server. **This is how the
  production snapshot was taken.** The script is upload-only and issues nothing but `SELECT`s, so
  no database credential ever leaves the host and nothing but query results comes back.

### Phase 2 — matching (orchestrator)

One vision agent per unit, each with only its own `units/uNN.json`. The full brief is
[`scripts/parking-import/PROMPT-UNIT.md`](../../scripts/parking-import/PROMPT-UNIT.md). The agent

1. transcribes the coordinates from the search field (latitude first, six decimals),
2. transcribes the map labels and the bottom card,
3. reads the parking photo(s),
4. runs `scripts/parking-import/nearest-customers.py --lat … --lng … --top 6 --radius 800` for the
   haversine distances and the address groups (so no agent does distance arithmetic by hand),
5. writes `results/uNN.json` with status `matched` / `ambiguous` / `no_match`, the customer ids,
   the distance, a confidence and its evidence.

`ambiguous` is an explicitly wanted answer: a wrong assignment silently sends a driver to the
wrong place, a question costs a human two minutes.

### Phase 3 — cross-check (`scripts/parking-import/check-results.py`)

Looks at all results together and at the customer data, and reports what a human has to decide:
coverage, one customer claimed by two pins, matches beyond the 400 m plausibility radius, address
groups that were not included in full, pins within 25 m of each other (the same spot screenshotted
twice), pins that coincide with a Parkplatz that already exists, and the customers no pin matched.

### Phase 4 — review report (`scripts/parking-import/build-report.py`)

`REPORT.html` is self-contained (thumbnails embedded as data URIs): one card per pin with the three
screenshot crops, the chosen parking photo, the matched customer(s) with distance, the confidence
and the agent's evidence, plus sections for everything that needs a decision. `REPORT.md` is the
same content as a table.

The parking photo per pin is chosen here, deterministically: every photo in the evidence window is
assigned to exactly one pin (the closest in time), so one photo is never attached to two customers.
A pin without an assigned photo is imported with its Parkplatz only and stays "photo missing".

`review.json` is the merged decision list — the single input of the import. The report marks each
pin `create` / `exists` / `review`.

### Phases 5–7 — photo prep and import

`prepare-uploads.py` resizes the chosen photo to the app's storage convention (longest edge 1600 px,
JPEG quality 0.80, EXIF removed — the same numbers as `src/lib/uploads.ts`) so that ~300 MB of
originals become ~13 MB of uploads, and records size and sha256 in `uploads.json`.

`scripts/parking-import/import-parking.ts` reads `review.json` + `uploads.json` and calls
`importParkingSpots` from
[`src/server/parking-import.ts`](../../src/server/parking-import.ts) — the engine lives in
`src/server` so the rules can be tested against a real database with the Fake storage
([`parking-import.integration.test.ts`](../../src/server/parking-import.integration.test.ts)).

Rules:

- **Dry run by default.** `--apply` is required to write anything.
- Spots go through `createParkingSpot` (audit `parking.create`, `via: office`) and the
  `PARKING_MAX_ACTIVE` limit applies.
- An active spot already within 5 m of the pin is left alone — that covers both a re-run and the
  spots the office entered by hand.
- Photos go through `attachCustomerPhoto` (`kind: PARKING`, audit `photo.add`). A customer who
  already has a _different_ current PARKING photo keeps it: the import never replaces a photo it did
  not store itself.
- Idempotent: the object key is derived deterministically from pin and customer
  (`storageKeyFor`), so a retry overwrites the same object instead of orphaning a new one, and
  `import-ledger.json` records what a run did.
- No deletes, no soft-delete changes, nothing outside `ParkingSpot` / `Photo` / `AuditLog`.

## Phase 3 — shop-entrance photos: dropped

The plan's Phase 3 proposed collecting shop-entrance (`STORE`) photos from Google Street View. It
was built, tried on all 32 addresses that lack a STORE photo, and then **dropped on 2026-10-28**.
The scripts and every captured image were removed again; nothing was attached to a customer.

It was dropped for two reasons:

- **The images are not usable.** Only **9 of 32** addresses have Street View coverage at all —
  Google has no imagery for the other 23, and Vienna's coverage is genuinely sparse. Of those 9,
  several are business-**interior** panoramas or night shots (Dresdner Straße, Döblinger
  Hauptstraße, Frauenstiftgasse, Jägerstraße 69, U-Bahn Bogen 181, Leopold-Ungar-Platz), i.e. not
  shopfronts at all.
- **The approach is Terms-of-Service-fraught.** Storing Street View imagery in an application is
  restricted by Google's Terms of Service, and scraping it via a headless browser also means
  accepting Google's cookie consent on the operator's behalf.

The `STORE` photo is what the driver recognises the shop by (D12), so this stays an open gap. The
clean routes, both already supported by the app, are:

- the office uploads a shop photo per customer (customer detail page, `kind: STORE`), or
- the driver photographs the entrance and it is saved through the existing driver capture path
  (D27) — drivers are on site anyway.

No further scripted import is planned for this; the parking half of the job is done.

## Result of the 2026-10 import

Applied to production on 2026-10-28 (vServer, `nudel` database, `nudel-photos` bucket):

|                                |                                                               |
| ------------------------------ | ------------------------------------------------------------- |
| Pins reviewed                  | 49                                                            |
| Parkplätze created             | **32** (31 pins; one pin covers a two-customer address group) |
| Parking photos added           | **30** (plus 1 customer whose existing photo was kept)        |
| Already present / duplicates   | 7 / 1                                                         |
| Still needing a decision       | 10 (4 ambiguous, 5 no match, 1 low confidence)                |
| Failures                       | 0                                                             |
| Customers with a Parkplatz     | 6 → 37                                                        |
| Customers with a parking photo | 5 → 35                                                        |

Verified afterwards against the production database: 38 active Parkplätze (6 pre-existing + 32),
35 current PARKING photos (5 + 30), and **no customer with more than one imported spot**. A second
`--apply` run created nothing (32 × `spot_exists`, 0 photos added), so the import is idempotent.
The bucket answers an anonymous `GET` with 403 (`scripts/check-storage-private.ts`).

The import ran from the developer machine against the production database through an SSH tunnel
(`ssh -N -L 15432:127.0.0.1:5432 root@<server>`) and the production MinIO at
`https://87.106.60.131/nudel-photos`, with the credentials read from `/etc/delivery-app.env` into
the process environment for the single command (`.parking-import/prod-env.ps1`, git-ignored) —
never written to disk and never printed.

> **Historical note (2026-11-04):** `87.106.60.131` is retired. A repeat run against production
> now targets the dedicated server **`65.109.100.79`** and reads the bucket at
> `https://nudel.stragas.com/nudel-photos`; the tunnel becomes
> `ssh -N -L 15432:127.0.0.1:5432 root@65.109.100.79`. The same import scripts work unchanged —
> only the host in those two commands changes.

## The 10 pins still open

`REPORT.html` shows them with everything the review agent saw; they stay out of the import until a
human decides.

- **ambiguous** — u34, u36, u43, u45: two or three plausible customers each, and the evidence that
  would decide between them (house number, shop sign) was not legible.
- **no match** — u08, u09, u30, u37, u49: no customer within ~400 m, or (u37) the nearest customer
  is a different business in a different building than the pin, its address card and its photo.
  u30 deserves a second look: its nearest candidate (1070 "088 liu") is 279 m away, i.e. _inside_
  the radius, and was rejected on street-label evidence rather than distance.
- **low confidence** — u35 (0.55): the map shows Josefstädter Straße and the only customer within
  800 m is 1045 "095 Jf" on that same street, 321 m away, but the bottom sheet carried no address.

To resolve one: edit `.parking-import/results/<pin>.json` (its `status`, `customerIds`, `spot`,
`confidence`), then `pnpm parking:report`, `pnpm parking:prepare-uploads`, and
`pnpm parking:import -- --apply --skip-pending`.

## Correcting a pin before the import

1. Open `.parking-import/REPORT.html` and find the pin.
2. Edit `.parking-import/results/<pin>.json` (its `status`, `customerIds`, `spot`, `confidence`).
3. `pnpm parking:check`, then `pnpm parking:report`.
4. `pnpm parking:import` (dry run) and only then `--apply`.

`--apply` refuses to run while any pin still has `action: review` (pass `--skip-pending` to import
the resolved pins now and consciously leave those alone), when `review.json` is older than a result
file, and when no object storage is configured.

## Deviations from the plan

| Plan said                                | What was done                                                                                                         | Why                                                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 52 screenshots / 51 photos, 5 duplicates | 49 screenshots / 47 photos, 7 duplicate groups                                                                        | the estimate predated the hash; the real mismatch is 5 screenshots without a photo and 2 photos without their own screenshot |
| pair each photo with a screenshot        | one unit per screenshot, photos attached as evidence                                                                  | timestamps cannot decide the dense stretches; the coordinate text is the ground truth anyway                                 |
| cross-check the photo's EXIF GPS         | dropped                                                                                                               | the phone zeroed every GPS field                                                                                             |
| `--apply` against `DATABASE_URL`         | `PARKING_IMPORT_DATABASE_URL` → `BACKUP_DATABASE_URL` → `DATABASE_URL` for the snapshot; `DATABASE_URL` for the write | production snapshot is read-only and happens over SSH                                                                        |
| resize inside the import script          | `prepare-uploads.py` (pillow) before the import                                                                       | keeps the TypeScript import free of a native image dependency; the uploaded bytes are reviewable first                       |
| import reads `results/*.json`            | import reads `review.json`                                                                                            | one merged, validated list; edits to `results/*.json` are folded in by re-running the report                                 |

## Adding a system dependency

`build-manifest.py`, `check-results.py`, `build-report.py` and `prepare-uploads.py` need
**pillow** (`python -m pip install pillow`) for EXIF, cropping and resizing. Nothing in
`src/` or the app depends on Python.
