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
