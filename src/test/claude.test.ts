import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverClaudeProfiles,
  readProfileCredentials,
  ClaudeProvider,
  type ClaudeProfile
} from "../main/providers/claude";
import type { WslShell } from "../main/wsl";

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
  assert.equal(profiles[0].displayName, "Claude");
  assert.equal(profiles[0].configDirectory, join(home, ".claude"));
  assert.equal(profiles[0].accountFile, join(home, ".claude.json"));

  assert.equal(profiles[1].slug, "work");
  assert.equal(profiles[1].id, "Claude-work");
  assert.equal(profiles[1].displayName, "Claude (work)");
  assert.equal(profiles[1].configDirectory, workDir);
  assert.equal(profiles[1].accountFile, join(workDir, ".claude.json"));

  rmSync(home, { recursive: true, force: true });
});

test("discoverClaudeProfiles recognizes all profile markers and sorts multiple extra profiles alphabetically", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-profiles-markers-"));

  // Create extra profiles with different markers
  const markers = [
    { slug: "zeta", marker: "projects" },
    { slug: "beta", marker: "sessions" },
    { slug: "alpha", marker: "history.jsonl" },
    { slug: "delta", marker: ".claude.json" },
    { slug: "gamma", marker: ".credentials.json" }
  ];

  for (const { slug, marker } of markers) {
    const dir = join(home, `.claude-${slug}`);
    mkdirSync(dir);
    writeFileSync(join(dir, marker), "test");
  }

  // Also an empty dir and a non-directory file
  mkdirSync(join(home, ".claude-ignored-empty"));
  writeFileSync(join(home, ".claude-not-a-dir"), "not a dir");
  mkdirSync(join(home, ".claude-")); // empty slug

  const profiles = discoverClaudeProfiles(home);
  assert.equal(profiles.length, 6); // default + 5 valid extra
  assert.equal(profiles[0].id, "Claude");
  assert.equal(profiles[1].id, "Claude-alpha");
  assert.equal(profiles[2].id, "Claude-beta");
  assert.equal(profiles[3].id, "Claude-delta");
  assert.equal(profiles[4].id, "Claude-gamma");
  assert.equal(profiles[5].id, "Claude-zeta");

  rmSync(home, { recursive: true, force: true });
});

test("discoverClaudeProfiles handles nonexistent directory gracefully", () => {
  const profiles = discoverClaudeProfiles("/nonexistent/directory/path/that/does/not/exist");
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, "Claude");
  assert.equal(profiles[0].slug, undefined);
});

test("readProfileCredentials extracts token and email", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-creds-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "oauth-test-token",
        email: "user@example.com"
      }
    })
  );

  const creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, "oauth-test-token");
  assert.equal(creds.email, "user@example.com");

  rmSync(home, { recursive: true, force: true });
});

test("readProfileCredentials falls back to .claude.json oauthAccount email and handles top-level email", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-creds-fallback-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);

  // Test top-level email in .credentials.json
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({
      email: "top-level@example.com",
      claudeAiOauth: {
        accessToken: "token-123"
      }
    })
  );
  let creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, "token-123");
  assert.equal(creds.email, "top-level@example.com");

  // Test fallback to accountFile when .credentials.json has no email
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "token-456"
      }
    })
  );
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      oauthAccount: {
        emailAddress: "account-file@example.com"
      }
    })
  );
  creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, "token-456");
  assert.equal(creds.email, "account-file@example.com");

  rmSync(home, { recursive: true, force: true });
});

test("readProfileCredentials returns undefined fields when files are missing or malformed", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-creds-empty-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);

  // Missing files
  let creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, undefined);
  assert.equal(creds.email, undefined);

  // Malformed files
  writeFileSync(join(dir, ".credentials.json"), "invalid json");
  writeFileSync(join(home, ".claude.json"), "invalid json");
  creds = readProfileCredentials(dir, join(home, ".claude.json"));
  assert.equal(creds.token, undefined);
  assert.equal(creds.email, undefined);

  rmSync(home, { recursive: true, force: true });
});

test("ClaudeProvider hasHostCredentials and hint generation", () => {
  const home = mkdtempSync(join(tmpdir(), "claude-provider-test-"));
  const defaultDir = join(home, ".claude");
  mkdirSync(defaultDir);

  const defaultProfile: ClaudeProfile = {
    id: "Claude",
    displayName: "Claude",
    configDirectory: defaultDir,
    accountFile: join(home, ".claude.json")
  };

  const workDir = join(home, ".claude-work");
  mkdirSync(workDir);
  const workProfile: ClaudeProfile = {
    slug: "work",
    id: "Claude-work",
    displayName: "Claude (work)",
    configDirectory: workDir,
    accountFile: join(workDir, ".claude.json")
  };

  const defaultProvider = new ClaudeProvider(defaultProfile);
  assert.equal(defaultProvider.id, "Claude");
  assert.equal(defaultProvider.kind, "Claude");
  assert.ok(defaultProvider.hint.includes("Run `claude auth login`"));
  assert.equal(defaultProvider.hasHostCredentials(), false);

  const workProvider = new ClaudeProvider(workProfile);
  assert.equal(workProvider.id, "Claude-work");
  assert.equal(workProvider.kind, "Claude");
  assert.ok(workProvider.hint.includes("CLAUDE_CONFIG_DIR=~/.claude-work claude auth login"));
  assert.equal(workProvider.hasHostCredentials(), false);

  // Add credentials to workDir
  writeFileSync(
    join(workDir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "work-token" } })
  );
  assert.equal(workProvider.hasHostCredentials(), true);

  rmSync(home, { recursive: true, force: true });
});

test("ClaudeProvider fetchHost fetches usage and parses windows", async () => {
  const home = mkdtempSync(join(tmpdir(), "claude-fetch-test-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-token",
        email: "test@example.com"
      }
    })
  );

  const profile: ClaudeProfile = {
    id: "Claude",
    displayName: "Claude",
    configDirectory: dir,
    accountFile: join(home, ".claude.json")
  };

  const provider = new ClaudeProvider(profile);
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input.toString(), "https://api.anthropic.com/api/oauth/usage");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Authorization"], "Bearer test-token");
      assert.equal(headers["anthropic-beta"], "oauth-2025-04-20");
      assert.equal(headers["User-Agent"], "Metria-Electron/0.1");

      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 25.5, resets_at: "2026-09-09T05:00:00.000Z" },
          seven_day: { utilization: 60.0, resets_at: "2026-09-16T00:00:00.000Z" }
        })
      } as Response;
    }) as typeof fetch;

    const usage = await provider.fetchHost();
    assert.equal(usage.id, "Claude");
    assert.equal(usage.kind, "Claude");
    assert.equal(usage.accountLabel, "test@example.com");
    assert.equal(usage.available, true);
    assert.equal(usage.error, null);
    assert.equal(usage.windows.length, 2);
    assert.equal(usage.windows[0].title, "Current session");
    assert.equal(usage.windows[0].percent, 25.5);
    assert.equal(usage.windows[0].resetDate, "2026-09-09T05:00:00.000Z");
    assert.equal(usage.windows[1].title, "All models");
    assert.equal(usage.windows[1].percent, 60.0);
    assert.equal(usage.windows[1].resetDate, "2026-09-16T00:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(home, { recursive: true, force: true });
  }
});

test("ClaudeProvider fetchHost handles missing token, 401 expired, and non-ok status", async () => {
  const home = mkdtempSync(join(tmpdir(), "claude-fetch-errors-"));
  const dir = join(home, ".claude");
  mkdirSync(dir);

  const profile: ClaudeProfile = {
    id: "Claude",
    displayName: "Claude",
    configDirectory: dir,
    accountFile: join(home, ".claude.json")
  };

  const provider = new ClaudeProvider(profile);

  // Missing credentials
  await assert.rejects(
    async () => provider.fetchHost(),
    (err: Error) => {
      assert.ok(err.message.includes("Claude credentials were not found"));
      return true;
    }
  );

  // Add credentials
  writeFileSync(
    join(dir, ".credentials.json"),
    JSON.stringify({ claudeAiOauth: { accessToken: "expired-token" } })
  );

  const originalFetch = globalThis.fetch;
  try {
    // 401 expired
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => provider.fetchHost(),
      { message: "Claude Code credentials have expired. Run `claude auth login`." }
    );

    // 500 error
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => provider.fetchHost(),
      { message: "The provider returned 500." }
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(home, { recursive: true, force: true });
  }
});

test("ClaudeProvider fetchWsl fetches usage and handles WSL relative paths", async () => {
  const profile: ClaudeProfile = {
    slug: "work",
    id: "Claude-work",
    displayName: "Claude (work)",
    configDirectory: "/home/user/.claude-work",
    accountFile: "/home/user/.claude-work/.claude.json"
  };

  const provider = new ClaudeProvider(profile);
  const mockShell: WslShell = {
    distros: async () => ["Ubuntu"],
    presence: async () => ({ codex: false, openCode: false, claude: true }),
    readFile: async (distro: string, relPath: string) => {
      assert.equal(distro, "Ubuntu");
      assert.equal(relPath, ".claude-work/.credentials.json");
      return JSON.stringify({
        claudeAiOauth: {
          accessToken: "wsl-work-token",
          email: "wsl-work@example.com"
        }
      });
    },
    newestJsonl: async () => undefined
  };

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input.toString(), "https://api.anthropic.com/api/oauth/usage");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Authorization"], "Bearer wsl-work-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 10.0, resets_at: null },
          seven_day: { utilization: 40.0, resets_at: null }
        })
      } as Response;
    }) as typeof fetch;

    const usage = await provider.fetchWsl(mockShell, "Ubuntu");
    assert.equal(usage.id, "Claude-work");
    assert.equal(usage.accountLabel, "wsl-work@example.com");
    assert.equal(usage.windows[0].percent, 10.0);
    assert.equal(usage.windows[1].percent, 40.0);
  } finally {
    globalThis.fetch = originalFetch;
  }

  // Error case: missing token in WSL
  const emptyShell: WslShell = {
    ...mockShell,
    readFile: async () => "{}"
  };
  await assert.rejects(
    async () => provider.fetchWsl(emptyShell, "Ubuntu"),
    { message: "Claude Code credentials were not found in WSL." }
  );
});
