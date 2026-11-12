# OBSOLETE since 2026-11-04 — kept only as a record of how the old stopgap worked.
#
# openrouteservice and Photon now run ON the dedicated server 65.109.100.79 (containers
# nudel-ors / photon-austria), so the app reaches them as 127.0.0.1:8082 / 127.0.0.1:2322 without
# any tunnel, and the developer PC may sleep without degrading routing or geocoding. The old
# vServer the tunnel pointed at was retired and its data migrated.
#
# This script therefore refuses to run: a reverse forward into the retired host would expose this
# PC to a machine nobody looks at any more, and there is nothing left for it to serve.
#
#   pwsh -File deploy/local-services/tunnel.ps1   -> exits with an explanation
param(
  [switch]$Install,
  [switch]$Status
)

Write-Host 'This tunnel is obsolete (2026-11-04).' -ForegroundColor Yellow
Write-Host 'ORS and Photon run on 65.109.100.79 itself; no tunnel is needed.' -ForegroundColor Yellow
Write-Host 'The old vServer 87.106.60.131 is retired - do not forward to it.' -ForegroundColor Yellow
exit 1
