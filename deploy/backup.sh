#!/bin/bash
set -euo pipefail
[[ $(id -u) = 0 ]] || { echo 'Run this operation as root.' >&2; exit 1; }
repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
directory=${CALCULATOR_BACKUP_DIR:-/var/backups/coffee-market-calculator}
install -d -m 700 "$directory"
available=$(df -Pk "$directory" | awk 'NR == 2 { print $4 }')
(( available >= 1048576 )) || { echo 'Less than 1 GiB disk available; check backup storage.' >&2; exit 1; }
temporary=$(mktemp --suffix=.pending "$directory/coffee-market-$(date -u +%Y%m%dT%H%M%SZ).XXXXXXXX")
trap 'rm -f -- "$temporary"' EXIT
bash "$repository/deploy/compose.sh" exec -T calculator-db \
  pg_dump --username postgres --dbname coffee_market --format custom > "$temporary"
test -s "$temporary"
destination=${temporary%.pending}.dump
ln -- "$temporary" "$destination"
printf 'Backup completed: %s\n' "$destination"
