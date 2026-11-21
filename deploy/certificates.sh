#!/bin/bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run this operation as root.' >&2; exit 1; }
operation=${1:?Specify issue or renew}
case "$operation" in issue|renew) ;; *) exit 1;; esac
configuration=${CALCULATOR_CONFIG_DIR:-/etc/coffee-market-calculator}
container=${CALCULATOR_NGINX_CONTAINER:-coffeemarket_nginx_prod}
domain=$(cat "$configuration/domain")
acme=/etc/letsencrypt/coffee-market-calculator
webroot=/etc/letsencrypt/coffee-market-calculator-webroot
install -d -m 700 "$acme" "$configuration/acme-work" "$configuration/acme-logs"
install -d -m 755 "$webroot/.well-known/acme-challenge"
exec 9>"$configuration/certificate-operation.lock"
flock -n 9 || { echo 'Another calculator certificate operation is running.' >&2; exit 1; }
arguments=(--rm --memory=256m --memory-swap=256m --cpus=0.25 --pids-limit=64 --cap-drop=ALL --security-opt=no-new-privileges:true
  --volume "$acme:/etc/letsencrypt"
  --volume "$configuration/acme-work:/var/lib/letsencrypt"
  --volume "$configuration/acme-logs:/var/log/letsencrypt"
  --volume "$webroot:/var/www/acme")
if [[ "$operation" = issue ]]; then
  docker run -it "${arguments[@]}" certbot/certbot:v5.10.0 certonly \
    --webroot --webroot-path /var/www/acme --cert-name coffee-market-calculator -d "$domain"
else
  docker run "${arguments[@]}" certbot/certbot:v5.10.0 renew --cert-name coffee-market-calculator --non-interactive --quiet
  docker exec "$container" nginx -t
  docker exec "$container" nginx -s reload
fi
