#!/bin/sh
set -eu
repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
configuration=${CALCULATOR_CONFIG_DIR:-/etc/coffee-market-calculator}
registry_configuration=${CALCULATOR_DOCKER_CONFIG:-/root/.docker-coffee-calculator}
exec docker --config "$registry_configuration" compose --project-name coffee-market-calculator \
  --env-file "$configuration/compose.env" \
  --file "$repository/compose.vps.yaml" "$@"
