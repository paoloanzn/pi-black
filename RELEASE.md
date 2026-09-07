# Pi Black

Use your Claude Max (or Pro) subscription with Pi.

This release updates the Claude Code protocol to 2.1.258 in both the Pi package and standalone binaries, addressing `claude_code_version_too_old` errors. The standalone build remains based on Pi 0.84.1; the package supports Pi 0.84.1 or newer.

This unofficial release is installable as a Pi package from its Git tag. It also applies the repository's retained patch series to the immutable Pi commit recorded in `config/pi.env` and builds Pi's six supported standalone targets.

Install the package with:

```sh
pi install git:github.com/paoloanzn/pi-black@<tag>
```

On macOS or Linux, install the standalone build and its interactive update detector with:

```sh
curl -fsSL https://github.com/paoloanzn/pi-black/releases/latest/download/install.sh | sh
```

Binary assets include:

- macOS arm64 and x64 archives;
- Linux arm64 and x64 archives;
- Windows arm64 and x64 archives;
- the macOS/Linux installer and auto-update launcher;
- the exact `git am` patch series;
- pinned source/build metadata;
- SHA-256 checksums and generated provenance.

This project is unofficial and is not affiliated with or endorsed by Anthropic or the upstream Pi project. It contains no OAuth credentials, account identifiers, device identifiers, captures, or private system prompts. Users must provide their own credentials and are responsible for complying with applicable service terms.
