import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  buildReconnectCommand,
  checkAgyVersionOrHelp,
  diagnoseProvider
} from "../main/diagnostics";
import type { ProviderPaths } from "../main/provider-paths";
import type { ProviderSourceInfo, ProviderUsage } from "../shared/types";

function mockPaths(dir: string): ProviderPaths {
  return {
    codexAuth: join(dir, "codex-auth.json"),
    codexSessions: join(dir, "codex-sessions"),
    openCodeAuth: join(dir, "opencode-auth.json"),
    claudeCredentials: join(dir, "claude-creds.json"),
    cursorStateDb: join(dir, "state.vscdb"),
    antigravityBin: join(dir, "agy")
  };
}

function makeJwt(expSecondsFromNow: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow })
  ).toString("base64url");
  return `${header}.${payload}.mock-signature`;
}

test("buildReconnectCommand returns correct command and message for all providers", () => {
  // Claude default
  const claude = buildReconnectCommand("Claude");
  assert.equal(claude.command, "claude auth login");
  assert.equal(claude.message, "Run `claude auth login` in your terminal, then refresh Metria.");

  // Claude profile
  const claudeWork = buildReconnectCommand("Claude-work");
  assert.equal(claudeWork.command, "CLAUDE_CONFIG_DIR=~/.claude-work claude auth login");
  assert.equal(
    claudeWork.message,
    "Run `CLAUDE_CONFIG_DIR=~/.claude-work claude auth login` in your terminal, then refresh Metria."
  );

  // Claude profile on Windows
  const claudeWorkWin = buildReconnectCommand("Claude-work", "win32");
  assert.equal(claudeWorkWin.command, '$env:CLAUDE_CONFIG_DIR="$HOME\\.claude-work"; claude auth login');
  assert.equal(
    claudeWorkWin.message,
    'Run `$env:CLAUDE_CONFIG_DIR="$HOME\\.claude-work"; claude auth login` in your terminal, then refresh Metria.'
  );

  // Codex
  const codex = buildReconnectCommand("Codex");
  assert.equal(codex.command, "codex login");
  assert.equal(codex.message, "Run `codex login` in your terminal, then refresh Metria.");

  // OpenCode Go
  const opencode = buildReconnectCommand("OpenCode Go");
  assert.equal(opencode.command, "opencode auth login");
  assert.equal(opencode.message, "Run `opencode auth login` in your terminal, then refresh Metria.");

  // Antigravity
  const antigravity = buildReconnectCommand("Antigravity");
  assert.equal(antigravity.command, "agy auth login");
  assert.equal(antigravity.message, "Run `agy auth login` in your terminal, then refresh Metria.");

  // Cursor
  const cursor = buildReconnectCommand("Cursor");
  assert.equal(cursor.command, "cursor");
  assert.equal(
    cursor.message,
    "Open Cursor and make sure you are signed in, then refresh Metria."
  );
});

test("diagnoseProvider reports Cursor diagnostic details when state.vscdb is present and valid", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-cursor-"));
  const paths = mockPaths(dir);

  const db = new DatabaseSync(paths.cursorStateDb);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${makeJwt(3600)}');`);
  db.close();

  const sourceInfo: ProviderSourceInfo = {
    id: "Cursor",
    kind: "Cursor",
    host: true,
    wsl: [],
    source: { location: "host" },
    needsChoice: false
  };

  const usage: ProviderUsage = {
    id: "Cursor",
    kind: "Cursor",
    accountLabel: null,
    windows: [{ title: "Cursor models", percent: 25, resetDate: null }],
    updatedAt: "2026-09-09T00:00:00.000Z",
    error: null,
    available: true,
    setupHint: ""
  };

  const output = diagnoseProvider({ providerId: "Cursor", sourceInfo, usage, paths });
  assert.match(output, /Host credentials detected\./);
  assert.match(output, /1 usage window\(s\) returned\./);
  assert.match(output, /Cursor state database found:/);
  assert.match(output, /Cursor token detected in state\.vscdb\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports expired token in state.vscdb", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-cursor-exp-"));
  const paths = mockPaths(dir);

  const db = new DatabaseSync(paths.cursorStateDb);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${makeJwt(-3600)}');`);
  db.close();

  const output = diagnoseProvider({
    providerId: "Cursor",
    sourceInfo: { id: "Cursor", kind: "Cursor", host: true, wsl: [], source: null, needsChoice: false },
    paths
  });
  assert.match(output, /Cursor state database found:/);
  assert.match(output, /Cursor token in state\.vscdb is expired\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports missing token in state.vscdb", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-cursor-notok-"));
  const paths = mockPaths(dir);

  const db = new DatabaseSync(paths.cursorStateDb);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.close();

  const output = diagnoseProvider({
    providerId: "Cursor",
    sourceInfo: { id: "Cursor", kind: "Cursor", host: false, wsl: [], source: null, needsChoice: false },
    paths
  });
  assert.match(output, /Cursor state database found:/);
  assert.match(output, /No Cursor token found in state\.vscdb\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports missing state.vscdb for Cursor", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-cursor-none-"));
  const paths = mockPaths(dir);

  const output = diagnoseProvider({
    providerId: "Cursor",
    paths
  });
  assert.match(output, /Cursor state database not found:/);
  assert.match(output, /No host credentials detected\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports Antigravity diagnostic details when agy is resolved with version", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-agy-"));
  const paths = mockPaths(dir);
  writeFileSync(paths.antigravityBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const output = diagnoseProvider({
    providerId: "Antigravity",
    sourceInfo: { id: "Antigravity", kind: "Antigravity", host: true, wsl: [], source: null, needsChoice: false },
    paths,
    checkVersion: () => ({ version: "1.1.28" })
  });

  assert.match(output, /Antigravity CLI \(agy\) resolved:/);
  assert.match(output, /Antigravity CLI version: 1\.1\.28/);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports Antigravity help accessible fallback", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-agy-help-"));
  const paths = mockPaths(dir);
  writeFileSync(paths.antigravityBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const output = diagnoseProvider({
    providerId: "Antigravity",
    paths,
    checkVersion: () => ({ help: true })
  });

  assert.match(output, /Antigravity CLI \(agy\) resolved:/);
  assert.match(output, /Antigravity CLI help accessible\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports Antigravity version check failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-agy-err-"));
  const paths = mockPaths(dir);
  writeFileSync(paths.antigravityBin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

  const output = diagnoseProvider({
    providerId: "Antigravity",
    paths,
    checkVersion: () => ({ error: "command failed" })
  });

  assert.match(output, /Antigravity CLI check: command failed/);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports missing agy binary for Antigravity", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-agy-missing-"));
  const paths = mockPaths(dir);

  const output = diagnoseProvider({
    providerId: "Antigravity",
    paths: { ...paths, antigravityBin: join(dir, "nonexistent-agy") },
    env: { PATH: "" }
  });

  assert.match(output, /Antigravity CLI \(agy\) was not found in PATH or standard install locations\./);

  rmSync(dir, { recursive: true, force: true });
});

test("diagnoseProvider reports Claude profile and WSL data", () => {
  const dir = mkdtempSync(join(tmpdir(), "diag-claude-"));
  const paths = mockPaths(dir);

  const sourceInfo: ProviderSourceInfo = {
    id: "Claude-work",
    kind: "Claude",
    host: false,
    wsl: [{ distro: "Ubuntu", present: true }, { distro: "Debian", present: false }],
    source: { location: "wsl", distro: "Ubuntu" },
    needsChoice: false
  };

  const usage: ProviderUsage = {
    id: "Claude-work",
    kind: "Claude",
    accountLabel: "work@example.com",
    windows: [{ title: "Current session", percent: 45, resetDate: null }],
    updatedAt: "2026-09-09T01:00:00.000Z",
    error: null,
    available: true,
    setupHint: ""
  };

  const output = diagnoseProvider({
    providerId: "Claude-work",
    sourceInfo,
    usage,
    paths
  });

  assert.match(output, /No host credentials detected\./);
  assert.match(output, /WSL Ubuntu data detected\./);
  assert.match(output, /1 usage window\(s\) returned\./);
  assert.match(output, /Claude profile: work/);

  rmSync(dir, { recursive: true, force: true });
});

test("checkAgyVersionOrHelp invokes spawn and handles success and fallbacks", () => {
  // Success with version
  const resVer = checkAgyVersionOrHelp("dummy", ((_file: string, args: string[]) => {
    if (args.includes("--version")) return { status: 0, stdout: "1.2.3\n" };
    return { status: 1, stdout: "" };
  }) as any);
  assert.equal(resVer.version, "1.2.3");

  // Fallback to help
  const resHelp = checkAgyVersionOrHelp("dummy", ((_file: string, args: string[]) => {
    if (args.includes("--version")) return { status: 1, stdout: "" };
    if (args.includes("--help")) return { status: 0, stdout: "Usage of agy:\n" };
    return { status: 1, stdout: "" };
  }) as any);
  assert.equal(resHelp.help, true);

  // Both fail
  const resFail = checkAgyVersionOrHelp("dummy", (() => ({ status: 127, stdout: "" })) as any);
  assert.match(resFail.error ?? "", /Exited with code 127/);

  // Throws exception
  const resThrow = checkAgyVersionOrHelp("dummy", (() => {
    throw new Error("spawn ENOENT");
  }) as any);
  assert.match(resThrow.error ?? "", /spawn ENOENT/);

  // Returns error object on spawn failure
  const resSpawnError = checkAgyVersionOrHelp("dummy", (() => ({
    error: new Error("spawn EINVAL")
  })) as any);
  assert.equal(resSpawnError.error, "spawn EINVAL");
});

test("cache lookup helper prefers exact id and avoids profile collision", () => {
  const lastUsage: ProviderUsage[] = [
    {
      id: "Claude",
      kind: "Claude",
      accountLabel: "default@example.com",
      windows: [{ title: "Current session", percent: 50, resetDate: null }],
      updatedAt: "2026-09-09T00:00:00.000Z",
      error: null,
      available: true,
      setupHint: ""
    }
  ];

  const profileFailure: ProviderUsage = {
    id: "Claude-work",
    kind: "Claude",
    accountLabel: null,
    windows: [],
    updatedAt: "2026-09-09T01:00:00.000Z",
    error: "Token expired",
    available: false,
    setupHint: ""
  };

  const lookup = (value: ProviderUsage) =>
    lastUsage.find((entry) => entry.id === value.id) ??
    (value.id === value.kind ? lastUsage.find((entry) => entry.kind === value.kind) : undefined);

  // Claude-work must NOT fall back to Claude's cache
  assert.equal(lookup(profileFailure), undefined);

  // Claude default matches exact id
  const claudeFailure: ProviderUsage = { ...profileFailure, id: "Claude" };
  assert.equal(lookup(claudeFailure)?.accountLabel, "default@example.com");
});
