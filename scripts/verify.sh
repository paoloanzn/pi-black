#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
temporary_root="$(mktemp -d)"
cleanup() {
    rm -rf "$temporary_root"
}
trap cleanup EXIT

source_dir="$temporary_root/pi"

cd "$repo_root"
sh -n install.sh
sh -n launcher.sh
sh -n test/installer.sh
./test/installer.sh
npm ci --ignore-scripts
npm run check

"$repo_root/scripts/prepare-pi-source.sh" "$source_dir"

if rg -n --hidden --glob '!.git/**' --glob '!out/**' --glob '!build/**' --glob '!release-assets/**' \
    'sk-ant-oat-[A-Za-z0-9_-]{20,}|CLAUDE_CODE_DEVICE_ID=[0-9a-f]{64}|CLAUDE_CODE_ACCOUNT_UUID=[0-9a-fA-F-]{36}' \
    "$repo_root"; then
    echo "Potential credential or private identifier found" >&2
    exit 1
fi

cd "$source_dir"
npm ci --ignore-scripts
npm run hydrate:model-data
npm --prefix packages/ai run check:model-data
npm --prefix packages/telemetry run build
npm --prefix packages/schema run build
node "$source_dir/node_modules/vitest/dist/cli.js" --run \
    packages/ai/test/anthropic-claude-code.test.ts \
    packages/ai/test/anthropic-auth-token.test.ts
npx tsc -p packages/ai/tsconfig.build.json --noEmit
npx biome check \
    packages/ai/src/api/anthropic-claude-code.ts \
    packages/ai/src/api/anthropic-messages.ts \
    packages/ai/test/anthropic-claude-code.test.ts \
    packages/ai/test/anthropic-auth-token.test.ts \
    packages/coding-agent/src/modes/interactive/interactive-mode.ts

echo "Plugin and patch verification passed"
