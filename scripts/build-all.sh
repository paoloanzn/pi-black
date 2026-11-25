#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
output_dir="${1:-$repo_root/out}"
if [[ "$output_dir" != /* ]]; then
    output_dir="$PWD/$output_dir"
fi
if [[ -e "$output_dir" ]]; then
    echo "Refusing to overwrite existing output path: $output_dir" >&2
    exit 1
fi

temporary_root="$(mktemp -d)"
cleanup() {
    rm -rf "$temporary_root"
}
trap cleanup EXIT

source_dir="$temporary_root/pi"
"$repo_root/scripts/prepare-pi-source.sh" "$source_dir"
cd "$source_dir"
npm ci --ignore-scripts
npm run hydrate:model-data
NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--experimental-strip-types" \
    "$source_dir/scripts/build-binaries.sh" --skip-install --offline-model-data --out "$output_dir"

printf 'Built release archives in %s\n' "$output_dir"
