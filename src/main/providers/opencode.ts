import { existsSync, readFileSync } from "node:fs";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";
import type { Provider } from "./types";

export class OpenCodeGoProvider implements Provider {
  readonly id = "OpenCode Go";
  readonly kind: ProviderKind = "OpenCode Go";
  readonly hint = "Sign in to OpenCode Go to create a local API credential.";

  constructor(private readonly paths: ProviderPaths) {}

  hasHostCredentials(): boolean {
    return existsSync(this.paths.openCodeAuth);
  }

  async fetchHost(): Promise<ProviderUsage> {
    return this.usage(readFileSync(this.paths.openCodeAuth, "utf8"));
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    return this.usage(await shell.readFile(distro, ".local/share/opencode/auth.json"));
  }

  private async usage(auth: string): Promise<ProviderUsage> {
    const key = parseOpenCodeGoKey(auth);
    if (!key) throw new Error("OpenCode Go credentials were not found.");
    const data = await requestWithRetry("https://opencode.ai/zen/go/v1/usage", {
      Authorization: `Bearer ${key}`
    });
    const windows = parseOpenCodeGoWindows(data);
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: maskKey(key),
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }
}

export function parseOpenCodeGoWindows(data: string): UsageWindow[] {
  const parsed = JSON.parse(data) as {
    usage?: Record<string, { percent?: number; resetsAt?: string; resets_at?: string }>;
  };
  return [["Current session", "rolling"], ["This week", "weekly"], ["This month", "monthly"]].flatMap(
    ([title, keyName]) => {
      const limit = parsed.usage?.[keyName as string];
      return limit
        ? [{ title, percent: Number(limit.percent ?? 0), resetDate: limit.resetsAt ?? limit.resets_at ?? null }]
        : [];
    }
  );
}

export function parseOpenCodeGoKey(auth: string): string | undefined {
  try {
    return (JSON.parse(auth) as { "opencode-go"?: { key?: string } })["opencode-go"]?.key;
  } catch {
    return undefined;
  }
}

function maskKey(key: string): string {
  return key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : "********";
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
