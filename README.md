# Pi Black

Use your Claude Max (or Pro) subscription with Pi.

Pi Black is an unofficial Pi package that routes Anthropic OAuth requests through your existing Claude subscription usage by applying Claude Code 2.1.224 request conventions. The existing source patch and standalone-binary build system remain available as a fallback.

## Install

Pi Black has three independently versioned compatibility surfaces:

| Component | Compatible version |
| --- | --- |
| Pi package | Pi 0.84.1 or newer |
| Standalone `pi-black` binary | Based on Pi 0.84.1 |
| Claude Code protocol | 2.1.224 |

The Pi package requires Pi 0.84.1 or newer, with no upper version limit. Future Pi releases are trusted until an incompatibility is identified; the package peer dependencies are `"*"` because Pi supplies its core packages at runtime.

```sh
pi install git:github.com/paoloanzn/pi-black
```

Pi checks unpinned Git packages for updates in the background. When a newer Pi Black commit is available, Pi displays a package-update notice; apply it with:

```sh
pi update --extensions
```

For a reproducible install, pin a release tag:

```sh
pi install git:github.com/paoloanzn/pi-black@v0.84.1-cc2.1.224.7
```

Pinned packages do not move automatically. Install a newer tagged ref explicitly when you are ready to upgrade.

Then use Pi's normal Anthropic login:

```text
/login anthropic
```

The package replaces only the built-in Anthropic provider implementation and only transforms OAuth-token requests. It preserves Pi's credential storage, OAuth refresh, model behavior, tools, retries, streaming, and usage accounting. API-key requests and non-Anthropic providers pass through unchanged.

## Identity discovery

No identity environment variables are required. When Claude Code state exists, Pi Black reads the installation ID and account UUID from `~/.claude.json` (or the location selected by `CLAUDE_CONFIG_DIR`) in memory and adds matching request metadata. It does not copy, print, or persist those values.

Current subscription routing also works when that optional metadata is unavailable, as demonstrated by the standalone Pi Black binary with no identity variables in its environment.

## What it changes

For Anthropic OAuth requests, Pi Black reproduces the version-specific SDK-CLI request shape:

- exact billing and Agent SDK system-block ordering;
- the prompt-dependent `cc_version` suffix;
- structure-aware `cch` calculation using seeded XXH64;
- per-request `x-client-request-id` values;
- Claude Code session headers;
- automatically discovered identity metadata when available.

The checksum implementation validates and updates only the first billing system block. User content, tool results, descriptions, and nested `model` or `max_tokens` fields cannot redirect the placeholder patch.

## Verify the package

```sh
npm ci --ignore-scripts
npm run check
```

Public CI uses fake transports only. It never makes provider requests and requires no credentials.

## Standalone installer and binaries

The Pi package is the recommended installation. macOS and Linux users who prefer the standalone patched build can install the latest native release as `pi-black`:

```sh
curl -fsSL https://github.com/paoloanzn/pi-black/releases/latest/download/install.sh | sh
```

The installed launcher checks the latest release checksum at interactive startup. If the installed build differs, it offers to update before starting Pi Black. Downloads are checksum-verified; network-check failures are silent, while a rejected or failed update continues with the installed build. Set `PI_BLACK_NO_UPDATE_CHECK=1` to disable this check; Pi's `PI_OFFLINE=1` also disables it.

Install a specific standalone release with `PI_BLACK_RELEASE`:

```sh
curl -fsSL https://github.com/paoloanzn/pi-black/releases/latest/download/install.sh | PI_BLACK_RELEASE=v0.84.1-cc2.1.224.7 sh
```

The repository pins an immutable commit from [`paoloanzn/pi`](https://github.com/paoloanzn/pi), applies the patch under `patches/`, and delegates standalone compilation to Pi's release builder.

```sh
./scripts/verify.sh
./scripts/build-all.sh "$PWD/out"
```

Manual patch application:

```sh
git clone https://github.com/paoloanzn/pi.git pi
cd pi
git checkout --detach 7aca0d7b3e041a9e2b635e8370b2549f032932d6
git am ../pi-black/patches/*.patch
```

Build requirements and repeatability limits are in [`BUILD.md`](BUILD.md).

## Status and terms

This project is unofficial and is not affiliated with or endorsed by Anthropic or the upstream Pi project. Users must provide their own valid account credentials and determine whether use complies with applicable service terms. The compatibility mechanism is version-specific and must be revalidated when Claude Code or Pi changes.

No OAuth tokens, identifiers, captures, or private Claude state are included in the package or release artifacts. Pi and the derived patch are distributed under the MIT license; see [`LICENSE`](LICENSE).
