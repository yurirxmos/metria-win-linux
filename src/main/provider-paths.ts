import { join } from "node:path";

export interface PathEnvironment { platform: NodeJS.Platform; home: string; env: NodeJS.ProcessEnv; }

export interface ProviderPaths {
  codexAuth: string;
  codexSessions: string;
  openCodeAuth: string;
  claudeCredentials: string;
  cursorStateDb: string;
  antigravityBin: string;
}

/** Vendor-owned roots only; environment overrides take precedence so portable installs stay opt-in. */
export function providerPaths(context: PathEnvironment): ProviderPaths {
  const codexRoot = context.env.CODEX_HOME || join(context.home, ".codex");
  const dataRoot = context.platform === "win32"
    ? (context.env.APPDATA || join(context.home, "AppData", "Roaming"))
    : (context.env.XDG_DATA_HOME || join(context.home, ".local", "share"));
  const configRoot = context.platform === "win32"
    ? (context.env.APPDATA || join(context.home, "AppData", "Roaming"))
    : (context.env.XDG_CONFIG_HOME || join(context.home, ".config"));

  return {
    codexAuth: join(codexRoot, "auth.json"),
    codexSessions: join(codexRoot, "sessions"),
    openCodeAuth: join(dataRoot, "opencode", "auth.json"),
    claudeCredentials: join(context.home, ".claude", ".credentials.json"),
    cursorStateDb: join(configRoot, "Cursor", "User", "globalStorage", "state.vscdb"),
    antigravityBin: context.platform === "win32"
      ? join(context.home, ".local", "bin", "agy.cmd")
      : join(context.home, ".local", "bin", "agy")
  };
}
