import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ProviderKind, ProviderUsage, UsageWindow } from "../../shared/types";
import type { ProviderPaths } from "../provider-paths";
import type { WslShell } from "../wsl";

export class CursorStateStore {
  constructor(public readonly databasePath: string) {}

  readToken(): string | null {
    if (!existsSync(this.databasePath)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(this.databasePath, { readOnly: true, open: true });
      const stmt = db.prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1");
      const row = stmt.get("cursorAuth/accessToken") as { value?: string } | undefined;
      return typeof row?.value === "string" ? row.value : null;
    } catch {
      return null;
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export function isJwtExpired(token: string): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    if (!payload.exp) return false;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}

interface CursorApiResponse {
  planUsage?: {
    autoPercentUsed?: number;
    apiPercentUsed?: number;
    totalPercentUsed?: number;
    includedSpend?: number;
    limit?: number;
  };
  spendLimitUsage?: {
    individualUsed?: number;
    individualLimit?: number;
    overallUsed?: number;
    overallLimit?: number;
  };
  billingCycleEnd?: string;
}

export function parseCursorWindows(json: string): UsageWindow[] {
  try {
    const data = JSON.parse(json) as CursorApiResponse;
    let resetDate: string | null = null;
    if (data.billingCycleEnd) {
      try {
        const num = Number(data.billingCycleEnd);
        const d = !isNaN(num)
          ? new Date(num < 1e11 ? num * 1000 : num)
          : new Date(data.billingCycleEnd);
        resetDate = isNaN(d.getTime()) ? null : d.toISOString();
      } catch {
        resetDate = null;
      }
    }

    const windows: UsageWindow[] = [];
    if (data.planUsage?.autoPercentUsed !== undefined) {
      windows.push({
        title: "Cursor models",
        percent: Math.max(0, Math.min(100, Number(data.planUsage.autoPercentUsed))),
        resetDate
      });
    }
    if (data.planUsage?.apiPercentUsed !== undefined) {
      windows.push({
        title: "API usage",
        percent: Math.max(0, Math.min(100, Number(data.planUsage.apiPercentUsed))),
        resetDate
      });
    }

    if (windows.length > 0) return windows;

    // Fallback to pooled / spend limits
    const spent = (used?: number, limit?: number) => {
      if (used !== undefined && limit !== undefined && limit > 0) {
        return Math.max(0, Math.min(100, (used / limit) * 100));
      }
      return undefined;
    };

    const pooledPercent =
      spent(data.planUsage?.includedSpend, data.planUsage?.limit) ??
      spent(data.spendLimitUsage?.individualUsed, data.spendLimitUsage?.individualLimit) ??
      spent(data.spendLimitUsage?.overallUsed, data.spendLimitUsage?.overallLimit) ??
      data.planUsage?.totalPercentUsed;

    if (pooledPercent !== undefined) {
      return [
        {
          title: "This cycle",
          percent: Math.max(0, Math.min(100, Number(pooledPercent))),
          resetDate
        }
      ];
    }
    return [];
  } catch {
    return [];
  }
}

export class CursorProvider {
  readonly id = "Cursor";
  readonly kind: ProviderKind = "Cursor";
  readonly hint = "Sign in to Cursor to make usage available.";
  private readonly store: CursorStateStore;

  constructor(private readonly paths: ProviderPaths) {
    this.store = new CursorStateStore(paths.cursorStateDb);
  }

  hasHostCredentials(): boolean {
    return existsSync(this.paths.cursorStateDb) && this.store.readToken() !== null;
  }

  async fetchHost(): Promise<ProviderUsage> {
    const token = this.store.readToken();
    if (!token) throw new Error("Cursor credentials were not found.");
    if (isJwtExpired(token)) throw new Error("Sign in to Cursor again to refresh usage.");

    const res = await fetch(
      "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "User-Agent": "Metria-Electron/0.1"
        },
        body: JSON.stringify({ includePooledUsage: true })
      }
    );

    if (res.status === 401 || res.status === 403) {
      throw new Error("Sign in to Cursor again to refresh usage.");
    }
    if (!res.ok) {
      throw new Error(`The provider returned ${res.status}.`);
    }

    const text = await res.text();
    const windows = parseCursorWindows(text);
    return {
      id: this.id,
      kind: this.kind,
      accountLabel: null,
      windows,
      updatedAt: new Date().toISOString(),
      error: windows.length === 0 ? "No usage data returned." : null,
      available: true,
      setupHint: ""
    };
  }

  async fetchWsl(_shell: WslShell, _distro: string): Promise<ProviderUsage> {
    return this.fetchHost();
  }
}
