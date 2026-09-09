import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";
import type { Provider } from "./types";

export class CodexProvider implements Provider {
  readonly id = "Codex";
  readonly kind: ProviderKind = "Codex";
  readonly hint = "Sign in with Codex to create local session data.";

  constructor(private readonly paths: ProviderPaths) {}

  hasHostCredentials(): boolean {
    return existsSync(this.paths.codexAuth) || existsSync(this.paths.codexSessions);
  }

  async fetchHost(): Promise<ProviderUsage> {
    if (existsSync(this.paths.codexAuth)) {
      const remote = await openCodeRemoteUsage(readFileSync(this.paths.codexAuth, "utf8"));
      if (remote) return remote;
    }
    return this.localUsage(readFileSyncPathOrEmpty(this.paths.codexSessions));
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    let remote: ProviderUsage | undefined;
    try {
      remote = await openCodeRemoteUsage(await shell.readFile(distro, ".codex/auth.json"));
    } catch {
      /* No WSL auth file. */
    }
    if (remote) return remote;
    const newest = await shell.newestJsonl(distro, ".codex/sessions");
    if (!newest) return this.emptyUsage();
    return this.localUsage(await shell.readFile(distro, newest));
  }

  private localUsage(content: string): ProviderUsage {
    const windows = parseSessionWindows(content);
    return windows.length ? this.loadedUsage(windows) : this.emptyUsage();
  }

  private loadedUsage(windows: UsageWindow[], accountLabel: string | null = null): ProviderUsage {
    return {
      id: this.id,
      kind: this.kind,
      accountLabel,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }

  private emptyUsage(): ProviderUsage {
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows: [],
      updatedAt: new Date().toISOString(),
      error: "No current usage data was found.",
      available: true,
      setupHint: ""
    };
  }
}

export function parseCodexAuth(auth: string): { access: string; accountId: string } | undefined {
  try {
    const parsed = JSON.parse(auth) as {
      openai?: { access?: string; accountId?: string };
      tokens?: { access_token?: string; account_id?: string };
    };
    if (parsed.tokens?.access_token && parsed.tokens.account_id) {
      return { access: parsed.tokens.access_token, accountId: parsed.tokens.account_id };
    }
    return parsed.openai?.access && parsed.openai.accountId
      ? { access: parsed.openai.access, accountId: parsed.openai.accountId }
      : undefined;
  } catch {
    return undefined;
  }
}

export function parseSessionWindows(content: string): UsageWindow[] {
  const lines = content.trim().split("\n").reverse();
  for (const line of lines) {
    try {
      const value = JSON.parse(line) as {
        payload?: {
          rate_limits?: Record<string, { used_percent?: number; resets_at?: number }>;
          info?: { rate_limits?: Record<string, { used_percent?: number; resets_at?: number }> };
        };
      };
      const limits = value.payload?.rate_limits ?? value.payload?.info?.rate_limits;
      if (limits) {
        const windows = [["Current session", limits.primary], ["All models", limits.secondary]].flatMap(
          ([title, limit]) => {
            const typed = limit as { used_percent?: number; resets_at?: number } | undefined;
            return typed?.used_percent === undefined
              ? []
              : [
                  {
                    title: String(title),
                    percent: Number(typed.used_percent),
                    resetDate: typed.resets_at ? new Date(typed.resets_at * 1000).toISOString() : null
                  }
                ];
          }
        );
        if (windows.length) return windows;
      }
    } catch {
      /* Ignore malformed local event lines. */
    }
  }
  return [];
}

function newestSessionFile(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const files: { path: string; modified: number }[] = [];
  const visit = (directory: string) =>
    readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const candidate = join(directory, entry.name);
      if (entry.isDirectory()) visit(candidate);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push({ path: candidate, modified: statSync(candidate).mtimeMs });
      }
    });
  visit(path);
  return files.sort((left, right) => right.modified - left.modified)[0]?.path;
}

function readFileSyncPathOrEmpty(path: string): string {
  const newest = newestSessionFile(path);
  return newest ? readFileSync(newest, "utf8") : "";
}

const REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string, headers: Record<string, string>): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { ...headers, "User-Agent": "Metria-Electron/0.1" },
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      throw new Error(
        response.status === 429
          ? "The provider rate limited Metria. Try again shortly."
          : `The provider returned ${response.status}.`
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === 2) throw lastError;
    }
  }
  throw lastError ?? new Error("Unable to load usage.");
}

async function openCodeRemoteUsage(auth: string): Promise<ProviderUsage | undefined> {
  const parsed = parseCodexAuth(auth);
  if (!parsed) return undefined;
  try {
    const data = await requestWithRetry("https://chatgpt.com/backend-api/wham/usage", {
      Authorization: `Bearer ${parsed.access}`,
      "ChatGPT-Account-Id": parsed.accountId
    });
    const rateLimit = (
      JSON.parse(data) as {
        rate_limit?: {
          primary_window?: { used_percent?: number; reset_at?: number };
          secondary_window?: { used_percent?: number; reset_at?: number };
        };
      }
    ).rate_limit;
    if (!rateLimit) return undefined;
    const windows = [["Current session", rateLimit.primary_window], ["All models", rateLimit.secondary_window]].flatMap(
      ([title, limit]) => {
        const typed = limit as { used_percent?: number; reset_at?: number } | undefined;
        return typed?.used_percent === undefined
          ? []
          : [
              {
                title: String(title),
                percent: Number(typed.used_percent),
                resetDate: typed.reset_at ? new Date(typed.reset_at * 1000).toISOString() : null
              }
            ];
      }
    );
    return {
      id: "Codex",
      kind: "Codex",
      accountLabel: parsed.accountId,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  } catch {
    return undefined;
  }
}
