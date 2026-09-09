import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { providerPaths } from "../main/provider-paths";

test("provider credential roots honor Windows, Linux XDG, and explicit Codex home", () => {
  const win = { platform: "win32", home: "C:\\Users\\Ada", env: { APPDATA: "C:\\Users\\Ada\\AppData\\Roaming" } } as const;
  const linux = { platform: "linux", home: "/home/ada", env: {} } as const;
  assert.equal(providerPaths(win).openCodeAuth, join("C:\\Users\\Ada\\AppData\\Roaming", "opencode", "auth.json"));
  assert.equal(providerPaths(linux).openCodeAuth, join("/home/ada", ".local", "share", "opencode", "auth.json"));
  assert.equal(providerPaths({ ...linux, env: { XDG_DATA_HOME: "/data" } }).openCodeAuth, join("/data", "opencode", "auth.json"));
  assert.equal(providerPaths({ ...linux, env: { CODEX_HOME: "/portable/codex" } }).codexSessions, join("/portable/codex", "sessions"));
  assert.equal(providerPaths(win).claudeCredentials, join("C:\\Users\\Ada", ".claude", ".credentials.json"));
  assert.equal(providerPaths(linux).claudeCredentials, join("/home/ada", ".claude", ".credentials.json"));
});

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
  assert.equal(paths.cursorStateDb, join("C:\\Users\\User\\AppData\\Roaming", "Cursor", "User", "globalStorage", "state.vscdb"));
  assert.equal(paths.antigravityBin, join("C:\\Users\\User", ".local", "bin", "agy.cmd"));
});

