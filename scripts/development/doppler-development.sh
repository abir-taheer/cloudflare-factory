#!/usr/bin/env bash
set -euo pipefail
umask 077

cd "$(dirname "$0")/../.."
: "${DOPPLER_API_PROJECT:?Set the API dev project}"
: "${DOPPLER_FRONTEND_PROJECT:?Set the frontend dev project}"
: "${DOPPLER_WORKFLOWS_PROJECT:?Set the workflows dev project}"
: "${DOPPLER_EXECUTOR_PROJECT:?Set the executor dev project}"

mkdir -p .local
export DOPPLER_DEV_DIRECTORY
DOPPLER_DEV_DIRECTORY=$(mktemp -d .local/doppler-dev.XXXXXX)

cleanup() {
  rm -f "$DOPPLER_DEV_DIRECTORY"/{api,frontend,workflows,executor}.env
  rm -f "$DOPPLER_DEV_DIRECTORY"/{api,frontend,workflows,executor}.json
  rm -f "$DOPPLER_DEV_DIRECTORY"/{base,resolved}.json
  rmdir "$DOPPLER_DEV_DIRECTORY"
}
trap cleanup EXIT

download() {
  if ! doppler secrets download --project "$2" --config dev --format env \
    --no-file --no-fallback --no-cache --no-check-version \
    > "$DOPPLER_DEV_DIRECTORY/$1.env" 2>/dev/null; then
    echo 'Development Doppler download failed; details suppressed' >&2
    exit 1
  fi
  chmod 600 "$DOPPLER_DEV_DIRECTORY/$1.env"
  if ! doppler secrets download --project "$2" --config dev --format json \
    --no-file --no-fallback --no-cache --no-check-version \
    > "$DOPPLER_DEV_DIRECTORY/$1.json" 2>/dev/null; then
    echo 'Development Doppler fidelity download failed; details suppressed' >&2
    exit 1
  fi
  chmod 600 "$DOPPLER_DEV_DIRECTORY/$1.json"
}

download api "$DOPPLER_API_PROJECT"
download frontend "$DOPPLER_FRONTEND_PROJECT"
download workflows "$DOPPLER_WORKFLOWS_PROJECT"
download executor "$DOPPLER_EXECUTOR_PROJECT"

docker compose -f compose.yaml config --format json \
  > "$DOPPLER_DEV_DIRECTORY/base.json" 2>/dev/null
docker compose -f compose.yaml -f compose.doppler.yaml config --format json \
  > "$DOPPLER_DEV_DIRECTORY/resolved.json" 2>/dev/null
docker compose -f compose.yaml run --rm --no-deps -T tools \
  npx tsx scripts/development/development-config-cli.ts "$DOPPLER_DEV_DIRECTORY" \
  "$DOPPLER_API_PROJECT" "$DOPPLER_FRONTEND_PROJECT" \
  "$DOPPLER_WORKFLOWS_PROJECT" "$DOPPLER_EXECUTOR_PROJECT"
docker compose -f compose.yaml -f compose.doppler.yaml up --build --wait
