import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseProviderId } from "../shared/types";
import type { ProviderPaths } from "./provider-paths";
import type { ProviderSourceInfo, ProviderUsage } from "../shared/types";
import { resolveAgyExecutable } from "./providers/antigravity";
import { CursorStateStore, isJwtExpired } from "./providers/cursor";

export interface ReconnectResult {
  command: string;
  message: string;
}

export function buildReconnectCommand(
  rawId: string,
  platform: NodeJS.Platform = process.platform
): ReconnectResult {
  const parsed = parseProviderId(String(rawId));
  let command = "";
  let message = "";

  if (parsed.kind === "Claude") {
    if (parsed.slug) {
      command = platform === "win32"
        ? `$env:CLAUDE_CONFIG_DIR="$HOME\\.claude-${parsed.slug}"; claude auth login`
        : `CLAUDE_CONFIG_DIR=~/.claude-${parsed.slug} claude auth login`;
    } else {
      command = "claude auth login";
    }
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Codex") {
    command = "codex login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "OpenCode Go") {
    command = "opencode auth login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Antigravity") {
    command = "agy auth login";
    message = `Run \`${command}\` in your terminal, then refresh Metria.`;
  } else if (parsed.kind === "Cursor") {
    command = "cursor";
    message = "Open Cursor and make sure you are signed in, then refresh Metria.";
  }

  return { command, message };
}

export function checkAgyVersionOrHelp(
  executable: string,
  spawnFn: typeof spawnSync = spawnSync
): { version?: string; help?: boolean; error?: string } {
  try {
    const isBatch = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const ver = spawnFn(executable, ["--version"], {
      timeout: 3000,
      encoding: "utf8",
      windowsHide: true,
      shell: isBatch
    });
    if (ver.error) {
      return { error: ver.error.message };
    }
    if (ver.status === 0 && ver.stdout?.trim()) {
      return { version: ver.stdout.trim() };
    }
    const help = spawnFn(executable, ["--help"], {
      timeout: 3000,
      encoding: "utf8",
      windowsHide: true,
      shell: isBatch
    });
    if (help.error) {
      return { error: help.error.message };
    }
    if (help.status === 0 && help.stdout?.trim()) {
      return { help: true };
    }
    return { error: `Exited with code ${ver.status ?? help.status ?? "unknown"}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface DiagnoseProviderOptions {
  providerId: string;
  sourceInfo?: ProviderSourceInfo;
  usage?: ProviderUsage;
  paths: ProviderPaths;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  checkVersion?: (executable: string) => { version?: string; help?: boolean; error?: string };
}

export function diagnoseProvider(options: DiagnoseProviderOptions): string {
  const parsed = parseProviderId(options.providerId);
  const info = options.sourceInfo;
  const usage = options.usage;
  const paths = options.paths;

  const lines: string[] = [
    info?.host ? "Host credentials detected." : "No host credentials detected.",
    info?.wsl && info.wsl.length > 0
      ? info.wsl.filter((entry) => entry.present).map((entry) => `WSL ${entry.distro} data detected.`).join(" ")
      : "",
    usage ? `${usage.windows.length} usage window(s) returned.` : "Metria has not received usage data yet.",
    usage?.updatedAt ? `Last update: ${new Date(usage.updatedAt).toLocaleString()}` : "",
    usage?.error ? `Latest issue: ${usage.error}` : ""
  ];

  if (parsed.slug) {
    lines.push(`Claude profile: ${parsed.slug}`);
  }

  if (parsed.kind === "Cursor") {
    const dbPath = paths.cursorStateDb;
    if (existsSync(dbPath)) {
      lines.push(`Cursor state database found: ${dbPath}`);
      const store = new CursorStateStore(dbPath);
      const token = store.readToken();
      if (token) {
        if (isJwtExpired(token)) {
          lines.push("Cursor token in state.vscdb is expired.");
        } else {
          lines.push("Cursor token detected in state.vscdb.");
        }
      } else {
        lines.push("No Cursor token found in state.vscdb.");
      }
    } else {
      lines.push(`Cursor state database not found: ${dbPath}`);
    }
  } else if (parsed.kind === "Antigravity") {
    const executable = resolveAgyExecutable(paths.antigravityBin, options.env, options.platform);
    if (executable) {
      lines.push(`Antigravity CLI (agy) resolved: ${executable}`);
      const verCheck = options.checkVersion ?? checkAgyVersionOrHelp;
      const res = verCheck(executable);
      if (res.version) {
        lines.push(`Antigravity CLI version: ${res.version}`);
      } else if (res.help) {
        lines.push("Antigravity CLI help accessible.");
      } else if (res.error) {
        lines.push(`Antigravity CLI check: ${res.error}`);
      }
    } else {
      lines.push("Antigravity CLI (agy) was not found in PATH or standard install locations.");
    }
  }

  return lines.filter(Boolean).join("\n");
}
