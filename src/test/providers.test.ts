import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chooseSource,
  parseCodexAuth,
  parseOpenCodeGoWindows,
  ProviderRegistry,
  ProviderService,
  type Provider
} from "../main/providers";
import {
  isValidProviderId,
  normalizeHiddenWindows,
  normalizeProviderSource
} from "../main/settings";
import { providerPaths } from "../main/provider-paths";
import type { AppSettings, ProviderKind, ProviderSourceInfo } from "../shared/types";
import type { WslShell } from "../main/wsl";

function info(host: boolean, present: string[]): Pick<ProviderSourceInfo, "host" | "wsl"> {
  return {
    host,
    wsl: ["Ubuntu", "Debian"].map((distro) => ({ distro, present: present.includes(distro) }))
  };
}

test("chooseSource defaults to host when no preference", () => {
  assert.deepEqual(chooseSource(info(true, []), null), { location: "host" });
  assert.deepEqual(chooseSource(info(true, ["Ubuntu"]), null), { location: "host" });
});

test("chooseSource falls back to WSL when only WSL has data", () => {
  assert.deepEqual(chooseSource(info(false, ["Ubuntu"]), null), { location: "wsl", distro: "Ubuntu" });
});

test("chooseSource respects the saved choice", () => {
  assert.deepEqual(chooseSource(info(true, ["Ubuntu"]), { location: "wsl", distro: "Ubuntu" }), { location: "wsl", distro: "Ubuntu" });
  assert.deepEqual(chooseSource(info(true, ["Ubuntu"]), { location: "host" }), { location: "host" });
});

test("chooseSource falls back when the saved WSL distro no longer has data", () => {
  assert.deepEqual(chooseSource(info(true, ["Ubuntu"]), { location: "wsl", distro: "Debian" }), { location: "host" });
  assert.deepEqual(chooseSource(info(false, ["Ubuntu"]), { location: "wsl", distro: "Debian" }), { location: "wsl", distro: "Ubuntu" });
  assert.deepEqual(chooseSource(info(false, ["Ubuntu"]), { location: "host" }), { location: "wsl", distro: "Ubuntu" });
});

test("chooseSource returns null when no source has data", () => {
  assert.equal(chooseSource(info(false, []), null), null);
});

test("parseCodexAuth reads the current tokens format", () => {
  assert.deepEqual(parseCodexAuth(JSON.stringify({ tokens: { access_token: "access", account_id: "account" } })), { access: "access", accountId: "account" });
});

test("parseCodexAuth keeps supporting the legacy format", () => {
  assert.deepEqual(parseCodexAuth(JSON.stringify({ openai: { access: "access", accountId: "account" } })), { access: "access", accountId: "account" });
});

test("parseOpenCodeGoWindows reads the API reset date", () => {
  assert.deepEqual(parseOpenCodeGoWindows(JSON.stringify({ usage: { rolling: { percent: 12, resetsAt: "2026-09-01T12:00:00.000Z" } } })), [
    { title: "Current session", percent: 12, resetDate: "2026-09-01T12:00:00.000Z" }
  ]);
});

test("isValidProviderId validates provider kinds and profile identifiers", () => {
  assert.equal(isValidProviderId("Claude"), true);
  assert.equal(isValidProviderId("Codex"), true);
  assert.equal(isValidProviderId("OpenCode Go"), true);
  assert.equal(isValidProviderId("Cursor"), true);
  assert.equal(isValidProviderId("Antigravity"), true);
  assert.equal(isValidProviderId("Claude-work"), true);
  assert.equal(isValidProviderId("Claude-personal"), true);
  assert.equal(isValidProviderId("Cursor-profile"), true);
  assert.equal(isValidProviderId("invalid"), false);
  assert.equal(isValidProviderId(""), false);
  assert.equal(isValidProviderId(null), false);
  assert.equal(isValidProviderId(123), false);
});

test("normalizeProviderSource preserves string IDs including profiles and new providers", () => {
  const normalized = normalizeProviderSource({
    "Claude": { location: "host" },
    "Claude-work": { location: "wsl", distro: "Ubuntu" },
    "Cursor": { location: "host" },
    "Antigravity": { location: "wsl", distro: "Debian" },
    "invalid-provider": { location: "host" },
    "Claude-broken": { location: "invalid" }
  });

  assert.deepEqual(normalized, {
    "Claude": { location: "host" },
    "Claude-work": { location: "wsl", distro: "Ubuntu" },
    "Cursor": { location: "host" },
    "Antigravity": { location: "wsl", distro: "Debian" }
  });
});

test("normalizeHiddenWindows preserves string IDs including profiles and new providers", () => {
  const normalized = normalizeHiddenWindows({
    "Claude": ["Current session"],
    "Claude-work": ["All models"],
    "Cursor": ["API usage"],
    "Antigravity": ["5-hour Gemini"],
    "unknown": ["Some title"]
  });

  assert.deepEqual(normalized, {
    "Claude": ["Current session"],
    "Claude-work": ["All models"],
    "Cursor": ["API usage"],
    "Antigravity": ["5-hour Gemini"]
  });
});

test("ProviderRegistry instantiates all 5 providers and discovered Claude profiles", () => {
  const tempHome = mkdtempSync(join(tmpdir(), "metria-reg-"));
  try {
    const workDir = join(tempHome, ".claude-work");
    mkdirSync(workDir);
    writeFileSync(join(workDir, "settings.json"), "{}");

    const paths = providerPaths({ platform: "linux", home: tempHome, env: {} });
    const registry = new ProviderRegistry({ paths, home: tempHome });
    const all = registry.all();

    assert.equal(all.length, 6);
    const ids = all.map((p) => p.id);
    assert.ok(ids.includes("Claude"));
    assert.ok(ids.includes("Claude-work"));
    assert.ok(ids.includes("Codex"));
    assert.ok(ids.includes("OpenCode Go"));
    assert.ok(ids.includes("Cursor"));
    assert.ok(ids.includes("Antigravity"));

    assert.equal(registry.get("Cursor")?.kind, "Cursor");
    assert.equal(registry.get("Antigravity")?.kind, "Antigravity");
    assert.equal(registry.get("Claude-work")?.id, "Claude-work");
    assert.equal(registry.byKind("Claude").length, 2);
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});

const dummySettings: AppSettings = {
  refreshIntervalSeconds: 300,
  enabledProviders: ["Claude", "Codex", "OpenCode Go", "Cursor", "Antigravity"],
  widgetYOffset: 12,
  widgetAlongEdgeOffset: 0,
  showWidget: true,
  showTray: true,
  showAccountLabels: true,
  widgetBehavior: "pinned",
  widgetPosition: "right",
  widgetSize: "medium",
  widgetOpacity: 1,
  widgetDisplayId: null,
  providerSource: {},
  hiddenUsageWindowTitles: {},
  alerts: {
    enabled: true,
    cautionThreshold: 40,
    warningThreshold: 65,
    criticalThreshold: 85,
    cautionColor: "#ffd60a",
    warningColor: "#ff9f0a",
    criticalColor: "#ff453a"
  }
};

const makeMockShell = (distros: string[] = ["Ubuntu"], presence = { claude: true, codex: true, openCode: true, antigravity: true }): WslShell => ({
  distros: async () => distros,
  presence: async () => ({ ...presence }),
  readFile: async () => "{}",
  newestJsonl: async () => undefined,
  execCommand: async () => ""
});

const makeMockProvider = (
  id: string,
  kind: ProviderKind,
  options: { host?: boolean; shouldFail?: boolean; wslLabel?: string } = {}
): Provider => ({
  id,
  kind,
  hint: `hint-${id}`,
  hasHostCredentials: () => options.host ?? true,
  fetchHost: async () => {
    if (options.shouldFail) throw new Error(`Host error for ${id}`);
    return {
      id,
      kind,
      accountLabel: `${id}-host`,
      windows: [{ title: "Session", percent: 20, resetDate: null }],
      updatedAt: "2026-09-09T00:00:00.000Z",
      error: null,
      available: true,
      setupHint: ""
    };
  },
  fetchWsl: async (_shell, distro) => {
    if (options.shouldFail) throw new Error(`WSL error for ${id}`);
    return {
      id,
      kind,
      accountLabel: options.wslLabel ?? `${id}-wsl-${distro}`,
      windows: [{ title: "Session", percent: 50, resetDate: null }],
      updatedAt: "2026-09-09T00:00:00.000Z",
      error: null,
      available: true,
      setupHint: ""
    };
  }
});

test("ProviderService.sources maps host and WSL presence across all providers", async () => {
  const providers: Provider[] = [
    makeMockProvider("Claude", "Claude"),
    makeMockProvider("Claude-work", "Claude"),
    makeMockProvider("Codex", "Codex"),
    makeMockProvider("OpenCode Go", "OpenCode Go"),
    makeMockProvider("Cursor", "Cursor"),
    makeMockProvider("Antigravity", "Antigravity")
  ];

  const shell = makeMockShell(["Ubuntu"]);
  const service = new ProviderService(() => dummySettings, shell, undefined, providers);

  const sources = await service.sources(["Claude", "Claude-work", "Codex", "OpenCode Go", "Cursor", "Antigravity"]);
  assert.equal(sources.length, 6);

  const cursorSource = sources.find((s) => s.id === "Cursor");
  assert.ok(cursorSource);
  assert.equal(cursorSource.host, true);
  // Cursor is host-only: WSL present should be false
  assert.equal(cursorSource.wsl[0]?.present, false);

  const agySource = sources.find((s) => s.id === "Antigravity");
  assert.ok(agySource);
  assert.equal(agySource.host, true);
  assert.equal(agySource.wsl[0]?.present, true);

  const claudeWorkSource = sources.find((s) => s.id === "Claude-work");
  assert.ok(claudeWorkSource);
  assert.equal(claudeWorkSource.host, true);
  assert.equal(claudeWorkSource.wsl[0]?.present, true);
});

test("ProviderService.fetch retrieves usage from all 5 providers including Cursor and Antigravity", async () => {
  const providers: Provider[] = [
    makeMockProvider("Claude", "Claude"),
    makeMockProvider("Codex", "Codex"),
    makeMockProvider("OpenCode Go", "OpenCode Go"),
    makeMockProvider("Cursor", "Cursor"),
    makeMockProvider("Antigravity", "Antigravity")
  ];

  const shell = makeMockShell(["Ubuntu"]);
  const service = new ProviderService(() => dummySettings, shell, undefined, providers);

  const usage = await service.fetch(["Claude", "Codex", "OpenCode Go", "Cursor", "Antigravity"]);
  assert.equal(usage.length, 5);

  for (const item of usage) {
    assert.equal(item.available, true);
    assert.equal(item.error, null);
    assert.equal(item.accountLabel, `${item.id}-host`);
    assert.equal(item.windows.length, 1);
  }
});

test("ProviderService.fetch honors WSL source routing and Claude profiles", async () => {
  const providers: Provider[] = [
    makeMockProvider("Claude", "Claude"),
    makeMockProvider("Claude-work", "Claude")
  ];

  const settingsWithWsl: AppSettings = {
    ...dummySettings,
    providerSource: {
      "Claude-work": { location: "wsl", distro: "Ubuntu" }
    }
  };

  const shell = makeMockShell(["Ubuntu"]);
  const service = new ProviderService(() => settingsWithWsl, shell, undefined, providers);

  const usage = await service.fetch(["Claude", "Claude-work"]);
  assert.equal(usage.length, 2);

  const claudeDefault = usage.find((u) => u.id === "Claude");
  assert.equal(claudeDefault?.accountLabel, "Claude-host");

  const claudeWork = usage.find((u) => u.id === "Claude-work");
  assert.equal(claudeWork?.accountLabel, "Claude-work-wsl-Ubuntu");
});

test("ProviderService.fetch handles provider errors and unavailable status gracefully", async () => {
  const providers: Provider[] = [
    makeMockProvider("Cursor", "Cursor", { shouldFail: true }),
    makeMockProvider("Antigravity", "Antigravity", { host: false })
  ];

  // Shell with no presence for Antigravity
  const shell = makeMockShell(["Ubuntu"], { claude: false, codex: false, openCode: false, antigravity: false });
  const service = new ProviderService(() => dummySettings, shell, undefined, providers);

  const usage = await service.fetch(["Cursor", "Antigravity", "Unknown"]);
  assert.equal(usage.length, 3);

  // Failing provider
  const cursor = usage.find((u) => u.id === "Cursor");
  assert.equal(cursor?.available, true);
  assert.equal(cursor?.error, "Host error for Cursor");

  // Unavailable provider
  const agy = usage.find((u) => u.id === "Antigravity");
  assert.equal(agy?.available, false);
  assert.equal(agy?.setupHint, "hint-Antigravity");

  // Unknown provider ID
  const unknown = usage.find((u) => u.id === "Unknown");
  assert.equal(unknown?.available, false);
});
