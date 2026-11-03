#!/usr/bin/env bash
# Puts Bread Sales online on Cloudflare's free plan: the website + API (a "Worker") and the database (D1).
# Used by .github/workflows/bread-sales.yml. It can also be run by hand from the server folder:
#   npm ci && npm run build:site
#   CLOUDFLARE_API_TOKEN=... ADMIN_PASSWORD=... bash cloudflare/deploy.sh
#
# Safe to run again and again. Each run:
#   1. finds the Cloudflare account and its workers.dev address (creates the address the first time),
#   2. creates the database "bread-sales" the first time, then applies new table changes (migrations/),
#   3. uploads the new version; creates the secret that signs logins once (never changes it afterwards,
#      so drivers stay logged in),
#   4. checks that the live website answers.
#
# Environment:
#   CLOUDFLARE_API_TOKEN   required (Cloudflare API token, see README)
#   CLOUDFLARE_ACCOUNT_ID  only needed if the token can see more than one account
#   ADMIN_PASSWORD         first password of the admin website (needed the first time, at least 8 characters)
#   WORKERS_SUBDOMAIN      name for the workers.dev address, used only if the account has none yet
#   APP_DOWNLOAD_URL, ANDROID_CERT_SHA256   optional settings passed to the website
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=bread-sales
API=${CF_API:-https://api.cloudflare.com/client/v4}
PLACEHOLDER=00000000-0000-0000-0000-000000000000
CONFIG=wrangler.deploy.jsonc
BODY=$(mktemp)
export WRANGLER_SEND_METRICS=false
trap 'rm -f "$BODY" "${SECRETS:-}"' EXIT

say() { printf '\n==> %s\n' "$*"; }
fail() {
  echo "::error::$*"
  exit 1
}
# cf METHOD PATH [JSON]: Cloudflare API call. Prints the HTTP status; the response body goes to $BODY.
cf() {
  curl -sS -o "$BODY" -w '%{http_code}' -X "$1" "$API$2" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' ${3:+--data "$3"}
}
# js EXPRESSION < json: prints the expression's value, with j = the parsed JSON ('' when missing).
js() {
  node -e '
    let s = "";
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j = null;
      try { j = JSON.parse(s); } catch { try { j = JSON.parse(s.slice(s.search(/[[{]/))); } catch {} }
      let v;
      try { v = eval(process.argv[1]); } catch { v = undefined; }
      process.stdout.write(v === undefined || v === null || v === false ? "" : String(v));
    });' "$1"
}
errors() { js 'j && JSON.stringify(j.errors || j)' <"$BODY"; }

[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || fail "CLOUDFLARE_API_TOKEN is not set"
[ -f site/index.html ] && [ -f site/driver/index.html ] || fail "Website files missing: run npm run build:site first"
if [ -n "${ADMIN_PASSWORD:-}" ] && [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
  fail "ADMIN_PASSWORD must be at least 8 characters"
fi

say "Cloudflare account"
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  status=$(cf GET '/accounts?per_page=50')
  [ "$status" = 200 ] || fail "Cloudflare did not accept CLOUDFLARE_API_TOKEN (HTTP $status): $(errors)"
  count=$(js 'j.result.length' <"$BODY")
  if [ "$count" != 1 ]; then
    fail "The API token can see ${count:-0} Cloudflare accounts. Add the secret CLOUDFLARE_ACCOUNT_ID (Cloudflare dashboard > Workers & Pages > Account ID on the right)."
  fi
  CLOUDFLARE_ACCOUNT_ID=$(js 'j.result[0].id' <"$BODY")
fi
export CLOUDFLARE_ACCOUNT_ID
echo "Account $CLOUDFLARE_ACCOUNT_ID"

say "workers.dev address"
status=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain")
sub=$(js 'j.success && j.result && j.result.subdomain' <"$BODY")
if [ -z "$sub" ]; then
  base=$(printf '%s' "${WORKERS_SUBDOMAIN:-bread-sales}" | tr 'A-Z' 'a-z' | sed -E 's/[^a-z0-9-]+/-/g; s/^-+//; s/-+$//' | cut -c1-40)
  for candidate in "$base" "$base-bakery" "$base-$((RANDOM % 9000 + 1000))"; do
    status=$(cf PUT "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" "{\"subdomain\":\"$candidate\"}")
    if [ "$status" = 200 ]; then
      sub=$candidate
      echo "Created the address $sub.workers.dev (a new address can take a few minutes to start working)"
      break
    fi
    echo "Could not use '$candidate' (HTTP $status): $(errors)"
  done
  [ -n "$sub" ] || fail "Could not create a workers.dev address. Open the Cloudflare dashboard > Workers & Pages once (it asks you to pick a subdomain), then run this again."
fi
URL="https://$NAME.$sub.workers.dev"
echo "$URL"

say "Database"
find_db() { npx wrangler d1 list --json | js "(j.find((d) => d.name === '$NAME') || {}).uuid"; }
dbid=$(find_db)
if [ -z "$dbid" ]; then
  echo "Creating the database '$NAME' (first time only, in Asia Pacific)"
  npx wrangler d1 create "$NAME" --location apac
  dbid=$(find_db)
fi
[ -n "$dbid" ] || fail "Could not find or create the D1 database '$NAME'"
echo "Database $NAME ($dbid)"
sed "s/$PLACEHOLDER/$dbid/" wrangler.jsonc >"$CONFIG"
npx wrangler d1 migrations apply "$NAME" --remote -c "$CONFIG"

say "Secrets"
status=$(cf GET "/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$NAME/secrets")
case "$status" in
  200) HAVE_JWT=$(js 'j.result.some((s) => s.name === "JWT_SECRET") && "yes"' <"$BODY") ;;
  404) HAVE_JWT="" ; echo "First upload of the website" ;;
  *) fail "Could not read the website's secrets (HTTP $status): $(errors)" ;;
esac
if [ -z "$HAVE_JWT" ] && [ -z "${ADMIN_PASSWORD:-}" ]; then
  fail "First setup needs the secret ADMIN_PASSWORD (the password for the admin website, at least 8 characters)"
fi
SECRETS=$(mktemp)
HAVE_JWT="$HAVE_JWT" node -e '
  const out = {};
  if (!process.env.HAVE_JWT) out.JWT_SECRET = require("crypto").randomBytes(48).toString("base64url");
  if (process.env.ADMIN_PASSWORD) out.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  process.stdout.write(JSON.stringify(out));' >"$SECRETS"
[ -n "$HAVE_JWT" ] && echo "Login secret already set (kept)" || echo "Creating the login secret"

say "Uploading the website"
vars=()
[ -n "${APP_DOWNLOAD_URL:-}" ] && vars+=(--var "APP_DOWNLOAD_URL:$APP_DOWNLOAD_URL")
[ -n "${ANDROID_CERT_SHA256:-}" ] && vars+=(--var "ANDROID_CERT_SHA256:$ANDROID_CERT_SHA256")
[ "$(cat "$SECRETS")" = "{}" ] || vars+=(--secrets-file "$SECRETS")
npx wrangler deploy -c "$CONFIG" ${vars[@]+"${vars[@]}"}

say "Checking the live website"
bash cloudflare/check.sh "$URL" "${ANDROID_CERT_SHA256:-}" site

if [ -n "${GITHUB_OUTPUT:-}" ]; then echo "url=$URL" >>"$GITHUB_OUTPUT"; fi
echo
echo "Bread Sales is online:"
echo "  Owner website:  $URL"
echo "  Driver app:     $URL/driver/"
