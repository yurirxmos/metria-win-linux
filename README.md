# Metria Win/Linux

*A Windows and Linux desktop app that tracks your AI coding assistant usage in real time.*

<p align="center">
  <img src="https://i.imgur.com/shpAcSm.gif" alt="Metria demo" width="720" />
</p>

<p align="center">
  <a href="https://github.com/yurirxmos/metria-win-linux/stargazers"><img src="https://img.shields.io/github/stars/yurirxmos/metria-win-linux?style=flat-square" alt="Stars" /></a>
  <a href="https://github.com/yurirxmos/metria-win-linux/releases"><img src="https://img.shields.io/github/v/tag/yurirxmos/metria-win-linux?label=version&style=flat-square" alt="Version" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <a href="https://github.com/yurirxmos/metria-win-linux/commits"><img src="https://img.shields.io/github/commit-activity/m/yurirxmos/metria-win-linux?style=flat-square" alt="Commits" /></a>
</p>

## Contents

- [What it does](#what-it-does)
- [Key features](#key-features)
- [Supported providers](#supported-providers)
- [Multilingual support](#multilingual-support)
- [Download](#download)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Project layout](#project-layout)
- [Architecture and security](#architecture-and-security)
- [Contributing](#contributing)
- [License](#license)

## What it does

Metria shows real-time session quotas, rate limits, and monthly usage percentages for supported AI coding assistants.

- **Floating widget**: an unobtrusive edge widget for quick glances at active quotas.
- **Notch card**: hoverable compact card showing quota progress bars and relative reset timers.
- **System tray**: menu with per-provider usage stats, instant refresh, and settings controls.
- **Dashboard window**: detailed per-provider breakdown cards, source selection, and diagnostics.

The app stores settings in its own `com.metria.electron` application-data namespace.

## Key features

- **Multi-provider tracking**: Monitor Claude, Cursor, Antigravity, Codex, and OpenCode Go simultaneously.
- **Claude multi-profile discovery**: Automatically detects and separately tracks usage for multiple Claude profiles on the host and WSL.
- **Zero runtime dependencies**: Native SQLite parsing, CLI process execution, and typed isomorphic i18n with zero new third-party runtime libraries.
- **Multilingual internationalization**: Built-in support for English (`en-US`) and Brazilian Portuguese (`pt-BR`).
- **WSL integration**: Discovers and reads provider credentials across installed WSL Linux distributions on Windows.
- **Rate-limit resilience**: Exponential backoff and retry handling for provider APIs.

## Supported providers

Providers are enabled automatically when their local credentials or binaries are detected. Providers that are not configured remain accessible in Settings with diagnostics and reconnection commands.

- **Claude**: Credentials read from `~/.claude/.credentials.json` on Unix and the equivalent host or WSL location on Windows. Scans `~/.claude/` to discover and track multiple custom profiles independently.
- **Cursor**: Reads authentication tokens directly from local SQLite database (`state.vscdb`) using Node's native `node:sqlite`. Queries `/aiserver.v1.DashboardService/GetUsage` via Connect-RPC with automatic JWT expiration checks and HTTP 429 backoff retry.
- **Antigravity (AGY)**: Executes the local `agy` CLI (`agy status`) across system `$PATH` and standard install directories (`%LOCALAPPDATA%\Programs\Antigravity`, `/usr/local/bin`, `~/.local/bin`) with process watchdog timeout protection.
- **Codex**: Credentials and latest session read from `CODEX_HOME`/`~/.codex`, including WSL locations on Windows.
- **OpenCode Go**: Credentials read from `XDG_DATA_HOME`/`~/.local/share/opencode/auth.json` on Unix, `%APPDATA%` on Windows, or the WSL path.

Credentials are never committed or sent to external third parties. Metria reads them strictly at runtime from documented local system sources.

## Multilingual support

Metria features an isomorphic translation engine with compile-time type safety:

- **Supported languages**: English (`en-US`) and Brazilian Portuguese (`pt-BR`).
- **Auto-detection**: Automatically resolves system language preference via `app.getLocale()` in the Main process and `navigator.language` in the Renderer, defaulting non-Portuguese environments to English.
- **Language selector**: Allows manual override under Settings > Display.
- **Full coverage**: Localizes System Tray menus, tooltips, dock/tray badges, dashboard cards, modal dialogs, and relative reset countdowns (*"Reinicia em 2 h 15 min"* / *"Resets in 2 hr 15 min"*).
- **Data integrity**: Canonical provider identifiers and storage keys remain invariant, translating strictly at the presentation layer.

This version does not include phone pairing, the local PWA server, QR pairing, or mobile alerts. Those features belong to the native macOS application.

## Requirements

- Windows or Linux for the supported desktop application.
- Node.js 22+ and npm for building from source.
- Windows and Linux builds must be created and runtime-tested on their respective platforms.

## Quick start

Download the latest installer from [GitHub Releases](https://github.com/yurirxmos/metria-win-linux/releases), or build it on Windows or Linux:

```sh
npm ci
npm run package
```

The host-native installer is created in `release/`.

### Run in development

```sh
npm ci
npm run dev
```

Run the checks with:

```sh
npm run check
```

Push an `electron-v*` tag to package and publish a release:

```sh
git tag electron-v0.2.0
git push origin electron-v0.2.0
```

The updater uses the dedicated `electron-latest` channel in this repository.

## Project layout

- `src/main/`: Electron main process, provider implementations, settings, tray, window management, and IPC handlers.
- `src/preload/`: Typed `window.metria` context bridge.
- `src/renderer/`: React dashboard, settings modal, widget, and notch card.
- `src/shared/`: Shared TypeScript types, presenter helpers, and isomorphic translation dictionaries (`src/shared/i18n/`).
- `src/test/`: Unit test suites for providers, settings, WSL probing, and i18n translations.
- `resources/`: Electron icons and bundled provider assets.
- `.github/workflows/electron-release.yml`: Windows and Linux release automation.

## Architecture and security

- Browser windows use `contextIsolation: true`, `sandbox: true`, and `nodeIntegration: false`.
- The renderer has no Node or Electron imports.
- The preload exposes only typed, allowlisted `window.metria` methods.
- Every IPC method validates its sender and arguments.
- The app uses local packaged content and does not share storage with the native macOS app.

## Contributing

Contributions are welcome. Open an issue to report a bug or suggest a feature, or open a pull request with a focused change.

- Keep changes focused and follow the existing code style.
- Keep all repository text in en-US.
- Do not commit credentials, generated build output, or local configuration.
- Create and runtime-test Windows and Linux packages on their respective platforms.

## License

Metria is open source under MIT; see [LICENSE](LICENSE).
