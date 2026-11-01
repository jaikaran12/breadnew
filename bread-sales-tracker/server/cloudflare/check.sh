#!/usr/bin/env bash
# Checks that a live Bread Sales website answers correctly:
#   bash check.sh https://bread-sales.<your-name>.workers.dev [expected Android key fingerprint]
set -euo pipefail
base="${1:?Usage: check.sh <website address> [android-sha256-fingerprint]}"
base="${base%/}"
fingerprint="${2:-}"
echo "Checking $base"

# A brand-new workers.dev address can take a few minutes before it starts working.
tries=${WAIT_ATTEMPTS:-40}
for i in $(seq 1 "$tries"); do
  if curl -fsS --max-time 20 "$base/api/health" 2>/dev/null | grep -q '"ok":true'; then break; fi
  if [ "$i" = "$tries" ]; then echo "::error::$base/api/health did not answer"; exit 1; fi
  echo "Not answering yet (attempt $i of $tries), trying again in 15 seconds"
  sleep 15
done
echo "OK  /api/health (server and database)"

curl -fsS --max-time 30 "$base/" | grep -q '<title>Bread Sales'
echo "OK  admin website /"
curl -fsS --max-time 30 "$base/driver/" | grep -q 'id="root"'
echo "OK  driver app /driver/"
curl -fsS --max-time 30 "$base/stores/1" | grep -q '<title>Bread Sales'
echo "OK  admin website pages open directly (e.g. /stores/1)"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 -X POST -H 'content-type: application/json' \
  -d '{"phone":"0000000000","pin":"0000"}' "$base/api/driver/login")
[ "$code" = "401" ] || { echo "::error::driver login with a wrong PIN gave HTTP $code instead of 401"; exit 1; }
echo "OK  driver login refuses a wrong PIN"

code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$base/api/admin/me")
[ "$code" = "401" ] || { echo "::error::admin pages without login gave HTTP $code instead of 401"; exit 1; }
echo "OK  admin data needs a login"

headers=$(curl -fsS --max-time 30 -o /dev/null -D - -X OPTIONS -H 'Origin: https://localhost' \
  -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: authorization,content-type' \
  "$base/api/driver/sales")
echo "$headers" | grep -qi '^access-control-allow-origin: https://localhost'
echo "OK  the app may call the server (CORS)"

if [ -n "$fingerprint" ]; then
  curl -fsS --max-time 30 "$base/.well-known/assetlinks.json" | grep -qi "$fingerprint"
  echo "OK  /.well-known/assetlinks.json names the Android app's signing key (full screen app)"
fi
echo "All checks passed."
