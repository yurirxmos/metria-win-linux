import test from "node:test";
import assert from "node:assert/strict";
import { decodeWslOutput, makeWslShell, type WslProviderPresence } from "../main/wsl";

test("wsl distros parses wsl.exe --list --quiet output", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: "Ubuntu\r\nDebian\r\n" }) });
  assert.deepEqual(await shell.distros(), ["Ubuntu", "Debian"]);
});

test("wsl distros returns empty outside Windows", async () => {
  const shell = makeWslShell({ platform: "linux", exec: async () => ({ stdout: "Ubuntu\n" }) });
  assert.deepEqual(await shell.distros(), []);
});

test("wsl presence runs the probe script through sh stdin", async () => {
  let input = "";
  const results = new Map<string, { at: number; presence: WslProviderPresence }>();
  const shell = makeWslShell({ platform: "win32", exec: async (_command, _args, options) => { input = options?.input ?? ""; return { stdout: "codex_sessions\n" }; }, results });
  assert.deepEqual(await shell.presence("Ubuntu"), { codex: true, openCode: false, claude: false, antigravity: false });
  assert.match(input, /for f in codex_auth:|opencode:/);
  results.clear();
});

test("wsl distros returns empty when wsl.exe fails", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => { throw new Error("wsl not installed"); } });
  assert.deepEqual(await shell.distros(), []);
});

test("wsl presence maps probe tokens", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: "codex_auth\nclaude\n" }) });
  assert.deepEqual(await shell.presence("Ubuntu"), { codex: true, openCode: false, claude: true, antigravity: false });
});

test("wsl presence treats codex sessions as codex data", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: "codex_sessions\nopencode\n" }) });
  assert.deepEqual(await shell.presence("Ubuntu"), { codex: true, openCode: true, claude: false, antigravity: false });
});

test("wsl presence caches results", async () => {
  const results = new Map();
  let calls = 0;
  const shell = makeWslShell({ platform: "win32", exec: async () => { calls++; return { stdout: "claude\n" }; }, results });
  await shell.presence("Ubuntu");
  await shell.presence("Ubuntu");
  assert.equal(calls, 1);
});

test("wsl readFile pipes the cat script to sh stdin", async () => {
  let input = "";
  const shell = makeWslShell({ platform: "win32", exec: async (_command, args, options) => { input = options?.input ?? ""; assert.deepEqual(args, ["-d", "Ubuntu", "sh"]); return { stdout: "{}" }; } });
  assert.equal(await shell.readFile("Ubuntu", ".codex/auth.json"), "{}");
  assert.match(input, /cat "\$HOME\/\.codex\/auth\.json"/);
});

test("wsl newestJsonl returns the home-relative newest session", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: ".codex/sessions/2025/06/abc.jsonl\n" }) });
  assert.equal(await shell.newestJsonl("Ubuntu", ".codex/sessions"), ".codex/sessions/2025/06/abc.jsonl");
});

test("wsl newestJsonl returns undefined when empty", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: "" }) });
  assert.equal(await shell.newestJsonl("Ubuntu", ".codex/sessions"), undefined);
});

test("decodeWslOutput converts wsl.exe UTF-16LE listing without a BOM", () => {
  const utf16 = Buffer.from("Ubuntu\r\nDebian\r\n", "utf16le");
  assert.equal(decodeWslOutput(utf16), "Ubuntu\r\nDebian\r\n");
  assert.equal(decodeWslOutput(Buffer.from("PRESENT\n", "utf8")), "PRESENT\n");
  assert.equal(decodeWslOutput("plain string"), "plain string");
});

test("wsl distros decodes UTF-16LE output", async () => {
  const shell = makeWslShell({ platform: "win32", exec: async () => ({ stdout: Buffer.from("Ubuntu\r\n", "utf16le") }) });
  assert.deepEqual(await shell.distros(), ["Ubuntu"]);
});

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
