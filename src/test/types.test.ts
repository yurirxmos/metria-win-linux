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

test("parseProviderId handles empty slug gracefully", () => {
  const claudeTrailingHyphen = parseProviderId("Claude-");
  assert.deepEqual(claudeTrailingHyphen, { kind: "Claude", id: "Claude-", displayName: "Claude", slug: undefined });
});

test("multi-profile visibility filter strictly checks id and prevents profile collision", () => {
  const filter = (
    providers: { id: string; kind: any }[],
    enabled: string[]
  ) =>
    providers.filter(
      (p) =>
        enabled.includes(p.id) ||
        (p.id === p.kind && enabled.includes(p.kind))
    );

  const providers = [
    { id: "Claude", kind: "Claude" as const },
    { id: "Claude-work", kind: "Claude" as const },
    { id: "Cursor", kind: "Cursor" as const }
  ];

  // Claude is enabled, Claude-work is disabled: Claude-work MUST be hidden
  const enabledOnlyDefault = ["Claude", "Cursor"];
  const resDefault = filter(providers, enabledOnlyDefault);
  assert.equal(resDefault.length, 2);
  assert.deepEqual(resDefault.map((p) => p.id), ["Claude", "Cursor"]);

  // Claude-work is enabled, Claude default is disabled: only Claude-work is visible
  const enabledOnlyWork = ["Claude-work", "Cursor"];
  const resWork = filter(providers, enabledOnlyWork);
  assert.equal(resWork.length, 2);
  assert.deepEqual(resWork.map((p) => p.id), ["Claude-work", "Cursor"]);

  // Both are enabled
  const enabledBoth = ["Claude", "Claude-work", "Cursor"];
  const resBoth = filter(providers, enabledBoth);
  assert.equal(resBoth.length, 3);
});

test("tray row labeling differentiates profiles cleanly", () => {
  const labelFor = (id: string, kind: any) => {
    const parsed = parseProviderId(id);
    const short = kind === "OpenCode Go" ? "Go" : kind;
    return parsed.slug ? `${short} (${parsed.slug})` : short;
  };

  assert.equal(labelFor("Claude", "Claude"), "Claude");
  assert.equal(labelFor("Claude-work", "Claude"), "Claude (work)");
  assert.equal(labelFor("Cursor", "Cursor"), "Cursor");
  assert.equal(labelFor("OpenCode Go", "OpenCode Go"), "Go");
  assert.equal(labelFor("OpenCode Go-personal", "OpenCode Go"), "Go (personal)");
});

test("cache serialization preserves id and deserialization restores id", () => {
  // Serializing
  const providerToCache = (value: { id?: string; kind: string; accountLabel: string | null; windows: any[]; updatedAt: string }) => ({
    id: value.id || value.kind,
    kind: value.kind,
    accountLabel: value.accountLabel,
    windows: value.windows,
    updatedAt: value.updatedAt
  });

  const entry = {
    id: "Claude-work",
    kind: "Claude",
    accountLabel: "work@corp.com",
    windows: [{ title: "Session", percent: 30, resetDate: null }],
    updatedAt: "2026-09-09T00:00:00.000Z"
  };

  const cached = providerToCache(entry);
  assert.equal(cached.id, "Claude-work");

  // Deserializing with id
  const fromCacheWithId = (value: any) => ({
    ...value,
    id: value.id || value.kind,
    error: null,
    available: true
  });
  const restored = fromCacheWithId(cached);
  assert.equal(restored.id, "Claude-work");
  assert.equal(restored.kind, "Claude");

  // Deserializing legacy without id falls back to kind
  const legacyCached = {
    kind: "Claude",
    accountLabel: "legacy@example.com",
    windows: [],
    updatedAt: null
  };
  const restoredLegacy = fromCacheWithId(legacyCached);
  assert.equal(restoredLegacy.id, "Claude");
  assert.equal(restoredLegacy.kind, "Claude");
});

