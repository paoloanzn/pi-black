#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../config/pi.env
source "$repo_root/config/pi.env"

destination="${1:-}"
if [[ -z "$destination" ]]; then
    echo "Usage: $0 <new-source-directory>" >&2
    exit 2
fi
if [[ -e "$destination" ]]; then
    echo "Refusing to overwrite existing path: $destination" >&2
    exit 1
fi

mkdir -p "$(dirname "$destination")"
git clone --filter=blob:none --no-checkout "$PI_REPOSITORY" "$destination"
git -C "$destination" fetch --no-tags origin "$PI_BASE_COMMIT"
git -C "$destination" checkout --detach "$PI_BASE_COMMIT"

actual_base="$(git -C "$destination" rev-parse HEAD)"
if [[ "$actual_base" != "$PI_BASE_COMMIT" ]]; then
    echo "Checked-out base $actual_base does not match $PI_BASE_COMMIT" >&2
    exit 1
fi

git -C "$destination" config user.name "Pi OAuth Compatibility Maintainers"
git -C "$destination" config user.email "noreply@example.invalid"
patches=("$repo_root"/patches/*.patch)
if [[ ! -e "${patches[0]}" ]]; then
    echo "No patches found in $repo_root/patches" >&2
    exit 1
fi
git -C "$destination" -c commit.gpgSign=false am --committer-date-is-author-date "${patches[@]}"

patch_count="${#patches[@]}"
actual_series_base="$(git -C "$destination" rev-parse "HEAD~$patch_count")"
actual_patched="$(git -C "$destination" rev-parse HEAD)"
if [[ "$actual_series_base" != "$PI_BASE_COMMIT" ]]; then
    echo "Patch series base $actual_series_base does not match $PI_BASE_COMMIT" >&2
    exit 1
fi
if [[ "$actual_patched" != "$PI_PATCHED_COMMIT" ]]; then
    echo "Patched commit $actual_patched does not match $PI_PATCHED_COMMIT" >&2
    exit 1
fi

for protocol_source in "$repo_root/src/claude-code-protocol.ts" "$destination/packages/ai/src/api/anthropic-claude-code.ts"; do
    if ! grep -Fxq "export const CLAUDE_CODE_VERSION = \"$CLAUDE_CODE_PROTOCOL_VERSION\";" "$protocol_source"; then
        echo "Claude Code protocol in $protocol_source does not match $CLAUDE_CODE_PROTOCOL_VERSION" >&2
        exit 1
    fi
done

printf 'Prepared Pi %s\nBase:    %s\nPatched: %s\n' "$PI_VERSION" "$actual_series_base" "$actual_patched"
