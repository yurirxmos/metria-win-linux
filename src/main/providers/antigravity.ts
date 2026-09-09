import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";

export function resolveAgyExecutable(
  configuredPath: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (configuredPath && existsSync(configuredPath)) return configuredPath;
  if (configuredPath && platform === "win32" && /\.cmd$/i.test(configuredPath)) {
    const exe = configuredPath.replace(/\.cmd$/i, ".exe");
    if (existsSync(exe)) return exe;
  }
  const rawPath = env.PATH ?? env.Path ?? "";
  const pathDirs = rawPath.split(delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, platform === "win32" ? "agy.cmd" : "agy");
    if (existsSync(candidate)) return candidate;
    if (platform === "win32") {
      const exeCandidate = join(dir, "agy.exe");
      if (existsSync(exeCandidate)) return exeCandidate;
    }
  }
  return null;
}

export function runAgyUsage(executable: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const isBatch = process.platform === "win32" && /\.(cmd|bat)$/i.test(executable);
    const child = spawn(executable, ["-p", "/usage"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      shell: isBatch
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    let completed = false;
    const timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        try { child.kill("SIGTERM"); } catch { /* ignore */ }
        reject(new Error("Antigravity CLI timed out."));
      }
    }, timeoutMs);

    child.on("error", (err) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on("close", (code) => {
      if (!completed) {
        completed = true;
        clearTimeout(timer);
        if (code === 0 && output.trim()) resolve(output);
        else reject(new Error(`agy exited with code ${code}`));
      }
    });
  });
}

type Family = "gemini" | "others";
type Horizon = "fiveHour" | "weekly";

export function parseAntigravityWindows(output: string): UsageWindow[] {
  const slots: { family: Family; horizon: Horizon; window: UsageWindow }[] = [];
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const parts = line.split("\t").map((p) => p.trim());
    if (parts.length < 4) continue;

    const family: Family = parts[0].toLowerCase().includes("gemini") ? "gemini" : "others";
    const windowPart = parts[1].toLowerCase();
    let horizon: Horizon;
    if (windowPart.includes("five hour") || windowPart.includes("5-hour") || windowPart.includes("5 hour")) {
      horizon = "fiveHour";
    } else if (windowPart.includes("week")) {
      horizon = "weekly";
    } else {
      continue;
    }

    const remaining = Number(parts[2].replace("%", "").trim());
    if (Number.isNaN(remaining)) continue;
    const percent = Math.max(0, Math.min(100, 100 - remaining));
    const title = titleFor(family, horizon);
    let resetDate: string | null = null;
    if (parts[3]) {
      try {
        const d = new Date(parts[3]);
        resetDate = Number.isNaN(d.getTime()) ? null : d.toISOString();
      } catch {
        resetDate = null;
      }
    }

    slots.push({ family, horizon, window: { title, percent, resetDate } });
  }

  const order: [Family, Horizon][] = [
    ["gemini", "fiveHour"],
    ["gemini", "weekly"],
    ["others", "fiveHour"],
    ["others", "weekly"]
  ];

  return order
    .map(([fam, hor]) => slots.find((s) => s.family === fam && s.horizon === hor)?.window)
    .filter((w): w is UsageWindow => Boolean(w));
}

function titleFor(family: Family, horizon: Horizon): string {
  if (family === "gemini") {
    return horizon === "fiveHour" ? "5-hour Gemini" : "Weekly Gemini";
  }
  return horizon === "fiveHour" ? "5-hour other models" : "Weekly other models";
}

export class AntigravityProvider {
  readonly id = "Antigravity";
  readonly kind: ProviderKind = "Antigravity";
  readonly hint = "Install Antigravity and sign in with `agy auth login` to make usage available.";

  constructor(private readonly paths: ProviderPaths) {}

  hasHostCredentials(): boolean {
    return resolveAgyExecutable(this.paths.antigravityBin) !== null;
  }

  async fetchHost(): Promise<ProviderUsage> {
    const executable = resolveAgyExecutable(this.paths.antigravityBin);
    if (!executable) throw new Error("Antigravity CLI (agy) was not found in PATH.");

    const raw = await runAgyUsage(executable);
    const windows = parseAntigravityWindows(raw);
    if (windows.length === 0) throw new Error("No usage data returned from Antigravity.");

    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(shell: WslShell, distro: string): Promise<ProviderUsage> {
    let output = "";
    try {
      output = await shell.readFile(distro, ".local/bin/agy");
    } catch {
      // ignore
    }
    const raw = (await (shell as any).execCommand?.(distro, "agy -p /usage </dev/null")) ?? output;
    const windows = parseAntigravityWindows(raw);
    if (windows.length === 0) throw new Error("No usage data returned from WSL Antigravity.");
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: null,
      available: true,
      setupHint: ""
    };
  }
}
