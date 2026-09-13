import { spawn } from "node:child_process";
import { PRESENCE_CACHE_TTL_MS } from "../shared/types";

export interface WslProviderPresence {
  codex: boolean;
  openCode: boolean;
  claude: boolean;
  antigravity: boolean;
}

const WSL_TIMEOUT_MS = 20_000;

export interface WslExec {
  (command: string, args: string[], options?: { encoding: "buffer"; input?: string; timeoutMs?: number }): Promise<{ stdout: string | Buffer }>;
}

export interface WslShell {
  distros(): Promise<string[]>;
  presence(distro: string): Promise<WslProviderPresence>;
  readFile(distro: string, homeRelativePath: string): Promise<string>;
  newestJsonl(distro: string, homeRelativeDir: string): Promise<string | undefined>;
  execCommand(distro: string, cmd: string, timeoutMs?: number): Promise<string>;
}

const PROBE_SCRIPT = [
  'for f in codex_auth:"$HOME/.codex/auth.json" codex_sessions:"$HOME/.codex/sessions" opencode:"$HOME/.local/share/opencode/auth.json" claude:"$HOME/.claude/.credentials.json" antigravity:"$HOME/.local/bin/agy"; do',
  '  name="${f%%:*}"; target="${f#*:}"',
  '  if [ -e "$target" ]; then echo "$name"; fi',
  "done",
  "true"
].join("\n");

export function makeWslShell(options: { platform?: NodeJS.Platform; exec?: WslExec; results?: Map<string, { at: number; presence: WslProviderPresence }> } = {}): WslShell {
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? wslExec;
  const results = options.results ?? new Map<string, { at: number; presence: WslProviderPresence }>();

  async function distros(): Promise<string[]> {
    if (platform !== "win32") return [];
    try {
      const stdout = await exec("wsl.exe", ["--list", "--quiet"], { encoding: "buffer" });
      return decodeWslOutput(stdout.stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  async function presence(distro: string): Promise<WslProviderPresence> {
    if (platform !== "win32") return { codex: false, openCode: false, claude: false, antigravity: false };
    const cached = results.get(distro);
    if (cached && Date.now() - cached.at < PRESENCE_CACHE_TTL_MS) return cached.presence;
    try {
      const stdout = await exec("wsl.exe", ["-d", distro, "sh"], { encoding: "buffer", input: PROBE_SCRIPT });
      const hits = decodeWslOutput(stdout.stdout).split(/\r?\n/).map((line) => line.trim());
      const presence: WslProviderPresence = {
        codex: hits.includes("codex_auth") || hits.includes("codex_sessions"),
        openCode: hits.includes("opencode"),
        claude: hits.includes("claude"),
        antigravity: hits.includes("antigravity")
      };
      results.set(distro, { at: Date.now(), presence });
      return presence;
    } catch {
      return { codex: false, openCode: false, claude: false, antigravity: false };
    }
  }

  async function readFile(distro: string, homeRelativePath: string): Promise<string> {
    const stdout = await exec("wsl.exe", ["-d", distro, "sh"], { encoding: "buffer", input: `cat "$HOME/${homeRelativePath}"\n` });
    return decodeWslOutput(stdout.stdout);
  }

  async function newestJsonl(distro: string, homeRelativeDir: string): Promise<string | undefined> {
    const script = [
      `candidate=$(find "$HOME/${homeRelativeDir}" -name '*.jsonl' -printf '%T@ %p\\n' 2>/dev/null | sort -rn | head -1)`,
      `if [ -n "$candidate" ]; then echo "$candidate" | sed "s|^[0-9.]* ||; s|^$HOME/||"; fi`,
      "true"
    ].join("\n");
    try {
      const stdout = await exec("wsl.exe", ["-d", distro, "sh"], { encoding: "buffer", input: script });
      return decodeWslOutput(stdout.stdout).trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async function execCommand(distro: string, cmd: string, timeoutMs?: number): Promise<string> {
    const stdout = await exec("wsl.exe", ["-d", distro, "sh", "-c", cmd], { encoding: "buffer", timeoutMs });
    return decodeWslOutput(stdout.stdout);
  }

  return { distros, presence, readFile, newestJsonl, execCommand };
}

/** wsl.exe prints UTF-16LE (without a BOM) when its stdout is piped, while
 * distro commands return plain UTF-8. Decode by checking the first bytes for
 * interleaved NULs instead of trusting the platform default. */
export function decodeWslOutput(output: string | Buffer): string {
  if (typeof output === "string") return output;
  const head = output.subarray(0, 8);
  const isUtf16 = output.length >= 4 && head[1] === 0 && head[3] === 0;
  return output.toString(isUtf16 ? "utf16le" : "utf8");
}

function wslExec(command: string, args: string[], options?: { encoding: "buffer"; input?: string; timeoutMs?: number }): Promise<{ stdout: string | Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    const timeout = setTimeout(() => { child.kill(); reject(new Error("WSL command timed out.")); }, options?.timeoutMs ?? WSL_TIMEOUT_MS);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout: Buffer.concat(stdout) });
      else reject(new Error(decodeWslOutput(Buffer.concat(stderr)).trim() || `wsl.exe exited with code ${code}`));
    });
    if (options?.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}
