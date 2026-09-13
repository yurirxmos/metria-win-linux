# Missing Providers and Claude Multi-Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Cursor and Antigravity providers, along with multi-account Claude profile discovery, bringing the cross-platform Electron app (`metria-win-linux`) to full feature parity with the macOS native app (`metria`).

**Architecture:** Refactor `src/main/providers.ts` into clean modular provider classes under `src/main/providers/`. Implement Cursor state extraction using Node 22's built-in `node:sqlite`, Antigravity CLI execution with a 30s watchdog and tab-separated parsing, and Claude profile folder scanning (`~/.claude-<slug>`) under an extended `ProviderID` model. Extend WSL probing and execution, update IPC and settings persistence, copy logos, and adapt UI widget gradients.

**Tech Stack:** TypeScript 5.8, Node.js 24 (`node:sqlite`, `node:child_process`, `node:fs`), Electron 37, React 19, Tailwind CSS 4, Vite 6, Node test runner (`node --test`).

**Spec:** [`docs/superpowers/specs/2026-09-09-missing-providers-design.md`](file:///home/diaszano/Documentos/GitHub/metria-win-linux/docs/superpowers/specs/2026-09-09-missing-providers-design.md)

## Global Constraints

- Never introduce third-party SQLite dependencies; use `node:sqlite` (`DatabaseSync` in read-only mode).
- Always close `DatabaseSync` connections immediately after reading to avoid database locks.
- Every subprocess execution of `agy` must have stdin closed (`stdio: ["ignore", "pipe", "ignore"]`) and a strict 30-second watchdog.
- Maintain backward compatibility in `AppSettings` for existing configurations with raw `ProviderKind` strings.
- All existing tests in `src/test/` must continue to pass throughout and after changes.
- Project type checking and build (`npm run check`) must succeed without errors or warnings.

---

### Task 1: Assets & Core Type Definitions

**Files:**
- Create: `resources/assets/cursor-logo.png`
- Create: `resources/assets/antigravity-logo.png`
- Modify: `scripts/copy-renderer-assets.cjs`
- Modify: `src/shared/types.ts`
- Create: `src/test/types.test.ts`

**Interfaces:**
- Produces:
  - `ProviderKind = "Claude" | "Codex" | "OpenCode Go" | "Cursor" | "Antigravity"`
  - `ALL_PROVIDER_KINDS: ProviderKind[]`
  - `isProviderKind(value: unknown): value is ProviderKind`
  - `PROVIDER_LOGOS: Record<ProviderKind, string>`
  - `ProviderID { kind: ProviderKind; slug?: string; id: string; displayName: string }`
  - `parseProviderId(raw: string): ProviderID`
  - `ProviderUsage { id: string; kind: ProviderKind; accountLabel: string | null; windows: UsageWindow[]; updatedAt: string | null; error: string | null; available: boolean; setupHint: string }`

- [ ] **Step 1: Write the failing test for types and ID parsing**

Create `src/test/types.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_PROVIDER_KINDS, isProviderKind, parseProviderId, PROVIDER_LOGOS } from "../shared/types";

test("ALL_PROVIDER_KINDS contains Cursor and Antigravity", () => {
  assert.ok(ALL_PROVIDER_KINDS.includes("Cursor"));
  assert.ok(ALL_PROVIDER_KINDS.includes("Antigravity"));
  assert.equal(ALL_PROVIDER_KINDS.length, 5);
});

test("isProviderKind recognizes Cursor and Antigravity", () => {
  assert.equal(isProviderKind("Cursor"), true);
  assert.equal(isProviderKind("Antigravity"), true);
  assert.equal(isProviderKind("Unknown"), false);
});

test("PROVIDER_LOGOS defines logos for all providers", () => {
  assert.equal(PROVIDER_LOGOS["Cursor"], "cursor-logo.png");
  assert.equal(PROVIDER_LOGOS["Antigravity"], "antigravity-logo.png");
});

test("parseProviderId parses single-account and multi-profile IDs", () => {
  const claude = parseProviderId("Claude");
  assert.deepEqual(claude, { kind: "Claude", id: "Claude", displayName: "Claude", slug: undefined });

  const claudeWork = parseProviderId("Claude-work");
  assert.deepEqual(claudeWork, { kind: "Claude", id: "Claude-work", displayName: "Claude (work)", slug: "work" });

  const cursor = parseProviderId("Cursor");
  assert.deepEqual(cursor, { kind: "Cursor", id: "Cursor", displayName: "Cursor", slug: undefined });

  const agy = parseProviderId("Antigravity");
  assert.deepEqual(agy, { kind: "Antigravity", id: "Antigravity", displayName: "Antigravity", slug: undefined });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/types.test.js`
Expected: Compilation or test failure due to missing `"Cursor"`, `"Antigravity"` and `parseProviderId`.

- [ ] **Step 3: Copy assets and implement types**

Copy logo files:
```bash
cp /home/diaszano/Documentos/GitHub/metria/Assets/cursor-logo.png resources/assets/cursor-logo.png
cp /home/diaszano/Documentos/GitHub/metria/Assets/antigravity-logo.png resources/assets/antigravity-logo.png
```

Update `scripts/copy-renderer-assets.cjs`:
```javascript
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const destination = join(__dirname, "..", "dist", "renderer");
mkdirSync(destination, { recursive: true });

const assets = join(__dirname, "..", "resources", "assets");
for (const name of [
  "claude-logo.png",
  "codex-logo.png",
  "opencode-logo.png",
  "cursor-logo.png",
  "antigravity-logo.png",
  "metria-logo.png",
  "metria-mascot.png"
]) {
  const sourceFile = join(assets, name);
  if (existsSync(sourceFile)) copyFileSync(sourceFile, join(destination, name));
}
```

Update `src/shared/types.ts`:
Update `ProviderKind`, `ALL_PROVIDER_KINDS`, `isProviderKind`, `PROVIDER_LOGOS`, `ProviderUsage`, `ProviderID`, and `parseProviderId`. Ensure `ProviderUsage` has `id: string`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/types.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add resources/assets/ scripts/copy-renderer-assets.cjs src/shared/types.ts src/test/types.test.ts
git commit -m "feat: add Cursor and Antigravity types, logos, and ProviderID model"
```

---

### Task 2: Platform Path Resolution for New Providers

**Files:**
- Modify: `src/main/provider-paths.ts`
- Modify: `src/test/provider-paths.test.ts`

**Interfaces:**
- Consumes: `PathEnvironment` from `src/main/provider-paths.ts`
- Produces: `ProviderPaths { codexAuth: string; codexSessions: string; openCodeAuth: string; claudeCredentials: string; cursorStateDb: string; antigravityBin: string; }`

- [ ] **Step 1: Write the failing test for provider-paths**

Update `src/test/provider-paths.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { providerPaths } from "../main/provider-paths";

test("resolves Linux paths including Cursor DB and Antigravity binary", () => {
  const paths = providerPaths({ platform: "linux", home: "/home/user", env: {} });
  assert.equal(paths.cursorStateDb, "/home/user/.config/Cursor/User/globalStorage/state.vscdb");
  assert.equal(paths.antigravityBin, "/home/user/.local/bin/agy");
});

test("respects XDG_CONFIG_HOME on Linux for Cursor", () => {
  const paths = providerPaths({ platform: "linux", home: "/home/user", env: { XDG_CONFIG_HOME: "/custom/config" } });
  assert.equal(paths.cursorStateDb, "/custom/config/Cursor/User/globalStorage/state.vscdb");
});

test("resolves Windows paths including Cursor DB and Antigravity binary", () => {
  const paths = providerPaths({ platform: "win32", home: "C:\\Users\\User", env: { APPDATA: "C:\\Users\\User\\AppData\\Roaming" } });
  assert.equal(paths.cursorStateDb, "C:\\Users\\User\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb");
  assert.equal(paths.antigravityBin, "C:\\Users\\User\\.local\\bin\\agy.cmd");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/provider-paths.test.js`
Expected: FAIL (`cursorStateDb` or `antigravityBin` undefined).

- [ ] **Step 3: Implement provider-paths resolution**

Update `src/main/provider-paths.ts`:
```ts
import { join } from "node:path";

export interface PathEnvironment { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; }

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/provider-paths.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/provider-paths.ts src/test/provider-paths.test.ts
git commit -m "feat: add Cursor DB and Antigravity binary resolution in providerPaths"
```

---

### Task 3: Cursor Provider Implementation

**Files:**
- Create: `src/main/providers/cursor.ts`
- Create: `src/test/cursor.test.ts`

**Interfaces:**
- Consumes: `ProviderPaths` from `src/main/provider-paths.ts`, `ProviderUsage`, `UsageWindow` from `src/shared/types.ts`
- Produces:
  - `CursorStateStore`
  - `isJwtExpired(token: string): boolean`
  - `parseCursorWindows(responseJson: string): UsageWindow[]`
  - `CursorProvider` class implementing provider methods (`hasHostCredentials`, `fetchHost`, `fetchWsl`)

- [ ] **Step 1: Write the failing tests for CursorStateStore, JWT expiration and window parser**

Create `src/test/cursor.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CursorStateStore, isJwtExpired, parseCursorWindows } from "../main/providers/cursor";

test("CursorStateStore reads token from state.vscdb", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-test-"));
  const dbPath = join(dir, "state.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec("INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', 'sample-jwt-token');");
  db.close();

  const store = new CursorStateStore(dbPath);
  assert.equal(store.readToken(), "sample-jwt-token");

  rmSync(dir, { recursive: true, force: true });
});

test("isJwtExpired correctly identifies expired vs valid tokens", () => {
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");

  assert.equal(isJwtExpired(`header.${expiredPayload}.sig`), true);
  assert.equal(isJwtExpired(`header.${validPayload}.sig`), false);
  assert.equal(isJwtExpired("invalid-token"), true);
});

test("parseCursorWindows parses planUsage and spendLimitUsage", () => {
  const payload = JSON.stringify({
    planUsage: {
      autoPercentUsed: 42,
      apiPercentUsed: 15
    },
    billingCycleEnd: "1725667200000"
  });

  const windows = parseCursorWindows(payload);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].title, "Cursor models");
  assert.equal(windows[0].percent, 42);
  assert.equal(windows[1].title, "API usage");
  assert.equal(windows[1].percent, 15);
  assert.ok(windows[0].resetDate);
});

test("parseCursorWindows falls back to This cycle for pooled usage", () => {
  const payload = JSON.stringify({
    planUsage: {},
    spendLimitUsage: {
      individualUsed: 2500,
      individualLimit: 5000
    },
    billingCycleEnd: "1725667200000"
  });

  const windows = parseCursorWindows(payload);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].title, "This cycle");
  assert.equal(windows[0].percent, 50);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/cursor.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement CursorProvider in `src/main/providers/cursor.ts`**

Create `src/main/providers/cursor.ts`:
```ts
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";

export class CursorStateStore {
  constructor(public readonly databasePath: string) {}

  readToken(): string | null {
    if (!existsSync(this.databasePath)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.databasePath, { readOnly: true, open: true });
      const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1");
      const row = stmt.get("cursorAuth/accessToken") as { value?: string } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    } catch {
      return null;
    } finally {
      if (db) {
        try { db.close(); } catch { /* ignore */ }
      }
    }
  }
}

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

interface CursorApiResponse {
  planUsage?: {
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    totalPercentUsed?: number;
    includedSpend?: number;
    limit?: number;
  };
  spendLimitUsage?: {
    individualUsed?: number;
    individualLimit?: number;
    overallUsed?: number;
    overallLimit?: number;
  };
  billingCycleEnd?: string;
}

export function parseCursorWindows(json: string): UsageWindow[] {
  try {
    const data = JSON.parse(json) as CursorApiResponse;
    const resetDate = data.billingCycleEnd
      ? new Date(Number(data.billingCycleEnd)).toISOString()
      : null;

    const windows: UsageWindow[] = [];
    if (data.planUsage?.autoPercentUsed !== undefined) {
      windows.push({
        title: "Cursor models",
        percent: Math.max(0, Math.min(100, Number(data.planUsage.autoPercentUsed))),
        resetDate
      });
    }
    if (data.planUsage?.apiPercentUsed !== undefined) {
      windows.push({
        title: "API usage",
        percent: Math.max(0, Math.min(100, Number(data.planUsage.apiPercentUsed))),
        resetDate
      });
    }

    if (windows.length > 0) return windows;

    // Fallback to pooled / spend limits
    const spent = (used?: number, limit?: number) => {
      if (used !== undefined && limit !== undefined && limit > 0) {
        return Math.max(0, Math.min(100, (used / limit) * 100));
      }
      return undefined;
    };

    const pooledPercent =
      spent(data.planUsage?.includedSpend, data.planUsage?.limit) ??
      spent(data.spendLimitUsage?.individualUsed, data.spendLimitUsage?.individualLimit) ??
      spent(data.spendLimitUsage?.overallUsed, data.spendLimitUsage?.overallLimit) ??
      data.planUsage?.totalPercentUsed;

    if (pooledPercent !== undefined) {
      return [{
        title: "This cycle",
        percent: Math.max(0, Math.min(100, Number(pooledPercent))),
        resetDate
      }];
    }
    return [];
  } catch {
    return [];
  }
}

export class CursorProvider {
  readonly id = "Cursor";
  readonly kind: ProviderKind = "Cursor";
  readonly hint = "Sign in to Cursor to make usage available.";
  private readonly store: CursorStateStore;

  constructor(private readonly paths: ProviderPaths) {
    this.store = new CursorStateStore(paths.cursorStateDb);
  }

  hasHostCredentials(): boolean {
    return existsSync(this.paths.cursorStateDb) && this.store.readToken() !== null;
  }

  async fetchHost(): Promise<ProviderUsage> {
    const token = this.store.readToken();
    if (!token) throw new Error("Cursor credentials were not found.");
    if (isJwtExpired(token)) throw new Error("Sign in to Cursor again to refresh usage.");

    const res = await fetch("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
        "User-Agent": "Metria-Electron/0.1"
      },
      body: JSON.stringify({ includePooledUsage: true })
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Sign in to Cursor again to refresh usage.");
    }
    if (!res.ok) {
      throw new Error(`The provider returned ${res.status}.`);
    }

    const text = await res.text();
    const windows = parseCursorWindows(text);
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: windows.length === 0 ? "No usage data returned." : null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(_shell: WslShell, _distro: string): Promise<ProviderUsage> {
    return this.fetchHost();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/cursor.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/providers/cursor.ts src/test/cursor.test.ts
git commit -m "feat: implement CursorProvider with node:sqlite and Connect-RPC"
```

---

### Task 4: Antigravity Provider Implementation

**Files:**
- Create: `src/main/providers/antigravity.ts`
- Create: `src/test/antigravity.test.ts`

**Interfaces:**
- Consumes: `ProviderPaths` from `src/main/provider-paths.ts`, `ProviderUsage`, `UsageWindow` from `src/shared/types.ts`
- Produces:
  - `parseAntigravityWindows(output: string): UsageWindow[]`
  - `resolveAgyExecutable(configuredPath: string, env: NodeJS.ProcessEnv): string | null`
  - `runAgyUsage(executable: string, timeoutMs?: number): Promise<string>`
  - `AntigravityProvider` class implementing provider methods

- [ ] **Step 1: Write the failing tests for Antigravity parser and binary resolution**

Create `src/test/antigravity.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseAntigravityWindows, resolveAgyExecutable } from "../main/providers/antigravity";

test("parseAntigravityWindows parses tab-separated CLI output in canonical order", () => {
  const sample = [
    "Quota:",
    "Gemini Models\tWeekly Limit Remaining\t52%\t2026-09-11T19:35:01Z",
    "Gemini Models\tFive Hour Limit Remaining\t98%\t2026-09-09T08:52:43Z",
    "Claude and GPT models\tWeekly Limit Remaining\t32%\t2026-09-11T23:26:47Z",
    "Claude and GPT models\tFive Hour Limit Remaining\t100%\t2026-09-09T08:54:19Z"
  ].join("\n");

  const windows = parseAntigravityWindows(sample);
  assert.equal(windows.length, 4);
  assert.equal(windows[0].title, "5-hour Gemini");
  assert.equal(windows[0].percent, 2); // 100 - 98
  assert.equal(windows[1].title, "Weekly Gemini");
  assert.equal(windows[1].percent, 48); // 100 - 52
  assert.equal(windows[2].title, "5-hour other models");
  assert.equal(windows[2].percent, 0); // 100 - 100
  assert.equal(windows[3].title, "Weekly other models");
  assert.equal(windows[3].percent, 68); // 100 - 32
});

test("parseAntigravityWindows ignores malformed or header lines", () => {
  const sample = "Quota:\nRandom line\n\n";
  const windows = parseAntigravityWindows(sample);
  assert.equal(windows.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/antigravity.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement AntigravityProvider in `src/main/providers/antigravity.ts`**

Create `src/main/providers/antigravity.ts`:
```ts
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";

export function resolveAgyExecutable(configuredPath: string, env: NodeJS.ProcessEnv = process.env): string | null {
  if (existsSync(configuredPath)) return configuredPath;
  const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, process.platform === "win32" ? "agy.cmd" : "agy");
    if (existsSync(candidate)) return candidate;
    if (process.platform === "win32") {
      const exeCandidate = join(dir, "agy.exe");
      if (existsSync(exeCandidate)) return candidate;
    }
  }
  return null;
}

export function runAgyUsage(executable: string, timeoutMs = 30_000): Promise<string> {
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
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
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

type Family = "gemini" | "others";
type Horizon = "fiveHour" | "weekly";

export function parseAntigravityWindows(output: string): UsageWindow[] {
  const slots: { family: Family; horizon: Horizon; window: UsageWindow }[] = [];
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const parts = line.split("\t").map((p) => p.trim());
    if (parts.length < 4) continue;

    const family: Family = parts[0].toLowerCase().includes("gemini") ? "gemini" : "others";
    const windowPart = parts[1].toLowerCase();
    let horizon: Horizon;
    if (windowPart.includes("five hour") || windowPart.includes("5-hour") || windowPart.includes("5 hour")) {
      horizon = "fiveHour";
    } else if (windowPart.includes("week")) {
      horizon = "weekly";
    } else {
      continue;
    }

    const remaining = Number(parts[2].replace("%", "").trim());
    if (Number.isNaN(remaining)) continue;
    const percent = Math.max(0, Math.min(100, 100 - remaining));
    const title = titleFor(family, horizon);
    const resetDate = parts[3] ? new Date(parts[3]).toISOString() : null;

    slots.push({ family, horizon, window: { title, percent, resetDate } });
  }

  const order: [Family, Horizon][] = [
    ["gemini", "fiveHour"],
    ["gemini", "weekly"],
    ["others", "fiveHour"],
    ["others", "weekly"]
  ];

  return order
    .map(([fam, hor]) => slots.find((s) => s.family === fam && s.horizon === hor)?.window)
    .filter((w): w is UsageWindow => Boolean(w));
}

function titleFor(family: Family, horizon: Horizon): string {
  if (family === "gemini") {
    return horizon === "fiveHour" ? "5-hour Gemini" : "Weekly Gemini";
  }
  return horizon === "fiveHour" ? "5-hour other models" : "Weekly other models";
}

export class AntigravityProvider {
  readonly id = "Antigravity";
  readonly kind: ProviderKind = "Antigravity";
  readonly hint = "Install Antigravity and sign in with `agy auth login` to make usage available.";

  constructor(private readonly paths: ProviderPaths) {}

  hasHostCredentials(): boolean {
    return resolveAgyExecutable(this.paths.antigravityBin) !== null;
  }

  async fetchHost(): Promise<ProviderUsage> {
    const executable = resolveAgyExecutable(this.paths.antigravityBin);
    if (!executable) throw new Error("Antigravity CLI (agy) was not found in PATH.");

    const raw = await runAgyUsage(executable);
    const windows = parseAntigravityWindows(raw);
    if (windows.length === 0) throw new Error("No usage data returned from Antigravity.");

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    const output = await shell.readFile(distro, ".local/bin/agy"); // placeholder fallback
    const raw = await (shell as any).execCommand?.(distro, "agy -p /usage </dev/null") ?? output;
    const windows = parseAntigravityWindows(raw);
    if (windows.length === 0) throw new Error("No usage data returned from WSL Antigravity.");
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/antigravity.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/providers/antigravity.ts src/test/antigravity.test.ts
git commit -m "feat: implement AntigravityProvider with agy parser and watchdog"
```

---

### Task 5: Claude Multi-Profile Provider

**Files:**
- Create: `src/main/providers/claude.ts`
- Create: `src/test/claude.test.ts`

**Interfaces:**
- Consumes: `ProviderPaths`, `ProviderID`, `ProviderUsage`, `UsageWindow`
- Produces:
  - `ClaudeProfile` interface & discovery: `discoverClaudeProfiles(homeDir: string): ClaudeProfile[]`
  - `ClaudeProvider` parameterized by `profile: ClaudeProfile`

- [ ] **Step 1: Write the failing tests for ClaudeProfile discovery and credentials parsing**

Create `src/test/claude.test.ts`:
```ts
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverClaudeProfiles, readProfileCredentials } from "../main/providers/claude";

test("discoverClaudeProfiles detects default and valid extra profiles sorted", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-profiles-"));
  // Valid extra profile
  const workDir = join(home, ".claude-work");
  mkdirSync(workDir);
  writeFileSync(join(workDir, "settings.json"), "{}");

  // Invalid empty directory
  const emptyDir = join(home, ".claude-empty");
  mkdirSync(emptyDir);

  const profiles = discoverClaudeProfiles(home);
  assert.equal(profiles.length, 2);
  assert.equal(profiles[0].slug, undefined);
  assert.equal(profiles[0].id, "Claude");
  assert.equal(profiles[1].slug, "work");
  assert.equal(profiles[1].id, "Claude-work");

  rmSync(home, { recursive: true, force: true });
});

test("readProfileCredentials extracts token and email", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-creds-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);
  writeFileSync(join(dir, ".credentials.json"), JSON.stringify({
    claudeAiOauth: {
      accessToken: "oauth-test-token",
      email: "user@example.com"
    }
  }));

  const creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, "oauth-test-token");
  assert.equal(creds.email, "user@example.com");

  rmSync(home, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/claude.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement ClaudeProfile and ClaudeProvider in `src/main/providers/claude.ts`**

Create `src/main/providers/claude.ts`:
```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProviderKind, ProviderUsage } from "../../shared/types";
import type { WslShell } from "../wsl";

export interface ClaudeProfile {
  slug?: string;
  id: string; // "Claude" or "Claude-work"
  displayName: string;
  configDirectory: string;
  accountFile: string;
}

const PROFILE_MARKERS = ["sessions", "projects", "settings.json", "history.jsonl", ".claude.json", ".credentials.json"];

export function discoverClaudeProfiles(home: string): ClaudeProfile[] {
  const defaultProfile: ClaudeProfile = {
    slug: undefined,
    id: "Claude",
    displayName: "Claude",
    configDirectory: join(home, ".claude"),
    accountFile: join(home, ".claude.json")
  };

  const extraProfiles: ClaudeProfile[] = [];
  try {
    const entries = readdirSync(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(".claude-")) continue;
      const slug = entry.name.slice(".claude-".length);
      if (!slug) continue;
      const configDirectory = join(home, entry.name);
      const isReal = PROFILE_MARKERS.some((marker) => existsSync(join(configDirectory, marker)));
      if (!isReal) continue;

      extraProfiles.push({
        slug,
        id: `Claude-${slug}`,
        displayName: `Claude (${slug})`,
        configDirectory,
        accountFile: join(configDirectory, ".claude.json")
      });
    }
  } catch { /* ignore directory read errors */ }

  extraProfiles.sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
  return [defaultProfile, ...extraProfiles];
}

export function readProfileCredentials(configDirectory: string, accountFile: string): { token?: string; email?: string } {
  let token: string | undefined;
  let email: string | undefined;

  const credPath = join(configDirectory, ".credentials.json");
  if (existsSync(credPath)) {
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8")) as {
        email?: string;
        claudeAiOauth?: { accessToken?: string; email?: string };
      };
      token = parsed.claudeAiOauth?.accessToken;
      email = parsed.email ?? parsed.claudeAiOauth?.email;
    } catch { /* ignore */ }
  }

  if (!email && existsSync(accountFile)) {
    try {
      const parsed = JSON.parse(readFileSync(accountFile, "utf8")) as {
        oauthAccount?: { emailAddress?: string };
      };
      email = parsed.oauthAccount?.emailAddress;
    } catch { /* ignore */ }
  }

  return { token, email };
}

export class ClaudeProvider {
  readonly kind: ProviderKind = "Claude";
  readonly id: string;
  readonly hint: string;

  constructor(public readonly profile: ClaudeProfile) {
    this.id = profile.id;
    this.hint = profile.slug
      ? `Run \`CLAUDE_CONFIG_DIR=~/.claude-${profile.slug} claude auth login\` to authenticate.`
      : "Run `claude auth login` in your terminal to create local Claude Code credentials, then refresh Metria.";
  }

  hasHostCredentials(): boolean {
    const { token } = readProfileCredentials(this.profile.configDirectory, this.profile.accountFile);
    return Boolean(token);
  }

  async fetchHost(): Promise<ProviderUsage> {
    const { token, email } = readProfileCredentials(this.profile.configDirectory, this.profile.accountFile);
    if (!token) throw new Error(`Claude credentials were not found. ${this.hint}`);

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "Metria-Electron/0.1"
      }
    });

    if (res.status === 401) {
      throw new Error("Claude Code credentials have expired. Run `claude auth login`.");
    }
    if (!res.ok) {
      throw new Error(`The provider returned ${res.status}.`);
    }

    const data = (await res.json()) as {
      five_hour?: { utilization?: number; resets_at?: string };
      seven_day?: { utilization?: number; resets_at?: string };
    };

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: email ?? null,
      windows: [
        { title: "Current session", percent: Number(data.five_hour?.utilization ?? 0), resetDate: data.five_hour?.resets_at ?? null },
        { title: "All models", percent: Number(data.seven_day?.utilization ?? 0), resetDate: data.seven_day?.resets_at ?? null }
      ],
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    const relPath = this.profile.slug ? `.claude-${this.profile.slug}/.credentials.json` : ".claude/.credentials.json";
    const credentials = await shell.readFile(distro, relPath);
    let token: string | undefined;
    let email: string | undefined;
    try {
      const parsed = JSON.parse(credentials) as { email?: string; claudeAiOauth?: { accessToken?: string; email?: string } };
      token = parsed.claudeAiOauth?.accessToken;
      email = parsed.email ?? parsed.claudeAiOauth?.email;
    } catch { /* ignore */ }

    if (!token) throw new Error("Claude Code credentials were not found in WSL.");

    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "User-Agent": "Metria-Electron/0.1" }
    });
    if (!res.ok) throw new Error(`The provider returned ${res.status}.`);
    const data = (await res.json()) as { five_hour?: { utilization?: number; resets_at?: string }; seven_day?: { utilization?: number; resets_at?: string } };

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: email ?? null,
      windows: [
        { title: "Current session", percent: Number(data.five_hour?.utilization ?? 0), resetDate: data.five_hour?.resets_at ?? null },
        { title: "All models", percent: Number(data.seven_day?.utilization ?? 0), resetDate: data.seven_day?.resets_at ?? null }
      ],
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/claude.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/providers/claude.ts src/test/claude.test.ts
git commit -m "feat: implement ClaudeProfile discovery and ClaudeProvider"
```

---

### Task 6: WSL Shell Extensions for Antigravity

**Files:**
- Modify: `src/main/wsl.ts`
- Modify: `src/test/wsl.test.ts`

**Interfaces:**
- Consumes: `WslProviderPresence`, `WslShell`
- Produces:
  - Extended `WslProviderPresence`: `{ codex: boolean; openCode: boolean; claude: boolean; antigravity: boolean }`
  - `WslShell.execCommand(distro: string, cmd: string, timeoutMs?: number): Promise<string>`

- [ ] **Step 1: Write the failing test for WSL Antigravity presence and command execution**

Update `src/test/wsl.test.ts`:
```ts
test("presence detects antigravity probe hit", async () => {
  const shell = makeWslShell({
    platform: "win32",
    exec: async () => ({ stdout: Buffer.from("codex_auth\nantigravity\n", "utf8") })
  });
  const res = await shell.presence("Ubuntu");
  assert.equal(res.codex, true);
  assert.equal(res.antigravity, true);
  assert.equal(res.claude, false);
});

test("execCommand executes command in distro and returns output", async () => {
  const shell = makeWslShell({
    platform: "win32",
    exec: async (_cmd, args) => {
      assert.ok(args.includes("Ubuntu"));
      return { stdout: Buffer.from("agy output text", "utf8") };
    }
  });
  const out = await shell.execCommand("Ubuntu", "agy -p /usage </dev/null");
  assert.equal(out, "agy output text");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/wsl.test.js`
Expected: FAIL (`antigravity` property or `execCommand` not defined).

- [ ] **Step 3: Update `src/main/wsl.ts`**

Update `WslProviderPresence`, `PROBE_SCRIPT`, and add `execCommand` to `WslShell` and `makeWslShell`:
```ts
export interface WslProviderPresence {
  codex: boolean;
  openCode: boolean;
  claude: boolean;
  antigravity: boolean;
}

export interface WslShell {
  distros(): Promise<string[]>;
  presence(distro: string): Promise<WslProviderPresence>;
  readFile(distro: string, homeRelativePath: string): Promise<string>;
  newestJsonl(distro: string, homeRelativeDir: string): Promise<string | undefined>;
  execCommand(distro: string, cmd: string, timeoutMs?: number): Promise<string>;
}
```
Include `antigravity:"$HOME/.local/bin/agy"` in `PROBE_SCRIPT` and implement `execCommand` via `exec("wsl.exe", ["-d", distro, "sh", "-c", cmd])`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/wsl.test.js`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/main/wsl.ts src/test/wsl.test.ts
git commit -m "feat: add Antigravity probe and execCommand to WSL shell"
```

---

### Task 7: Modular Provider Registry & ProviderService Integration

**Files:**
- Create: `src/main/providers/codex.ts`
- Create: `src/main/providers/opencode.ts`
- Create: `src/main/providers/types.ts`
- Create: `src/main/providers/registry.ts`
- Modify: `src/main/providers.ts`
- Modify: `src/main/settings.ts`
- Modify: `src/test/providers.test.ts`

**Interfaces:**
- Consumes: Provider classes (`ClaudeProvider`, `CodexProvider`, `OpenCodeGoProvider`, `CursorProvider`, `AntigravityProvider`)
- Produces: `ProviderService` with support for all 5 provider kinds + Claude profiles.

- [ ] **Step 1: Extract Codex and OpenCode into dedicated files**

Create `src/main/providers/types.ts`:
```ts
import type { ProviderKind, ProviderUsage } from "../../shared/types";
import type { WslShell } from "../wsl";

export interface Provider {
  readonly id: string;
  readonly kind: ProviderKind;
  readonly hint: string;
  hasHostCredentials(): boolean;
  fetchHost(): Promise<ProviderUsage>;
  fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage>;
}
```

Create `src/main/providers/codex.ts` and `src/main/providers/opencode.ts` moving respective logic from `providers.ts`.

- [ ] **Step 2: Implement ProviderRegistry and update ProviderService**

Create `src/main/providers/registry.ts`:
Instantiates `ClaudeProfile.discover()`, `CodexProvider`, `OpenCodeGoProvider`, `CursorProvider`, and `AntigravityProvider`.

Update `src/main/providers.ts`:
- Replace old inner classes with imported provider modules.
- Update `POPULATION_BY_KIND` to include `Cursor` (host-only) and `Antigravity`.
- Update `ProviderService.fetch()` and `sources()` to operate on `ProviderID` and match provider `id`.

Update `src/main/settings.ts`:
- Adjust `enabledProviders`, `providerSource`, and `hiddenUsageWindowTitles` normalizers to accept valid string IDs (supporting both `"Claude"` and `"Claude-work"`).

- [ ] **Step 3: Update and run provider tests**

Update `src/test/providers.test.ts` to verify fetching from all providers (including mock Cursor and Antigravity).
Run: `npm run build && node --test dist/test/providers.test.js`
Expected: PASS

- [ ] **Step 4: Commit changes**

```bash
git add src/main/providers/ src/main/providers.ts src/main/settings.ts src/test/providers.test.ts
git commit -m "refactor: modularize providers and integrate Cursor and Antigravity into ProviderService"
```

---

### Task 8: IPC, Reconnect and Diagnostics

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `ProviderKind`, `parseProviderId`, `ProviderService`
- Produces: IPC handlers for `metria:reconnect` and `metria:diagnose` supporting all provider kinds and profiles.

- [ ] **Step 1: Update IPC handlers in `src/main/index.ts`**

Update `metria:reconnect`:
```ts
ipcMain.handle("metria:reconnect", async (event, rawId: unknown) => {
  requireTrustedSender(event);
  const parsed = parseProviderId(String(rawId));
  let command = "";
  let message = "";

  if (parsed.kind === "Claude") {
    command = parsed.slug ? `CLAUDE_CONFIG_DIR=~/.claude-${parsed.slug} claude auth login` : "claude auth login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Codex") {
    command = "codex login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "OpenCode Go") {
    command = "opencode auth login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Antigravity") {
    command = "agy auth login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Cursor") {
    command = "cursor";
    message = "Open Cursor and make sure you are signed in, then refresh Metria.";
  }

  await shell.openPath(app.getPath("home"));
  return { command, message };
});
```

Update `metria:diagnose`:
Provide specific diagnostic messages for Cursor (checking `state.vscdb` presence) and Antigravity (checking `agy` resolution and version/help).

- [ ] **Step 2: Typecheck and build to verify main process**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit changes**

```bash
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: add Cursor and Antigravity reconnect commands and diagnostics"
```

---

### Task 9: Renderer Presentation (Widget, Settings, Card)

**Files:**
- Modify: `src/renderer/widget.tsx`
- Modify: `src/renderer/index.tsx`
- Modify: `src/renderer/card.tsx`

**Interfaces:**
- Consumes: `ProviderKind`, `PROVIDER_LOGOS`, `parseProviderId`, SVG gradients
- Produces: High-quality visual indicators and settings controls for Cursor and Antigravity.

- [ ] **Step 1: Update `src/renderer/widget.tsx`**

- Add accent colors for Cursor (`#8e8e93`) and Antigravity (`#3b82f6`).
- In `Ring` component, add SVG linear gradient for Cursor:
  ```tsx
  {provider.kind === "Cursor" && (
    <defs>
      <linearGradient id="cursor-ring" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#8e8e93" />
        <stop offset="1" stopColor="#ffffff" />
      </linearGradient>
    </defs>
  )}
  ```
- Set `stroke = ... provider.kind === "Cursor" ? "url(#cursor-ring)" : ...`.

- [ ] **Step 2: Update `src/renderer/index.tsx`**

- Update `WINDOW_TITLES`:
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
- Support profile display names (`parseProviderId(provider.id).displayName`).

- [ ] **Step 3: Update `src/renderer/card.tsx`**

- Verify display of provider logos, account labels, and usage window formatting.

- [ ] **Step 4: Typecheck and build renderer**

Run: `npm run build`
Expected: Build succeeds, Vite bundles renderer assets without errors.

- [ ] **Step 5: Commit changes**

```bash
git add src/renderer/
git commit -m "feat: update Widget, Settings, and Card for Cursor, Antigravity, and Claude profiles"
```

---

### Task 10: Complete Verification and End-to-End Checks

**Files:**
- All files across `src/` and `scripts/`

- [ ] **Step 1: Run comprehensive check**

Run: `npm run check`
Expected:
- `tsc -p tsconfig.json --noEmit` PASS
- `tsc -p tsconfig.renderer.json --noEmit` PASS
- `vite build` PASS
- `node scripts/copy-renderer-assets.cjs` PASS (all 7 logos present in `dist/renderer/`)
- `node --test dist/test/*.test.js` PASS (all unit tests passing)

- [ ] **Step 2: Verify Antigravity live integration on host**

Run: `node -e 'const { AntigravityProvider } = require("./dist/main/providers/antigravity"); console.log(new AntigravityProvider({ antigravityBin: "/home/diaszano/.local/bin/agy" }).hasHostCredentials());'`
Expected: `true`

- [ ] **Step 3: Commit final verification**

```bash
git commit --allow-empty -m "chore: verify build and tests pass for missing providers"
```
