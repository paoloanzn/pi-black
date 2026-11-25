# Repeatable build

The source repository, base commit, Pi version, Node major version, and Bun version are pinned in `config/pi.env`. The patch itself contains a `base-commit` trailer.

Pi's model catalog is hydrated from upstream model APIs during each build, matching Pi's release process. Those APIs are mutable, so rebuilding later is not guaranteed to produce byte-for-byte identical archives. Published binaries are identified by release checksums and provenance.

## Prerequisites

- Git
- Node.js 22
- Bun 1.4.4
- npm
- standard archive tools (`tar`, `gzip`, `zip`, `unzip`)

On Ubuntu, install Pi's image-build dependencies:

```sh
sudo apt-get update
sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```

## Prepare patched source

```sh
./scripts/prepare-pi-source.sh "$PWD/build/pi"
```

This clones only the pinned repository, checks out the exact commit, applies `patches/*.patch` with `git am`, and verifies the resulting parent commit.

## Build every supported target

```sh
./scripts/build-all.sh "$PWD/out"
```

Expected archives:

```text
pi-darwin-arm64.tar.gz
pi-darwin-x64.tar.gz
pi-linux-arm64.tar.gz
pi-linux-x64.tar.gz
pi-windows-arm64.zip
pi-windows-x64.zip
```

The helper delegates compilation and runtime-asset staging to Pi's own `scripts/build-binaries.sh` with bundled model data. It installs dependencies using the pinned Pi lockfile and `npm ci --ignore-scripts`.

## Verify without building binaries

```sh
./scripts/verify.sh
```

This checks the immutable base, applies the patch in a temporary clone, scans repository files for obvious leaked credentials, runs the two focused tests, validates model data, and type-checks the AI package.
