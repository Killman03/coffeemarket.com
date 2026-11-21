#!/bin/bash
set -euo pipefail
# Used only by GitHub Actions with an isolated project/network and fresh volume.
[[ ${CI:-} = true && -n ${RUNNER_TEMP:-} ]] || { echo 'CI-only verification.' >&2; exit 1; }
repository=$(pwd)
export CALCULATOR_CONFIG_DIR="$RUNNER_TEMP/coffee-calculator-ci"
network=coffee-calculator-ci-proxy
compose=(docker compose -p coffee-calculator-ci --env-file "$CALCULATOR_CONFIG_DIR/compose.env" -f "$repository/compose.vps.yaml")
cleanup() {
  "${compose[@]}" --profile operations down --volumes --remove-orphans || true
  docker rm --force coffee-calculator-nginx-ci >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
node --import tsx deploy/configure.ts --origin http://127.0.0.1:3107 --revision "$GITHUB_SHA" \
  --proxy-network "$network" --directory "$CALCULATOR_CONFIG_DIR" --host-directory "$CALCULATOR_CONFIG_DIR"
docker network create "$network"
docker tag coffee-market-server:ci "ghcr.io/killman03/coffeemarket-calculator:$GITHUB_SHA"
docker tag coffee-market-migrator:ci "ghcr.io/killman03/coffeemarket-calculator-migrator:$GITHUB_SHA"
"${compose[@]}" config --quiet
"${compose[@]}" up -d --wait calculator-db
"${compose[@]}" run --rm migrate
"${compose[@]}" run --rm grant
"${compose[@]}" up -d --wait calculator-web
"${compose[@]}" run --rm --no-deps -T -e CI=true operator node --import tsx tests/compose/smoke.ts
database=$("${compose[@]}" ps -q calculator-db)
application=$("${compose[@]}" ps -q calculator-web)
test "$(docker port "$database")" = ''
test "$(docker inspect --format '{{.HostConfig.Memory}}' "$database")" = 402653184
test "$(docker inspect --format '{{.HostConfig.Memory}}' "$application")" = 536870912
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$application")" = true
test "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$database")" = 1
test "$(docker inspect --format '{{len .NetworkSettings.Networks}}' "$application")" = 2

# Exercise the actual append/rollback helper against a separate Nginx container.
proxy="$RUNNER_TEMP/coffee-calculator-proxy-ci"
mkdir -p "$proxy/certs/coffee-market-calculator/live/coffee-market-calculator" "$proxy/templates"
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=calculator.example.com \
  -keyout "$proxy/certs/coffee-market-calculator/live/coffee-market-calculator/privkey.pem" \
  -out "$proxy/certs/coffee-market-calculator/live/coffee-market-calculator/fullchain.pem" 2>/dev/null
printf '%s\n' 'server { listen 80; server_name original.example.com; location / { return 200 "original preserved"; } }' > "$proxy/templates/default.conf.template"
docker run -d --name coffee-calculator-nginx-ci --network "$network" \
  -v "$proxy/templates/default.conf.template:/etc/nginx/templates/default.conf.template:ro" \
  -v "$proxy/certs:/etc/letsencrypt:ro" nginx:alpine
for attempt in $(seq 1 30); do
  if docker exec coffee-calculator-nginx-ci nginx -t >/dev/null 2>&1; then break; fi
  sleep 1
done
node --import tsx deploy/render-proxy.ts --origin https://calculator.example.com --stage http > "$CALCULATOR_CONFIG_DIR/nginx-http.conf"
node --import tsx deploy/render-proxy.ts --origin https://calculator.example.com --stage tls > "$CALCULATOR_CONFIG_DIR/nginx-tls.conf"
apply() { sudo --preserve-env=CALCULATOR_CONFIG_DIR env CALCULATOR_NGINX_CONTAINER=coffee-calculator-nginx-ci CALCULATOR_NGINX_TEMPLATE="$proxy/templates/default.conf.template" bash deploy/proxy-append.sh "$1"; }
apply http
apply http
apply tls
test "$(grep -Fc '# COFFEE_CALCULATOR_HTTP_BEGIN' "$proxy/templates/default.conf.template")" = 1
test "$(grep -Fc '# COFFEE_CALCULATOR_TLS_BEGIN' "$proxy/templates/default.conf.template")" = 1
docker exec coffee-calculator-nginx-ci wget -qO- --header='Host: original.example.com' http://127.0.0.1/ | grep -Fq 'original preserved'
docker exec coffee-calculator-nginx-ci wget --no-check-certificate -qO- --header='Host: calculator.example.com' https://127.0.0.1/ | grep -Fq 'Compose isolation verified'
docker restart coffee-calculator-nginx-ci
for attempt in $(seq 1 30); do
  if docker exec coffee-calculator-nginx-ci wget -qO- --header='Host: original.example.com' http://127.0.0.1/ 2>/dev/null | grep -Fq 'original preserved'; then break; fi
  sleep 1
done
docker exec coffee-calculator-nginx-ci wget --no-check-certificate -qO- --header='Host: calculator.example.com' https://127.0.0.1/ | grep -Fq 'Compose isolation verified'
# A marked but invalid fragment must restore both persisted and live files.
printf '%s\n' '# COFFEE_CALCULATOR_HTTP_BEGIN' 'invalid_directive;' > "$CALCULATOR_CONFIG_DIR/nginx-http.conf"
# Use another marker so the helper attempts this append rather than skipping it.
sed -i 's/COFFEE_CALCULATOR_HTTP_BEGIN/COFFEE_CALCULATOR_HTTP_BROKEN/g' "$proxy/templates/default.conf.template"
docker exec coffee-calculator-nginx-ci sed -i 's/COFFEE_CALCULATOR_HTTP_BEGIN/COFFEE_CALCULATOR_HTTP_BROKEN/g' /etc/nginx/conf.d/default.conf
before=$(sha256sum "$proxy/templates/default.conf.template" | cut -d ' ' -f 1)
live_before=$(docker exec coffee-calculator-nginx-ci sha256sum /etc/nginx/conf.d/default.conf | cut -d ' ' -f 1)
if apply http; then echo 'Expected Nginx validation failure.' >&2; exit 1; fi
test "$(sha256sum "$proxy/templates/default.conf.template" | cut -d ' ' -f 1)" = "$before"
test "$(docker exec coffee-calculator-nginx-ci sha256sum /etc/nginx/conf.d/default.conf | cut -d ' ' -f 1)" = "$live_before"
docker exec coffee-calculator-nginx-ci nginx -t
docker exec coffee-calculator-nginx-ci wget -qO- --header='Host: original.example.com' http://127.0.0.1/ | grep -Fq 'original preserved'
echo 'Compose isolation and proxy persistence/rollback checks passed.'
