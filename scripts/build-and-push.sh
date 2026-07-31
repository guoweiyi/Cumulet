#!/usr/bin/env bash
# =============================================================================
# Build the Cumulet image for multiple architectures and push it to a registry.
#
# A plain `docker build` on Apple Silicon produces an arm64-only image, so
# amd64 servers cannot pull it ("no matching manifest for linux/amd64"). This
# script uses BuildKit/buildx to build linux/amd64 + linux/arm64 in one pass.
# Attestations (provenance/sbom) are disabled so the published manifest list
# only contains plain platform entries — maximising compatibility with older
# Docker clients and registries.
#
# The multi-arch index is built into the local image store first, then pushed
# with plain `docker push` (daemon route) instead of buildx `--push`. Some
# environments (e.g. China networks behind a proxy) cannot reach the registry
# from the BuildKit worker, while the Docker daemon's own route works.
#
# Requirements: Docker Desktop or a buildx-capable Docker Engine with the
# target platforms available, and `docker login` to the destination registry.
#
# Usage:
#   ./scripts/build-and-push.sh                       # IMAGE + package.json version + latest
#   IMAGE=myregistry/cumulet ./scripts/build-and-push.sh
#   VERSION=0.3.0 ./scripts/build-and-push.sh
#   PLATFORMS="linux/amd64" ./scripts/build-and-push.sh   # single-arch build
#   NO_CACHE=true ./scripts/build-and-push.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-xiaoxiaoyunmiao/cumulet}"
VERSION="${VERSION:-$(node -p "require('${ROOT}/package.json').version")}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

NO_CACHE_FLAG=""
if [ "${NO_CACHE:-false}" = "true" ]; then
  NO_CACHE_FLAG="--no-cache"
fi

echo ">> Building ${IMAGE}:${VERSION} for ${PLATFORMS}"
docker buildx build \
  --platform "${PLATFORMS}" \
  --provenance=false \
  --sbom=false \
  ${NO_CACHE_FLAG} \
  -t "${IMAGE}:${VERSION}" \
  -t "${IMAGE}:latest" \
  .

echo ">> Pushing ${IMAGE}:${VERSION} and ${IMAGE}:latest"
docker push "${IMAGE}:${VERSION}"
docker push "${IMAGE}:latest"

echo ">> Done: ${IMAGE}:${VERSION} and ${IMAGE}:latest"
