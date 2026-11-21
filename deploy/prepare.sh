#!/bin/bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run this operation as root.' >&2; exit 1; }
revision=${1:?Supply the tested commit SHA}
origin=${2:?Supply the canonical HTTPS origin}
repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
configuration=${CALCULATOR_CONFIG_DIR:-/etc/coffee-market-calculator}
[[ "$configuration" = /* && ! -L "$configuration" ]] || { echo 'Use an absolute, non-symlink configuration directory.' >&2; exit 1; }
registry_configuration=${CALCULATOR_DOCKER_CONFIG:-/root/.docker-coffee-calculator}
network=${CALCULATOR_PROXY_NETWORK:-coffeemarketkz_coffeemarket_network}
[[ $(git -C "$repository" rev-parse HEAD) = "$revision" ]] || { echo 'Checkout and image revision must match.' >&2; exit 1; }
[[ -z $(git -C "$repository" status --porcelain --untracked-files=no) ]] || { echo 'Tracked source has local changes.' >&2; exit 1; }
docker info >/dev/null
docker network inspect "$network" >/dev/null
docker exec coffeemarket_nginx_prod nginx -t
if ss -H -lnt '( sport = :3107 )' | grep -q .; then echo 'Port 3107 is occupied; nothing started.' >&2; exit 1; fi
available_memory=$(awk '/^MemAvailable:/ { print $2 }' /proc/meminfo)
available_disk=$(df -Pk "$repository" | awk 'NR == 2 { print $4 }')
(( available_memory >= 1572864 && available_disk >= 6291456 )) || { echo 'Need at least 1.5 GiB available RAM and 6 GiB disk before this deployment.' >&2; exit 1; }
docker --config "$registry_configuration" pull "ghcr.io/killman03/coffeemarket-calculator-migrator:$revision"
docker --config "$registry_configuration" pull "ghcr.io/killman03/coffeemarket-calculator:$revision"
install -d -m 700 "$configuration"
docker --config "$registry_configuration" run --rm --user 0:0 --cap-drop=ALL \
  --security-opt=no-new-privileges:true --memory=256m --memory-swap=256m --cpus=0.25 \
  --volume "$configuration:/config" "ghcr.io/killman03/coffeemarket-calculator-migrator:$revision" \
  node --import tsx deploy/configure.ts --origin "$origin" --revision "$revision" \
  --proxy-network "$network" --host-directory "$configuration"
for stage in http tls; do
  temporary=$(mktemp "$configuration/.nginx-$stage.XXXXXXXX")
  docker --config "$registry_configuration" run --rm --network none --cap-drop=ALL \
    --security-opt=no-new-privileges:true --memory=256m --memory-swap=256m --cpus=0.25 \
    "ghcr.io/killman03/coffeemarket-calculator-migrator:$revision" \
    node --import tsx deploy/render-proxy.ts --origin "$origin" --stage "$stage" > "$temporary"
  mv -- "$temporary" "$configuration/nginx-$stage.conf"
done
echo 'Independent calculator configuration prepared. Existing services were not reconfigured.'
