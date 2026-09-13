import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderKind, ProviderUsage } from "../../shared/types";
import type { WslShell } from "../wsl";

export interface ClaudeProfile {
  slug?: string;
  id: string; // "Claude" or "Claude-work"
  displayName: string;
  configDirectory: string;
  accountFile: string;
}

export const ClaudeProfile = {
  discover: discoverClaudeProfiles
};


const PROFILE_MARKERS = ["sessions", "projects", "settings.json", "history.jsonl", ".claude.json", ".credentials.json"];

export function discoverClaudeProfiles(home: string): ClaudeProfile[] {
  const defaultProfile: ClaudeProfile = {
    slug: undefined,
    id: "Claude",
    displayName: "Claude",
    configDirectory: join(home, ".claude"),
    accountFile: join(home, ".claude.json")
  };

  const extraProfiles: ClaudeProfile[] = [];
  try {
    const entries = readdirSync(home, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(".claude-")) continue;
      const slug = entry.name.slice(".claude-".length);
      if (!slug) continue;
      const configDirectory = join(home, entry.name);
      const isReal = PROFILE_MARKERS.some((marker) => existsSync(join(configDirectory, marker)));
      if (!isReal) continue;

      extraProfiles.push({
        slug,
        id: `Claude-${slug}`,
        displayName: `Claude (${slug})`,
        configDirectory,
        accountFile: join(configDirectory, ".claude.json")
      });
    }
  } catch { /* ignore directory read errors */ }

  extraProfiles.sort((a, b) => (a.slug ?? "").localeCompare(b.slug ?? ""));
  return [defaultProfile, ...extraProfiles];
}

export function readProfileCredentials(configDirectory: string, accountFile: string): { token?: string; email?: string } {
  let token: string | undefined;
  let email: string | undefined;

  const credPath = join(configDirectory, ".credentials.json");
  if (existsSync(credPath)) {
    try {
      const parsed = JSON.parse(readFileSync(credPath, "utf8")) as {
        email?: string;
        claudeAiOauth?: { accessToken?: string; email?: string };
      };
      token = parsed.claudeAiOauth?.accessToken;
      email = parsed.email ?? parsed.claudeAiOauth?.email;
    } catch { /* ignore */ }
  }

  if (!email && existsSync(accountFile)) {
    try {
      const parsed = JSON.parse(readFileSync(accountFile, "utf8")) as {
        oauthAccount?: { emailAddress?: string };
      };
      email = parsed.oauthAccount?.emailAddress;
    } catch { /* ignore */ }
  }

  return { token, email };
}

export class ClaudeProvider {
  readonly kind: ProviderKind = "Claude";
  readonly id: string;
  readonly hint: string;

  constructor(public readonly profile: ClaudeProfile) {
    this.id = profile.id;
    this.hint = profile.slug
      ? `Run \`CLAUDE_CONFIG_DIR=~/.claude-${profile.slug} claude auth login\` to authenticate.`
      : "Run `claude auth login` in your terminal to create local Claude Code credentials, then refresh Metria.";
  }

  hasHostCredentials(): boolean {
    const { token } = readProfileCredentials(this.profile.configDirectory, this.profile.accountFile);
    return Boolean(token);
  }

  private async requestUsage(token: string, timeoutMs = 10_000): Promise<{
    five_hour?: { utilization?: number; resets_at?: string };
    seven_day?: { utilization?: number; resets_at?: string };
  }> {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "Metria-Electron/0.1"
      },
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (res.status === 401) {
      throw new Error(`Claude Code credentials have expired. ${this.hint}`);
    }
    if (!res.ok) {
      throw new Error(`The provider returned ${res.status}.`);
    }

    return (await res.json()) as {
      five_hour?: { utilization?: number; resets_at?: string };
      seven_day?: { utilization?: number; resets_at?: string };
    };
  }

  async fetchHost(): Promise<ProviderUsage> {
    const { token, email } = readProfileCredentials(this.profile.configDirectory, this.profile.accountFile);
    if (!token) throw new Error(`Claude credentials were not found. ${this.hint}`);

    const data = await this.requestUsage(token);

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: email ?? null,
      windows: [
        { title: "Current session", percent: Number(data.five_hour?.utilization ?? 0), resetDate: data.five_hour?.resets_at ?? null },
        { title: "All models", percent: Number(data.seven_day?.utilization ?? 0), resetDate: data.seven_day?.resets_at ?? null }
      ],
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    const relPath = this.profile.slug ? `.claude-${this.profile.slug}/.credentials.json` : ".claude/.credentials.json";
    let credentials: string;
    try {
      credentials = await shell.readFile(distro, relPath);
    } catch {
      throw new Error("Claude Code credentials were not found in WSL.");
    }

    let token: string | undefined;
    let email: string | undefined;
    try {
      const parsed = JSON.parse(credentials) as { email?: string; claudeAiOauth?: { accessToken?: string; email?: string } };
      token = parsed.claudeAiOauth?.accessToken;
      email = parsed.email ?? parsed.claudeAiOauth?.email;
    } catch { /* ignore */ }

    if (!email) {
      try {
        const accountRelPath = this.profile.slug ? `.claude-${this.profile.slug}/.claude.json` : ".claude.json";
        const accountCredentials = await shell.readFile(distro, accountRelPath);
        const parsed = JSON.parse(accountCredentials) as { oauthAccount?: { emailAddress?: string } };
        email = parsed.oauthAccount?.emailAddress;
      } catch { /* ignore */ }
    }

    if (!token) throw new Error("Claude Code credentials were not found in WSL.");

    const data = await this.requestUsage(token);

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: email ?? null,
      windows: [
        { title: "Current session", percent: Number(data.five_hour?.utilization ?? 0), resetDate: data.five_hour?.resets_at ?? null },
        { title: "All models", percent: Number(data.seven_day?.utilization ?? 0), resetDate: data.seven_day?.resets_at ?? null }
      ],
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }
}
