import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAntigravityWindows,
  resolveAgyExecutable,
  runAgyUsage,
  AntigravityProvider
} from "../main/providers/antigravity";
import type { ProviderPaths } from "../main/provider-paths";
import type { WslShell } from "../main/wsl";

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
  assert.equal(windows[0].resetDate, "2026-09-09T08:52:43.000Z");

  assert.equal(windows[1].title, "Weekly Gemini");
  assert.equal(windows[1].percent, 48); // 100 - 52
  assert.equal(windows[1].resetDate, "2026-09-11T19:35:01.000Z");

  assert.equal(windows[2].title, "5-hour other models");
  assert.equal(windows[2].percent, 0); // 100 - 100
  assert.equal(windows[2].resetDate, "2026-09-09T08:54:19.000Z");

  assert.equal(windows[3].title, "Weekly other models");
  assert.equal(windows[3].percent, 68); // 100 - 32
  assert.equal(windows[3].resetDate, "2026-09-11T23:26:47.000Z");
});

test("parseAntigravityWindows ignores malformed or header lines", () => {
  const sample = "Quota:\nRandom line\n\n";
  const windows = parseAntigravityWindows(sample);
  assert.equal(windows.length, 0);
});

test("parseAntigravityWindows clamps percentages and handles invalid dates", () => {
  const sample = [
    "Gemini Models\t5-hour\t150%\tnot-a-date",
    "Gemini Models\tweekly\t-20%\t",
    "Claude and GPT models\t5 hour\tnot-a-number\t2026-09-11T23:26:47Z"
  ].join("\n");

  const windows = parseAntigravityWindows(sample);
  assert.equal(windows.length, 2);
  assert.equal(windows[0].title, "5-hour Gemini");
  assert.equal(windows[0].percent, 0); // 100 - 150 = -50 clamped to 0
  assert.equal(windows[0].resetDate, null);

  assert.equal(windows[1].title, "Weekly Gemini");
  assert.equal(windows[1].percent, 100); // 100 - (-20) = 120 clamped to 100
});

test("parseAntigravityWindows handles subset of windows", () => {
  const sample = "Claude and GPT models\tWeekly Limit Remaining\t40%\t2026-09-11T23:26:47Z";
  const windows = parseAntigravityWindows(sample);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].title, "Weekly other models");
  assert.equal(windows[0].percent, 60);
});

test("resolveAgyExecutable resolves configured path if existing", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-test-"));
  const configured = join(dir, "custom-agy");
  writeFileSync(configured, "#!/bin/sh\n");

  try {
    const resolved = resolveAgyExecutable(configured, { PATH: "" });
    assert.equal(resolved, configured);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveAgyExecutable searches PATH when configured path does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-path-test-"));
  const binName = process.platform === "win32" ? "agy.cmd" : "agy";
  const binPath = join(dir, binName);
  writeFileSync(binPath, "#!/bin/sh\n");

  try {
    const resolved = resolveAgyExecutable("/nonexistent/bin/agy", { PATH: `/dummy:${dir}:/other` });
    assert.equal(resolved, binPath);

    const notFound = resolveAgyExecutable("/nonexistent/bin/agy", { PATH: "/dummy:/other" });
    assert.equal(notFound, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runAgyUsage executes binary and parses stdout", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-exec-test-"));
  const mockScript = join(dir, "mock-agy.sh");
  // The mock script checks arguments and prints quota output
  writeFileSync(
    mockScript,
    '#!/bin/sh\nif [ "$1" = "-p" ] && [ "$2" = "/usage" ]; then\n  printf "Gemini Models\\tFive Hour Limit Remaining\\t90%%\\t2026-09-09T08:52:43Z\\n"\nelse\n  exit 1\nfi\n'
  );
  chmodSync(mockScript, 0o755);

  try {
    const output = await runAgyUsage(mockScript, 5000);
    assert.match(output, /Gemini Models/);

    const windows = parseAntigravityWindows(output);
    assert.equal(windows.length, 1);
    assert.equal(windows[0].title, "5-hour Gemini");
    assert.equal(windows[0].percent, 10);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runAgyUsage enforces timeout watchdog", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-timeout-test-"));
  const sleepScript = join(dir, "sleep-agy.sh");
  writeFileSync(sleepScript, "#!/bin/sh\nsleep 2\n");
  chmodSync(sleepScript, 0o755);

  try {
    await assert.rejects(
      () => runAgyUsage(sleepScript, 100),
      /Antigravity CLI timed out/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AntigravityProvider hasHostCredentials and fetchHost behavior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agy-provider-test-"));
  const mockAgy = join(dir, "mock-agy.sh");
  const sample = [
    "Quota:",
    "Gemini Models\tFive Hour Limit Remaining\t80%\t2026-09-09T08:52:43Z",
    "Gemini Models\tWeekly Limit Remaining\t50%\t2026-09-11T19:35:01Z"
  ].join("\n");

  writeFileSync(
    mockAgy,
    `#!/bin/sh\nprintf '%s\\n' '${sample}'\n`
  );
  chmodSync(mockAgy, 0o755);

  const fakePaths: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: "",
    antigravityBin: mockAgy
  };

  try {
    const provider = new AntigravityProvider(fakePaths);
    assert.equal(provider.hasHostCredentials(), true);

    const usage = await provider.fetchHost();
    assert.equal(usage.id, "Antigravity");
    assert.equal(usage.kind, "Antigravity");
    assert.equal(usage.available, true);
    assert.equal(usage.error, null);
    assert.equal(usage.windows.length, 2);
    assert.equal(usage.windows[0].title, "5-hour Gemini");
    assert.equal(usage.windows[0].percent, 20);
    assert.equal(usage.windows[1].title, "Weekly Gemini");
    assert.equal(usage.windows[1].percent, 50);

    // fetchWsl with mock execCommand
    const mockWslShell = {
      readFile: async () => "",
      execCommand: async () => sample
    } as unknown as WslShell;

    const wslUsage = await provider.fetchWsl(mockWslShell, "Ubuntu");
    assert.equal(wslUsage.id, "Antigravity");
    assert.equal(wslUsage.windows.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AntigravityProvider error handling", async () => {
  const fakePaths: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: "",
    antigravityBin: "/nonexistent/bin/agy"
  };

  const provider = new AntigravityProvider(fakePaths);
  // With nonexistent path and empty PATH
  const originalEnvPath = process.env.PATH;
  try {
    process.env.PATH = "";
    assert.equal(provider.hasHostCredentials(), false);
    await assert.rejects(
      () => provider.fetchHost(),
      /Antigravity CLI \(agy\) was not found in PATH/
    );
  } finally {
    process.env.PATH = originalEnvPath;
  }
});
