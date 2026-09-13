import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CursorStateStore, CursorProvider, isJwtExpired, parseCursorWindows } from "../main/providers/cursor";
import type { ProviderPaths } from "../main/provider-paths";

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

test("CursorStateStore returns null when database or key does not exist", () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-test-"));
  const nonExistent = join(dir, "missing.vscdb");
  const store1 = new CursorStateStore(nonExistent);
  assert.equal(store1.readToken(), null);

  const dbPath = join(dir, "empty.vscdb");
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.close();

  const store2 = new CursorStateStore(dbPath);
  assert.equal(store2.readToken(), null);

  rmSync(dir, { recursive: true, force: true });
});

test("isJwtExpired correctly identifies expired vs valid tokens", () => {
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");

  assert.equal(isJwtExpired(`header.${expiredPayload}.sig`), true);
  assert.equal(isJwtExpired(`header.${validPayload}.sig`), false);
  assert.equal(isJwtExpired("invalid-token"), true);
});

test("isJwtExpired handles edge cases", () => {
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const noExpPayload = Buffer.from(JSON.stringify({ sub: "user-123" })).toString("base64url");
  const badJsonPayload = Buffer.from("not-json").toString("base64url");

  assert.equal(isJwtExpired(`header.${expiredPayload}.sig`), true);
  assert.equal(isJwtExpired(`header.${validPayload}.sig`), false);
  assert.equal(isJwtExpired(`header.${noExpPayload}.sig`), false);
  assert.equal(isJwtExpired(`header.${badJsonPayload}.sig`), true);
  assert.equal(isJwtExpired("invalid-token"), true);
  assert.equal(isJwtExpired(""), true);
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

test("parseCursorWindows handles clamps, empty data, and fallbacks", () => {
  assert.deepEqual(parseCursorWindows("invalid json"), []);
  assert.deepEqual(parseCursorWindows("{}"), []);

  // Clamping
  const clamped = parseCursorWindows(JSON.stringify({
    planUsage: {
      autoPercentUsed: 150,
      apiPercentUsed: -10
    }
  }));
  assert.equal(clamped[0].percent, 100);
  assert.equal(clamped[1].percent, 0);

  // Fallback to includedSpend / limit
  const spendFallback = parseCursorWindows(JSON.stringify({
    planUsage: {
      includedSpend: 10,
      limit: 20
    }
  }));
  assert.equal(spendFallback.length, 1);
  assert.equal(spendFallback[0].title, "This cycle");
  assert.equal(spendFallback[0].percent, 50);

  // Fallback to totalPercentUsed
  const totalFallback = parseCursorWindows(JSON.stringify({
    planUsage: {
      totalPercentUsed: 75
    }
  }));
  assert.equal(totalFallback.length, 1);
  assert.equal(totalFallback[0].percent, 75);
});

test("CursorProvider hasHostCredentials and fetchHost behavior", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-provider-test-"));
  const dbPath = join(dir, "state.vscdb");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const validToken = `header.${validPayload}.sig`;

  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${validToken}');`);
  db.close();

  const fakePaths: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: dbPath,
    antigravityBin: ""
  };

  const provider = new CursorProvider(fakePaths);
  assert.equal(provider.hasHostCredentials(), true);

  // Mock global.fetch
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input.toString(), "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
      assert.equal(init?.method, "POST");
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["Authorization"], `Bearer ${validToken}`);
      assert.equal(headers["Connect-Protocol-Version"], "1");

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          planUsage: { autoPercentUsed: 60, apiPercentUsed: 20 },
          billingCycleEnd: "1725667200000"
        })
      } as Response;
    }) as typeof fetch;

    const usage = await provider.fetchHost();
    assert.equal(usage.id, "Cursor");
    assert.equal(usage.kind, "Cursor");
    assert.equal(usage.available, true);
    assert.equal(usage.error, null);
    assert.equal(usage.windows.length, 2);
    assert.equal(usage.windows[0].percent, 60);

    const wslUsage = await provider.fetchWsl({} as any, "Ubuntu");
    assert.equal(wslUsage.windows[0].percent, 60);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CursorProvider error handling", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-errors-test-"));
  const dbPath = join(dir, "state.vscdb");
  const expiredPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 60 })).toString("base64url");
  const expiredToken = `header.${expiredPayload}.sig`;

  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${expiredToken}');`);
  db.close();

  const pathsWithExpired: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: dbPath,
    antigravityBin: ""
  };

  const expiredProvider = new CursorProvider(pathsWithExpired);
  await assert.rejects(
    async () => expiredProvider.fetchHost(),
    { message: "Sign in to Cursor again to refresh usage." }
  );

  const missingProvider = new CursorProvider({
    ...pathsWithExpired,
    cursorStateDb: join(dir, "nonexistent.vscdb")
  });
  await assert.rejects(
    async () => missingProvider.fetchHost(),
    { message: "Cursor credentials were not found." }
  );

  // Valid token but API returns 401 or 500
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const validToken = `header.${validPayload}.sig`;

  const db2 = new DatabaseSync(dbPath);
  db2.exec(`UPDATE ItemTable SET value = '${validToken}' WHERE key = 'cursorAuth/accessToken';`);
  db2.close();

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => expiredProvider.fetchHost(),
      { message: "Sign in to Cursor again to refresh usage." }
    );

    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error"
    })) as unknown as typeof fetch;

    await assert.rejects(
      async () => expiredProvider.fetchHost(),
      { message: "The provider returned 500." }
    );
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CursorProvider retries on HTTP 429 and succeeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-retry-test-"));
  const dbPath = join(dir, "state.vscdb");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const validToken = `header.${validPayload}.sig`;

  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${validToken}');`);
  db.close();

  const fakePaths: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: dbPath,
    antigravityBin: ""
  };

  const sleepCalls: number[] = [];
  const mockSleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  const provider = new CursorProvider(fakePaths, mockSleep);

  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      attempts++;
      assert.ok(init?.signal, "Expected signal to be present");
      if (attempts === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "3" }),
          text: async () => "Rate limited"
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          planUsage: { autoPercentUsed: 45 },
          billingCycleEnd: "1725667200000"
        })
      } as Response;
    }) as typeof fetch;

    const usage = await provider.fetchHost();
    assert.equal(attempts, 2);
    assert.equal(sleepCalls.length, 1);
    assert.equal(sleepCalls[0], 3000);
    assert.equal(usage.windows[0].percent, 45);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CursorProvider exhausts 3 attempts on HTTP 429 and throws rate limit error", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cursor-429-fail-test-"));
  const dbPath = join(dir, "state.vscdb");
  const validPayload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  const validToken = `header.${validPayload}.sig`;

  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT);");
  db.exec(`INSERT INTO ItemTable (key, value) VALUES ('cursorAuth/accessToken', '${validToken}');`);
  db.close();

  const fakePaths: ProviderPaths = {
    codexAuth: "",
    codexSessions: "",
    openCodeAuth: "",
    claudeCredentials: "",
    cursorStateDb: dbPath,
    antigravityBin: ""
  };

  const sleepCalls: number[] = [];
  const mockSleep = async (ms: number) => {
    sleepCalls.push(ms);
  };

  const provider = new CursorProvider(fakePaths, mockSleep);

  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      attempts++;
      assert.ok(init?.signal, "Expected signal to be present");
      return {
        ok: false,
        status: 429,
        headers: new Headers(),
        text: async () => "Rate limited"
      } as unknown as Response;
    }) as typeof fetch;

    await assert.rejects(
      async () => provider.fetchHost(),
      { message: "The provider rate limited Metria. Try again shortly." }
    );
    assert.equal(attempts, 3);
    assert.equal(sleepCalls.length, 2);
    assert.equal(sleepCalls[0], 2000); // 2 ** 1 * 1000
    assert.equal(sleepCalls[1], 4000); // 2 ** 2 * 1000
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

