# Self-hosted ORS and Photon for the vServer (NUD-156, NUD-157)

> **⛔ OBSOLETE since 2026-11-04 — read as history, not as instructions.**
> openrouteservice and Photon now run **on the dedicated server `65.109.100.79`** itself
> (containers `nudel-ors`, `photon-austria`, plus `nominatim` as Photon's data source), reached as
> `127.0.0.1:8082` / `127.0.0.1:2322`. There is **no reverse SSH tunnel any more**, and the old
> vServer `87.106.60.131` (and its 2 GB RAM constraint) is retired. `tunnel.ps1` now exits with an
> explanation instead of forwarding. To operate the services, work on the server, not on the dev PC.


The app runs on the client's vServer, which has **2 GB RAM** — far too little for
openrouteservice (needs ~4 GB for Austria) or Photon. So both run **on this development PC**
in Docker, and the vServer reaches them through a **reverse SSH tunnel** as
`127.0.0.1:8082` (ORS) and `127.0.0.1:2322` (Photon). Nothing is exposed to the internet:
the forwards listen on the server's loopback only (`GatewayPorts` stays at its default).

```
dev PC                                   vServer (2 GB)
┌───────────────────────┐   ssh -R     ┌──────────────────────────────┐
│ docker: nudel-ors     │◄────────────►│ delivery-app (systemd, 3100) │
│   127.0.0.1:8082      │              │   ORS_BASE_URL=http://127.0.0.1:8082/ors
│ docker: photon-austria│              │   PHOTON_URL=http://127.0.0.1:2322
│   127.0.0.1:2322      │              └──────────────────────────────┘
└───────────────────────┘
```

**Degradation is graceful:** if this PC sleeps or the tunnel drops, routing falls back to the
local heuristic (the tour shows "Näherungswerte") and geocoding to the Fake. The app keeps
working — it just stops being exact.

## Data outside the repository

~800 MB OSM extract plus the built graphs. Default location `C:\Users\niko\Desktop\nudel-infra`
(override with the `NUDEL_INFRA_DIR` environment variable):

```
nudel-infra/
├─ osm/austria-latest.osm.pbf    # https://download.geofabrik.de/europe/austria-latest.osm.pbf
├─ ors-graphs/                   # built by ORS on first start (~5 min, do not commit/copy around)
└─ photon-index/                 # built by Photon on first start
```

## Start everything

Windows PowerShell 5.1 blocks unsigned scripts by default (`… is not digitally signed`). Either
run with `-ExecutionPolicy Bypass`, or just copy the commands out of the scripts.

```powershell
# 1. routing (first start builds the Austria car graph: several minutes, ~4 GB RAM)
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-ors.ps1

# 2. geocoding (first start builds the Photon index: several minutes, ~2 GB RAM)
powershell -ExecutionPolicy Bypass -File deploy\local-services\start-photon.ps1

# 3. the tunnel the server uses (keeps itself alive; -Install registers a logon task)
powershell -ExecutionPolicy Bypass -File deploy\local-services\tunnel.ps1
powershell -ExecutionPolicy Bypass -File deploy\local-services\tunnel.ps1 -Status
```

Check from the server:

```bash
curl -s http://127.0.0.1:8082/ors/v2/health           # {"status":"ready", …}  (/ors/health does not exist)
curl -s 'http://127.0.0.1:2322/api?q=Mariahilfer+Straße+1+Wien&limit=1&lang=de'
```

A deploy (`deploy.bat`) starts **none** of this. After a deploy, and after every Docker Desktop
restart, check in this order: `docker ps` (both containers `Up`), the tunnel (`ss -ltnp | grep -E
':8082|:2322'` on the server), then the two `curl`s above. A container that was created before the
`--restart` flag existed keeps `restart=no`; fix it once with
`docker update --restart unless-stopped photon-austria` (done on 2026-10-31).

## Server configuration

`/etc/delivery-app.env` on the vServer (survives every `deploy.bat` since 2026-10-28):

```sh
ORS_BASE_URL=http://127.0.0.1:8082/ors
PHOTON_URL=http://127.0.0.1:2322
PHOTON_LANG=de
# ORS_API_KEY stays unset: a key would make the hosted API win over the local instance only
# for geocoding, and there is no hosted routing here any more.
```

Then `systemctl restart delivery-app`. `GET /delivery-app/api/health` reports whether routing
and geocoding use the local instances or a fallback.

## Why not simply ORS on the vServer?

Measured 2026-10-28: the box has 1.8 GB RAM, no JVM, and already runs Postgres, MinIO, the app
and two other apps. The ORS car graph for Austria alone wants ~2 GB heap.

## This is a stopgap, not the final setup

While the client's server is this 2 GB box, the **production** app depends on this PC being awake,
on Docker Desktop having started both containers and on the reverse tunnel being up. That is
acceptable for the pilot and wrong for the hand-over: the client must not depend on the developer's
machine.

Leaving this state behind, in this order:

1. Get a host that can carry it: a second vServer with ≥ 4 GB RAM for ORS + Photon, or a paid
   openrouteservice key (`ORS_API_KEY`, hosted routing **and** geocoding) which makes both
   containers unnecessary. Decide with the client; keep the key out of git (it belongs in
   `/etc/delivery-app.env` only).
2. Point the app at the new provider in `/etc/delivery-app.env` — the app reads these only at
   start-up: either keep the self-hosted shape and set `ORS_BASE_URL` / `PHOTON_URL` to the new
   host's address, or delete both and set `ORS_API_KEY` for the hosted openrouteservice. Never leave
   `127.0.0.1:8082` / `127.0.0.1:2322` behind on a server that no longer has a tunnel.
3. `systemctl restart delivery-app`, then re-check `GET /delivery-app/api/health` (`routing.mode`,
   `geocoding.mode`) and plan one tour plus geocode one new customer.
4. Only after that: stop the tunnel, delete the `NudelLieferApp-Tunnel` autostart entry
   (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`), and stop/remove the two containers.
5. Record the change in `backlog.md` §9 (decision log) and correct `docs/runbook.md` section 14 and
   the note in `AGENTS.md` — otherwise the next agent keeps believing production lives on this PC.

Until step 4 is done, rolling the vServer back also means: this PC must stay on.
