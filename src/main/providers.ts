import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppSettings, ProviderKind, ProviderSourceChoice, ProviderSourceInfo, ProviderUsage, UsageWindow, WslPresence } from "../shared/types";
import { PRESENCE_CACHE_TTL_MS } from "../shared/types";
import { providerPaths, type ProviderPaths } from "./provider-paths";
import { makeWslShell, type WslProviderPresence, type WslShell } from "./wsl";

const defaultPaths: ProviderPaths = providerPaths({ platform: process.platform, home: homedir(), env: process.env });

interface Provider {
  readonly kind: ProviderKind;
  readonly hint: string;
  hasHostCredentials(): boolean;
  fetchHost(): Promise<ProviderUsage>;
  fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage>;
}

export class ProviderService {
  private readonly providers: Provider[];
  private readonly presenceResults = new Map<string, { at: number; presence: WslProviderPresence }>();

  constructor(
    private readonly loadSettings: () => AppSettings,
    private readonly wsl: WslShell = makeWslShell(),
    paths: ProviderPaths = defaultPaths
  ) {
    this.providers = [new ClaudeProvider(paths), new CodexProvider(paths), new OpenCodeGoProvider(paths)];
  }

  async fetch(enabled: ProviderKind[]): Promise<ProviderUsage[]> {
    const entries = await this.sources(enabled);
    return Promise.all(entries.map(async (entry) => {
      const provider = this.providerFor(entry.kind);
      if (!provider) return unavailable(entry.kind, "");
      const source = chooseSource(entry, entry.source);
      if (!source) return unavailable(entry.kind, provider.hint);
      try {
        return source.location === "wsl"
          ? await provider.fetchWsl(this.wsl, source.distro ?? "")
          : await provider.fetchHost();
      } catch (error) {
        return { ...unavailable(entry.kind, provider.hint), available: true, error: error instanceof Error ? error.message : "Unable to load usage." };
      }
    }));
  }

  async sources(kinds: ProviderKind[]): Promise<ProviderSourceInfo[]> {
    const saved = this.loadSettings().providerSource ?? {};
    const distros = await this.wsl.distros();
    const presences = new Map<string, WslProviderPresence>();
    for (const distro of distros) presences.set(distro, await this.presence(distro));
    return kinds.map((kind) => {
      const populationKey = POPULATION_BY_KIND[kind];
      const wsl: WslPresence[] = distros.map((distro) => ({ distro, present: populationKey ? (presences.get(distro)?.[populationKey] ?? false) : false }));
      const host = this.providerFor(kind)?.hasHostCredentials() ?? false;
      const source = saved[kind] ?? null;
      const needsChoice = host && wsl.some((entry) => entry.present) && !source;
      return { kind, host, wsl, source, needsChoice };
    });
  }

  private providerFor(kind: ProviderKind): Provider | undefined {
    return this.providers.find((provider) => provider.kind === kind);
  }

  private async presence(distro: string): Promise<WslProviderPresence> {
    const cached = this.presenceResults.get(distro);
    if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached.presence;
    const presence = await this.wsl.presence(distro);
    this.presenceResults.set(distro, { at: Date.now(), presence });
    return presence;
  }
}

const POPULATION_BY_KIND: Partial<Record<ProviderKind, keyof WslProviderPresence>> = { Claude: "claude", Codex: "codex", "OpenCode Go": "openCode" };
const WSL_DIR_BY_KIND: Partial<Record<ProviderKind, string>> = { Codex: ".codex/sessions" };

/** Pick the data source for a provider given saved preference (if any) and presence. */
export function chooseSource(info: Pick<ProviderSourceInfo, "host" | "wsl">, saved: ProviderSourceChoice | null): ProviderSourceChoice | null {
  const wslSource = (): ProviderSourceChoice | null => {
    const present = info.wsl.find((entry) => entry.present);
    return present ? { location: "wsl", distro: present.distro } : null;
  };
  if (saved) {
    if (saved.location === "host") return info.host ? saved : wslSource();
    return info.wsl.some((entry) => entry.distro === saved.distro && entry.present) ? saved : info.host ? { location: "host" } : wslSource();
  }
  return info.host ? { location: "host" } : wslSource();
}

class ClaudeProvider implements Provider {
  readonly kind = "Claude" as const;
  readonly hint = "Run `claude auth login` in your terminal to create local Claude Code credentials, then refresh Metria.";
  constructor(private readonly paths: ProviderPaths) {}
  hasHostCredentials(): boolean { return existsSync(this.paths.claudeCredentials); }
  async fetchHost(): Promise<ProviderUsage> { const credentials = readFileSyncPath(this.paths.claudeCredentials); return this.usage(this.readToken(credentials), this.accountLabel(credentials)); }
  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> { const credentials = await shell.readFile(distro, ".claude/.credentials.json"); return this.usage(this.readToken(credentials), this.accountLabel(credentials)); }
  private readToken(credentials: string): string | undefined {
    try {
      return (JSON.parse(credentials) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
    } catch { return undefined; }
  }
  private accountLabel(credentials: string): string | null { try { const value = JSON.parse(credentials) as { email?: string; claudeAiOauth?: { email?: string } }; return value.email ?? value.claudeAiOauth?.email ?? null; } catch { return null; } }
  private async usage(token: string | undefined, accountLabel: string | null): Promise<ProviderUsage> {
    if (!token) throw new Error("Claude Code credentials were not found. Run `claude auth login`.");
    const data = JSON.parse(await requestWithRetry("https://api.anthropic.com/api/oauth/usage", { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" })) as { five_hour?: { utilization?: number; resets_at?: string }; seven_day?: { utilization?: number; resets_at?: string } };
    return loaded(this.kind, [
      { title: "Current session", percent: Number(data.five_hour?.utilization ?? 0), resetDate: data.five_hour?.resets_at ?? null },
      { title: "All models", percent: Number(data.seven_day?.utilization ?? 0), resetDate: data.seven_day?.resets_at ?? null }
    ], accountLabel);
  }
}

class CodexProvider implements Provider {
  readonly kind = "Codex" as const;
  readonly hint = "Sign in with Codex to create local session data.";
  constructor(private readonly paths: ProviderPaths) {}
  hasHostCredentials(): boolean { return existsSync(this.paths.codexAuth) || existsSync(this.paths.codexSessions); }
  async fetchHost(): Promise<ProviderUsage> {
    if (existsSync(this.paths.codexAuth)) {
      const remote = await openCodeRemoteUsage(readFileSync(this.paths.codexAuth, "utf8"));
      if (remote) return remote;
    }
    return this.localUsage(readFileSyncPathOrEmpty(this.paths.codexSessions));
  }
  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    let remote: ProviderUsage | undefined;
    try { remote = await openCodeRemoteUsage(await shell.readFile(distro, ".codex/auth.json")); } catch { /* No WSL auth file. */ }
    if (remote) return remote;
    const newest = await shell.newestJsonl(distro, WSL_DIR_BY_KIND.Codex!);
    if (!newest) return empty(this.kind);
    return this.localUsage(await shell.readFile(distro, newest));
  }
  private localUsage(content: string): ProviderUsage {
    const windows = parseSessionWindows(content);
    return windows.length ? loaded(this.kind, windows) : empty(this.kind);
  }
}

class OpenCodeGoProvider implements Provider {
  readonly kind = "OpenCode Go" as const;
  readonly hint = "Sign in to OpenCode Go to create a local API credential.";
  constructor(private readonly paths: ProviderPaths) {}
  hasHostCredentials(): boolean { return existsSync(this.paths.openCodeAuth); }
  async fetchHost(): Promise<ProviderUsage> { return this.usage(readFileSync(this.paths.openCodeAuth, "utf8")); }
  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> { return this.usage(await shell.readFile(distro, ".local/share/opencode/auth.json")); }
  private async usage(auth: string): Promise<ProviderUsage> {
    const key = parseOpenCodeGoKey(auth);
    if (!key) throw new Error("OpenCode Go credentials were not found.");
    const data = await requestWithRetry("https://opencode.ai/zen/go/v1/usage", { Authorization: `Bearer ${key}` });
    const windows = parseOpenCodeGoWindows(data);
    return loaded(this.kind, windows, maskKey(key));
  }
}

export function parseOpenCodeGoWindows(data: string): UsageWindow[] {
  const parsed = JSON.parse(data) as { usage?: Record<string, { percent?: number; resetsAt?: string; resets_at?: string }> };
  return [["Current session", "rolling"], ["This week", "weekly"], ["This month", "monthly"]].flatMap(([title, keyName]) => {
    const limit = parsed.usage?.[keyName as string];
    return limit ? [{ title, percent: Number(limit.percent ?? 0), resetDate: limit.resetsAt ?? limit.resets_at ?? null }] : [];
  });
}

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: { ...headers, "User-Agent": "Metria-Electron/0.1" }, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function requestWithRetry(url: string, headers: Record<string, string>): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchWithTimeout(url, headers);
      if (response.ok) return response.text();
      if (response.status === 429 && attempt < 2) {
        const retry = Math.min(Number(response.headers.get("Retry-After") ?? 2 ** (attempt + 1)) * 1000, 30_000);
        await sleep(Number.isFinite(retry) ? retry : 2000);
        continue;
      }
      throw new Error(response.status === 429 ? "The provider rate limited Metria. Try again shortly." : `The provider returned ${response.status}.`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
    }
  }
  throw lastError ?? new Error("Unable to load usage.");
}

function parseOpenCodeGoKey(auth: string): string | undefined {
  try {
    return (JSON.parse(auth) as { "opencode-go"?: { key?: string } })["opencode-go"]?.key;
  } catch { return undefined; }
}

async function openCodeRemoteUsage(auth: string): Promise<ProviderUsage | undefined> {
  const parsed = parseCodexAuth(auth);
  if (!parsed) return undefined;
  try {
    const data = await requestWithRetry("https://chatgpt.com/backend-api/wham/usage", { Authorization: `Bearer ${parsed.access}`, "ChatGPT-Account-Id": parsed.accountId });
    const rateLimit = (JSON.parse(data) as { rate_limit?: { primary_window?: { used_percent?: number; reset_at?: number }; secondary_window?: { used_percent?: number; reset_at?: number } } }).rate_limit;
    if (!rateLimit) return undefined;
    return loaded("Codex", [["Current session", rateLimit.primary_window], ["All models", rateLimit.secondary_window]].flatMap(([title, limit]) => {
      const typed = limit as { used_percent?: number; reset_at?: number } | undefined;
      return typed?.used_percent === undefined ? [] : [{ title: String(title), percent: Number(typed.used_percent), resetDate: typed.reset_at ? new Date(typed.reset_at * 1000).toISOString() : null }];
    }), parsed.accountId);
  } catch { return undefined; }
}

export function parseCodexAuth(auth: string): { access: string; accountId: string } | undefined {
  try {
    const parsed = JSON.parse(auth) as {
      openai?: { access?: string; accountId?: string };
      tokens?: { access_token?: string; account_id?: string };
    };
    if (parsed.tokens?.access_token && parsed.tokens.account_id) return { access: parsed.tokens.access_token, accountId: parsed.tokens.account_id };
    return parsed.openai?.access && parsed.openai.accountId ? { access: parsed.openai.access, accountId: parsed.openai.accountId } : undefined;
  } catch { return undefined; }
}

function parseSessionWindows(content: string): UsageWindow[] {
  const lines = content.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as { payload?: { rate_limits?: Record<string, { used_percent?: number; resets_at?: number }>; info?: { rate_limits?: Record<string, { used_percent?: number; resets_at?: number }> } } };
      const limits = value.payload?.rate_limits ?? value.payload?.info?.rate_limits;
      if (limits) {
        const windows = [["Current session", limits.primary], ["All models", limits.secondary]].flatMap(([title, limit]) => {
          const typed = limit as { used_percent?: number; resets_at?: number } | undefined;
          return typed?.used_percent === undefined ? [] : [{ title: String(title), percent: Number(typed.used_percent), resetDate: typed.resets_at ? new Date(typed.resets_at * 1000).toISOString() : null }];
        });
        if (windows.length) return windows;
      }
    } catch { /* Ignore malformed local event lines. */ }
  }
  return [];
}

function newestSessionFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const files: { path: string; modified: number }[] = [];
  const visit = (directory: string) => readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const candidate = join(directory, entry.name);
    if (entry.isDirectory()) visit(candidate);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push({ path: candidate, modified: statSync(candidate).mtimeMs });
  });
  visit(path);
  return files.sort((left, right) => right.modified - left.modified)[0]?.path;
}

function readFileSyncPath(path: string): string {
  try { return readFileSync(path, "utf8"); } catch { return ""; }
}
function readFileSyncPathOrEmpty(path: string): string {
  const newest = newestSessionFile(path);
  return newest ? readFileSync(newest, "utf8") : "";
}

function loaded(kind: ProviderKind, windows: UsageWindow[], accountLabel: string | null = null): ProviderUsage { return { id: kind, kind, accountLabel, windows, updatedAt: new Date().toISOString(), error: null, available: true, setupHint: "" }; }
function empty(kind: ProviderKind): ProviderUsage { return { ...loaded(kind, []), error: "No current usage data was found." }; }
function unavailable(kind: ProviderKind, setupHint: string): ProviderUsage { return { id: kind, kind, accountLabel: null, windows: [], updatedAt: null, error: null, available: false, setupHint }; }
function maskKey(key: string): string { return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "********"; }
