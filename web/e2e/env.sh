#!/bin/sh
# Manages the e2e environment (e2e/docker-compose.yml). Run from web/ through npm:
#   npm run e2e:up      build the SPA and the backend images, start everything
#   npm run e2e         run the Playwright tests against the running environment
#   npm run e2e:down    stop everything and delete its data
#   npm run e2e:ci      up, run the tests (extra arguments go to Playwright), down
#
# The SPA and both backend images are built from the working tree; E2E_COMMIT
# (default: git HEAD) is the commit embedded in the SPA and in `serve`, and
# `serve-next` gets "$E2E_COMMIT-next".
set -eu

cd "$(dirname "$0")/.."
E2E_COMMIT="${E2E_COMMIT:-$(git rev-parse HEAD)}"
export E2E_COMMIT

compose() {
  docker compose -f e2e/docker-compose.yml "$@"
}

up() {
  APP_COMMIT="$E2E_COMMIT" npm run build
  compose up -d --build --remove-orphans
}

down() {
  compose down -v --remove-orphans
}

cmd="${1:-}"
[ $# -gt 0 ] && shift
case "$cmd" in
  up) up ;;
  down) down ;;
  ci)
    trap down EXIT
    up
    npx playwright test "$@"
    ;;
  *)
    echo "usage: $0 up|down|ci [playwright args]" >&2
    exit 2
    ;;
esac
