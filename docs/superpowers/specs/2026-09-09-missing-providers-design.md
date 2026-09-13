# Spec: Implement Missing Providers (Cursor, Antigravity) and Claude Multi-Profile in Metria Electron

- **Date**: 2026-09-09
- **Status**: Draft (Approved in Brainstorming)
- **Target Repository**: `metria-win-linux`
- **Reference Repository**: `metria` (macOS native)

---

## 1. Overview & Objectives

Metria is a desktop assistant usage tracker that displays real-time quotas and session usage across multiple AI tools. The native macOS version (`metria`) supports five providers: **Claude** (including multi-profile support), **Codex**, **OpenCode Go**, **Cursor**, and **Antigravity**.

The cross-platform Electron/TypeScript version (`metria-win-linux`) currently only implements three single-account providers: **Claude**, **Codex**, and **OpenCode Go**.

This specification defines the architecture, data models, IPC protocols, and platform adaptations to achieve full parity with the macOS application by implementing:
1. **Cursor Provider** (`CursorProvider`): Reading credentials from Cursor's SQLite global storage (`state.vscdb`) on Linux/Windows, verifying JWT expiration locally, querying Cursor's Connect-RPC usage API, and displaying model & API quotas.
2. **Antigravity Provider** (`AntigravityProvider`): Locating Google's `agy` CLI on host systems (Linux/Windows) and WSL, executing `agy -p /usage` with a 30-second watchdog timeout, and parsing tabular quota outputs across Gemini and Claude/GPT model families.
3. **Claude Multi-Account Support** (`ClaudeProfile`): Discovering local profile directories (`~/.claude-<slug>`) created via `CLAUDE_CONFIG_DIR`, validating legitimate installations with file markers, and assigning each account its own independent widget ring and settings row.
4. **Modular Architecture Refactoring**: Splitting the monolithic `src/main/providers.ts` into isolated, testable modules under `src/main/providers/`.
5. **Presentation & Assets**: Adding high-resolution logos, SVG ring gradient definitions, reconnect commands, and detailed diagnostics for all new providers.

---

## 2. Core Architecture & Data Models

### 2.1. Provider Identification: `ProviderKind` and `ProviderID`

In `src/shared/types.ts`:

```ts
export type ProviderKind = "Claude" | "Codex" | "OpenCode Go" | "Cursor" | "Antigravity";

export const ALL_PROVIDER_KINDS: ProviderKind[] = [
  "Claude",
  "Codex",
  "OpenCode Go",
  "Cursor",
  "Antigravity"
];

export function isProviderKind(value: unknown): value is ProviderKind {
  return (
    value === "Claude" ||
    value === "Codex" ||
    value === "OpenCode Go" ||
    value === "Cursor" ||
    value === "Antigravity"
  );
}

export interface ProviderID {
  kind: ProviderKind;
  slug?: string; // Defined for non-default profiles (e.g., "work" for ~/.claude-work)
  id: string; // "Claude", "Claude-work", "Codex", "Cursor", "Antigravity"
  displayName: string; // "Claude", "Claude (work)", "Codex", "Cursor", "Antigravity"
}

export function parseProviderId(raw: string): ProviderID {
  for (const kind of ALL_PROVIDER_KINDS) {
    if (raw === kind) {
      return { kind, id: kind, displayName: kind };
    }
    const prefix = `${kind}-`;
    if (raw.startsWith(prefix)) {
      const slug = raw.slice(prefix.length);
      return {
        kind,
        slug,
        id: raw,
        displayName: `${kind} (${slug})`
      };
    }
  }
  return { kind: "Claude", id: raw, displayName: raw };
}
```

### 2.2. Provider Usage Representation

`ProviderUsage` carries both the instance `id` and the underlying `kind`:

```ts
export interface ProviderUsage {
  id: string; // e.g. "Claude", "Claude-work", "Cursor", "Antigravity"
  kind: ProviderKind;
  accountLabel: string | null;
  windows: UsageWindow[];
  updatedAt: string | null;
  error: string | null;
  available: boolean;
  setupHint: string;
}
```

### 2.3. Settings & Persistence

In `src/shared/types.ts` and `src/main/settings.ts`:
- `enabledProviders: string[]`: List of enabled `id` strings (e.g. `["Claude", "Claude-work", "Cursor", "Antigravity"]`).
  - Migration: Existing settings containing `["Claude", "Codex", "OpenCode Go"]` remain fully valid.
- `providerSource: Partial<Record<string, ProviderSourceChoice>>`: Map keyed by provider `id` pointing to `{ location: "host" | "wsl", distro?: string }`.
- `hiddenUsageWindowTitles: Partial<Record<string, string[]>>`: Hidden window titles keyed by provider `id` or base `kind`.

---

## 3. Provider Implementations

### 3.1. Cursor Provider (`src/main/providers/cursor.ts`)

#### 3.1.1. Credential Extraction via `state.vscdb`
Cursor is an Electron/VS Code fork that persists its state in a SQLite database:
- **Linux Path**: `join(env.XDG_CONFIG_HOME || join(home, ".config"), "Cursor", "User", "globalStorage", "state.vscdb")`
- **Windows Path**: `join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor", "User", "globalStorage", "state.vscdb")`
- **Darwin Path**: `join(home, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb")`

The database contains table `ItemTable(key TEXT, value TEXT)`.
Reading is performed via Node.js built-in `node:sqlite`:
```ts
import { DatabaseSync } from "node:sqlite";

export class CursorStateStore {
  constructor(private readonly dbPath: string) {}

  readToken(): string | null {
    if (!existsSync(this.dbPath)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.dbPath, { readOnly: true, open: true });
      const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1");
      const row = stmt.get("cursorAuth/accessToken") as { value?: string } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    } catch {
      return null;
    } finally {
      if (db) {
        try { db.close(); } catch { /* Ignore close error */ }
      }
    }
  }
}
```

#### 3.1.2. Pre-flight JWT Expiration Check
Before initiating network requests, Cursor's JWT `exp` timestamp is verified without cryptographic verification:
```ts
export function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}
```
If expired, the provider returns a descriptive error: `"Sign in to Cursor again to refresh usage."`

#### 3.1.3. Connect-RPC Usage API Call
- **URL**: `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
- **Headers**:
  - `Authorization: Bearer <token>`
  - `Content-Type: application/json`
  - `Connect-Protocol-Version: 1`
  - `User-Agent: Metria-Electron/0.1`
- **Body**: `JSON.stringify({ includePooledUsage: true })`
- **Retry Mechanism**: Max 3 attempts with exponential backoff on HTTP 429 (`Retry-After`).

#### 3.1.4. Window Mapping
1. Primary Plan Limits:
   - `planUsage.autoPercentUsed` -> Window `"Cursor models"`
   - `planUsage.apiPercentUsed` -> Window `"API usage"`
2. Spend Limit Fallback (for Enterprise / Team pooled seats):
   - Measure priority: `individualUsed / individualLimit`, `overallUsed / overallLimit`, or `planUsage.totalPercentUsed`.
   - Mapped to Window `"This cycle"` with used and limit dollar/cent amounts if present.
3. Reset Date:
   - `billingCycleEnd`: Unix timestamp in milliseconds converted to ISO8601 string.

---

### 3.2. Antigravity Provider (`src/main/providers/antigravity.ts`)

#### 3.2.1. Executable Discovery
The Google Antigravity CLI binary `agy` is resolved in order:
- **Linux**:
  1. `join(home, ".local", "bin", "agy")`
  2. Executables named `agy` in directories listed in `$PATH`
- **Windows**:
  1. `join(home, ".local", "bin", "agy.cmd")`
  2. `join(home, ".local", "bin", "agy.exe")`
  3. Search for `agy.cmd` / `agy.exe` in `%PATH%`

#### 3.2.2. Safe Subprocess Execution & Watchdog
A signed-out `agy` process blocks indefinitely without writing output. A strict 30-second watchdog terminates the child process and claims the result:
```ts
import { spawn } from "node:child_process";

export async function runAgyUsage(executable: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ["-p", "/usage"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { child.kill("SIGTERM"); } catch { /* Ignore */ }
        reject(new Error("Antigravity CLI timed out."));
      }
    }, timeoutMs);

    child.on("error", (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        if (code === 0 && output.trim()) resolve(output);
        else reject(new Error(`agy exited with code ${code}`));
      }
    });
  });
}
```

#### 3.2.3. Output Parsing
Input sample:
```
Quota:
Gemini Models\tWeekly Limit Remaining\t52%\t2026-09-11T19:35:01Z
Gemini Models\tFive Hour Limit Remaining\t98%\t2026-09-09T08:52:43Z
Claude and GPT models\tWeekly Limit Remaining\t32%\t2026-09-11T23:26:47Z
Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-09T08:54:19Z
```

Parsing rules:
1. Split into lines and tab delimiters (`\t`). Discard lines with fewer than 4 parts or headers like `"Quota:"`.
2. Family identification: `part[0].toLowerCase().includes("gemini")` ? `Gemini` : `Others`.
3. Horizon identification:
   - Contains `"five hour"`, `"5-hour"`, or `"5 hour"` -> `FiveHour`
   - Contains `"week"` -> `Weekly`
4. Used Percentage: CLI reports remaining percentage; compute `percent = Math.max(0, Math.min(100, 100 - remaining))`.
5. Canonical Window Ordering:
   1. `"5-hour Gemini"`
   2. `"Weekly Gemini"`
   3. `"5-hour other models"`
   4. `"Weekly other models"`

---

### 3.3. Claude Multi-Profile (`src/main/providers/claude.ts`)

#### 3.3.1. Profile Discovery (`ClaudeProfile`)
Scans the user home directory:
- Default Profile: `~/.claude` (slug = `undefined`, providerId = `"Claude"`).
- Profile Discovery: All subdirectories matching `~/.claude-<slug>`.
- Validation Markers: Directory must contain at least one of:
  `["sessions", "projects", "settings.json", "history.jsonl", ".claude.json", ".credentials.json"]`.
- Stable Sorting: Default profile always first, followed by extra profiles sorted alphabetically by `slug`.

#### 3.3.2. Credentials & Account Info Resolution
- Credentials:
  - Default: `~/.claude/.credentials.json`
  - Profile: `~/.claude-<slug>/.credentials.json`
  - Extract OAuth bearer token from `claudeAiOauth.accessToken`.
- Account Label:
  - Default: Check `~/.claude.json` (`oauthAccount.emailAddress`) or `.credentials.json` (`claudeAiOauth.email` / `email`).
  - Profile: Check `~/.claude-<slug>/.claude.json` or `~/.claude-<slug>/.credentials.json`.
- Reconnect Command:
  - Default: `claude auth login`
  - Profile: `CLAUDE_CONFIG_DIR=~/.claude-<slug> claude auth login`

---

## 4. WSL & System Integration

### 4.1. Path Resolution (`src/main/provider-paths.ts`)
Updated `ProviderPaths` structure:
```ts
export interface ProviderPaths {
  codexAuth: string;
  codexSessions: string;
  openCodeAuth: string;
  claudeCredentials: string;
  cursorStateDb: string;
  antigravityBin: string;
}

export function providerPaths(context: PathEnvironment): ProviderPaths {
  const codexRoot = context.env.CODEX_HOME || join(context.home, ".codex");
  const dataRoot = context.platform === "win32"
    ? (context.env.APPDATA || join(context.home, "AppData", "Roaming"))
    : (context.env.XDG_DATA_HOME || join(context.home, ".local", "share"));
  const configRoot = context.platform === "win32"
    ? (context.env.APPDATA || join(context.home, "AppData", "Roaming"))
    : (context.env.XDG_CONFIG_HOME || join(context.home, ".config"));

  return {
    codexAuth: join(codexRoot, "auth.json"),
    codexSessions: join(codexRoot, "sessions"),
    openCodeAuth: join(dataRoot, "opencode", "auth.json"),
    claudeCredentials: join(context.home, ".claude", ".credentials.json"),
    cursorStateDb: join(configRoot, "Cursor", "User", "globalStorage", "state.vscdb"),
    antigravityBin: context.platform === "win32"
      ? join(context.home, ".local", "bin", "agy.cmd")
      : join(context.home, ".local", "bin", "agy")
  };
}
```

### 4.2. WSL Shell Capabilities (`src/main/wsl.ts`)
- Probe Script: Updated to detect `agy` and Claude profiles in WSL distros:
  ```bash
  for f in codex_auth:"$HOME/.codex/auth.json" codex_sessions:"$HOME/.codex/sessions" opencode:"$HOME/.local/share/opencode/auth.json" claude:"$HOME/.claude/.credentials.json" antigravity:"$HOME/.local/bin/agy"; do
    name="${f%%:*}"; target="${f#*:}"
    if [ -e "$target" ]; then echo "$name"; fi
  done
  ```
- Command Execution in WSL:
  `WslShell.execCommand(distro: string, cmd: string, timeoutMs?: number): Promise<string>` executing:
  `wsl.exe -d <distro> sh -c "<cmd>"`
  Decodes UTF-8/UTF-16 output safely and terminates on timeout.

---

## 5. UI, Presentation & Assets

### 5.1. Logos & Static Assets
- Official PNG assets copied from `metria/Assets/` into `resources/assets/`:
  - `cursor-logo.png`
  - `antigravity-logo.png`
- `scripts/copy-renderer-assets.cjs`:
  Updated to bundle `cursor-logo.png` and `antigravity-logo.png` into `dist/renderer/`.
- `PROVIDER_LOGOS` in `src/shared/types.ts`:
  ```ts
  export const PROVIDER_LOGOS: Record<ProviderKind, string> = {
    "Claude": "claude-logo.png",
    "Codex": "codex-logo.png",
    "OpenCode Go": "opencode-logo.png",
    "Cursor": "cursor-logo.png",
    "Antigravity": "antigravity-logo.png"
  };
  ```

### 5.2. Widget & Ring Presentation (`src/renderer/widget.tsx`)
- Ring Accent Colors:
  ```ts
  const ACCENT: Record<ProviderKind, string> = {
    "Claude": "#ff9f0a",
    "Codex": "#0a84ff",
    "OpenCode Go": "#ffffff",
    "Cursor": "#8e8e93",
    "Antigravity": "#3b82f6"
  };
  ```
- Gradients:
  - Codex: Blue-to-purple linear gradient.
  - Cursor: `#cursor-ring` SVG linear gradient from `#8e8e93` to `#ffffff`.

### 5.3. Window Titles in Settings (`src/renderer/index.tsx`)
```ts
const WINDOW_TITLES: Record<ProviderKind, string[]> = {
  Claude: ["Current session", "All models"],
  Codex: ["Current session", "All models"],
  "OpenCode Go": ["Current session", "This week", "This month"],
  Cursor: ["Cursor models", "API usage", "This cycle"],
  Antigravity: [
    "5-hour Gemini",
    "Weekly Gemini",
    "5-hour other models",
    "Weekly other models"
  ]
};
```

### 5.4. Reconnect & Diagnostics (`src/main/index.ts`)
- Reconnect command generator:
  - `Claude` (default): `claude auth login`
  - `Claude-<slug>`: `CLAUDE_CONFIG_DIR=~/.claude-<slug> claude auth login`
  - `Codex`: `codex login`
  - `OpenCode Go`: `opencode auth login`
  - `Cursor`: `cursor` (instructs user to launch Cursor and sign in)
  - `Antigravity`: `agy auth login`
- Diagnostics handler (`metria:diagnose`):
  - Returns detailed host capability status (e.g. SQLite DB path resolved, token validity, CLI executable path found, WSL availability).

---

## 6. Testing & Quality Assurance

### 6.1. Unit Tests
1. `src/test/cursor.test.ts`:
   - StateStore reading from temporary SQLite database created with `DatabaseSync`.
   - JWT decoding and expiration checks (valid vs expired tokens).
   - Rate limit 429 backoff and window parsing.
2. `src/test/antigravity.test.ts`:
   - Output parser against standard `agy` tabular output with varied whitespace and order.
   - Watchdog timeout behavior when child process does not return.
   - Handling of missing binary / non-zero exit codes.
3. `src/test/claude-profile.test.ts`:
   - Profile directory discovery (`~/.claude`, `~/.claude-work`, invalid directories ignored).
   - Marker verification logic.
   - Credential and account email extraction.
4. `src/test/provider-paths.test.ts`:
   - Verifies platform paths across `linux` and `win32` environments.

---

## 7. Delivery Plan & Phases

1. **Phase 1**: Assets & Foundation Types (`ProviderKind`, `ProviderID`, logos, asset script).
2. **Phase 2**: Modular Providers Refactoring (Extracting `Claude`, `Codex`, `OpenCode` into `src/main/providers/`).
3. **Phase 3**: Cursor Provider implementation with `node:sqlite` and tests.
4. **Phase 4**: Antigravity Provider implementation with subprocess execution and tests.
5. **Phase 5**: Claude Multi-Account profile discovery and tests.
6. **Phase 6**: WSL shell extension and source selection updates.
7. **Phase 7**: UI presentation updates in Widget, Card, and Settings.
8. **Phase 8**: Full verification (`npm run check` covering lint, typecheck, build, and unit tests).
