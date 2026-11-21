#!/bin/bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run this operation as root.' >&2; exit 1; }
stage=${1:?Specify http or tls}
case "$stage" in http) marker='# COFFEE_CALCULATOR_HTTP_BEGIN';; tls) marker='# COFFEE_CALCULATOR_TLS_BEGIN';; *) exit 1;; esac
configuration=${CALCULATOR_CONFIG_DIR:-/etc/coffee-market-calculator}
container=${CALCULATOR_NGINX_CONTAINER:-coffeemarket_nginx_prod}
template=${CALCULATOR_NGINX_TEMPLATE:-/var/www/coffeemarket.kz/nginx/conf.d/coffeemarket.conf}
generated=/etc/nginx/conf.d/default.conf
fragment="$configuration/nginx-$stage.conf"
[[ -f "$template" && ! -L "$template" && -s "$fragment" ]] || { echo 'Template/fragment unavailable; nothing changed.' >&2; exit 1; }
grep -Fqx "$marker" "$fragment" || { echo 'Unexpected proxy fragment.' >&2; exit 1; }
exec 9>"$configuration/proxy-operation.lock"
flock -n 9 || { echo 'Another proxy operation is running.' >&2; exit 1; }
docker exec "$container" nginx -t
backup=$(mktemp -d "$configuration/nginx-backup.XXXXXXXX")
cp --preserve=mode,ownership,timestamps -- "$template" "$backup/template.conf"
docker cp "$container:$generated" "$backup/generated.conf"
chmod 600 "$backup/template.conf" "$backup/generated.conf"
restore() {
  result=${1:-$?}
  trap - ERR INT TERM
  cat "$backup/template.conf" > "$template"
  docker exec -i "$container" sh -c 'cat > /etc/nginx/conf.d/default.conf' < "$backup/generated.conf"
  echo 'Proxy operation failed; saved configuration restored. Running workers were not stopped.' >&2
  exit "$result"
}
trap restore ERR
trap 'restore 130' INT
trap 'restore 143' TERM
if ! grep -Fqx "$marker" "$template"; then
  printf '\n' >> "$template"
  cat "$fragment" >> "$template"
fi
if ! docker exec "$container" grep -Fqx "$marker" "$generated"; then
  { printf '\n'; cat "$fragment"; } | docker exec -i "$container" sh -c 'cat >> /etc/nginx/conf.d/default.conf'
fi
docker exec "$container" nginx -t
docker exec "$container" nginx -s reload
trap - ERR INT TERM
printf 'Calculator %s proxy configured. Backup: %s\n' "$stage" "$backup"
