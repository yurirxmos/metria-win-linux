import { app } from "electron";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALL_PROVIDER_KINDS, DEFAULT_REFRESH_INTERVAL_SECONDS, DEFAULT_WIDGET_Y_OFFSET, isProviderKind, parseProviderId } from "../shared/types";
import type { AlertSettings, AppSettings, ProviderKind, ProviderSourceChoice } from "../shared/types";

export function isValidProviderId(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  if (isProviderKind(value)) return true;
  const parsed = parseProviderId(value);
  return isProviderKind(parsed.kind) && value.startsWith(`${parsed.kind}-`);
}

const defaults: AppSettings = {
  refreshIntervalSeconds: DEFAULT_REFRESH_INTERVAL_SECONDS,
  enabledProviders: [...ALL_PROVIDER_KINDS],
  widgetYOffset: DEFAULT_WIDGET_Y_OFFSET,
  widgetAlongEdgeOffset: 0,
  showWidget: true,
  showTray: true,
  showAccountLabels: true,
  widgetBehavior: "pinned",
  widgetPosition: "right",
  widgetSize: "medium",
  widgetOpacity: 1,
  widgetDisplayId: null,
  providerSource: {},
  hiddenUsageWindowTitles: {},
  alerts: { enabled: true, cautionThreshold: 40, warningThreshold: 65, criticalThreshold: 85, cautionColor: "#ffd60a", warningColor: "#ff9f0a", criticalColor: "#ff453a" }
};

export class SettingsStore {
  private readonly path = join(app.getPath("userData"), "settings.json");

  load(): AppSettings {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<AppSettings>;
      return {
        refreshIntervalSeconds: Number.isFinite(parsed.refreshIntervalSeconds) ? Math.max(60, Number(parsed.refreshIntervalSeconds)) : defaults.refreshIntervalSeconds,
        enabledProviders: Array.isArray(parsed.enabledProviders) ? parsed.enabledProviders.filter(isValidProviderId) : defaults.enabledProviders,
        widgetYOffset: Number.isFinite(parsed.widgetYOffset) && Number(parsed.widgetYOffset) >= 0 ? Number(parsed.widgetYOffset) : defaults.widgetYOffset,
        widgetAlongEdgeOffset: numberOr(parsed.widgetAlongEdgeOffset, defaults.widgetAlongEdgeOffset),
        showWidget: typeof parsed.showWidget === "boolean" ? parsed.showWidget : defaults.showWidget,
        showTray: typeof parsed.showTray === "boolean" ? parsed.showTray : defaults.showTray,
        showAccountLabels: typeof parsed.showAccountLabels === "boolean" ? parsed.showAccountLabels : defaults.showAccountLabels,
        widgetBehavior: parsed.widgetBehavior === "auto-hide" ? "auto-hide" : defaults.widgetBehavior,
        widgetPosition: ["top", "bottom", "left", "right"].includes(parsed.widgetPosition as string) ? parsed.widgetPosition as AppSettings["widgetPosition"] : defaults.widgetPosition,
        widgetSize: ["small", "medium", "large"].includes(parsed.widgetSize as string) ? parsed.widgetSize as AppSettings["widgetSize"] : defaults.widgetSize,
        widgetOpacity: Math.min(1, Math.max(0.35, numberOr(parsed.widgetOpacity, defaults.widgetOpacity))),
        widgetDisplayId: typeof parsed.widgetDisplayId === "string" ? parsed.widgetDisplayId : defaults.widgetDisplayId,
        providerSource: normalizeProviderSource(parsed.providerSource),
        hiddenUsageWindowTitles: normalizeHiddenWindows(parsed.hiddenUsageWindowTitles),
        alerts: normalizeAlerts(parsed.alerts)
      };
    } catch { return defaults; }
  }

  setWidgetYOffset(widgetYOffset: number): AppSettings { return this.save({ ...this.load(), widgetYOffset, widgetAlongEdgeOffset: widgetYOffset }); }

  setWidgetPreferences(preferences: Partial<Pick<AppSettings, "showWidget" | "showTray" | "showAccountLabels" | "widgetBehavior" | "widgetPosition" | "widgetSize" | "widgetOpacity" | "widgetDisplayId" | "alerts">>): AppSettings {
    const current = this.load();
    const next = { ...current, ...preferences };
    if (preferences.widgetPosition && preferences.widgetPosition !== current.widgetPosition) {
      next.widgetAlongEdgeOffset = 0;
      next.widgetYOffset = 0;
    }
    if (!next.showWidget && !next.showTray) next.showTray = true;
    return this.save(next);
  }

  setWindowVisible(kind: ProviderKind | string, title: string, visible: boolean): AppSettings {
    const current = this.load();
    const parsed = parseProviderId(kind);
    const knownTitles =
      parsed.kind === "OpenCode Go"
        ? ["Current session", "This week", "This month"]
        : parsed.kind === "Antigravity"
          ? ["5-hour Gemini", "Weekly Gemini", "5-hour other models", "Weekly other models"]
          : parsed.kind === "Cursor"
            ? ["Cursor models", "API usage", "This cycle"]
            : ["Current session", "All models"];
    if (!knownTitles.includes(title)) return current;
    const hidden = new Set(current.hiddenUsageWindowTitles[kind] ?? current.hiddenUsageWindowTitles[parsed.kind] ?? []);
    if (visible) hidden.delete(title);
    else if (hidden.size < knownTitles.length - 1) hidden.add(title);
    return this.save({ ...current, hiddenUsageWindowTitles: { ...current.hiddenUsageWindowTitles, [kind]: [...hidden] } });
  }

  setRefreshInterval(seconds: number): AppSettings {
    return this.save({ ...this.load(), refreshIntervalSeconds: Math.max(60, Math.round(seconds)) });
  }

  setProviderSource(kind: ProviderKind | string, source: ProviderSourceChoice): AppSettings {
    const current = this.load();
    return this.save({ ...current, providerSource: { ...current.providerSource, [kind]: source } });
  }

  private save(next: AppSettings): AppSettings {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(next, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, this.path);
    return this.load();
  }

  setProviderEnabled(kind: ProviderKind | string, enabled: boolean): AppSettings {
    const current = this.load();
    const enabledProviders = enabled
      ? [...new Set([...current.enabledProviders, kind])]
      : current.enabledProviders.length > 1 ? current.enabledProviders.filter((candidate) => candidate !== kind) : current.enabledProviders;
    const next = { ...current, enabledProviders };
    return this.save(next);
  }
}

export function normalizeProviderSource(value: unknown): Partial<Record<string, ProviderSourceChoice>> {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const normalized: Partial<Record<string, ProviderSourceChoice>> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!isValidProviderId(key)) continue;
    if (typeof entry !== "object" || entry === null) continue;
    const candidate = entry as Record<string, unknown>;
    if (candidate.location === "host") normalized[key] = { location: "host" };
    else if (candidate.location === "wsl" && typeof candidate.distro === "string" && candidate.distro.length > 0) {
      normalized[key] = { location: "wsl", distro: candidate.distro };
    }
  }
  return normalized;
}

function numberOr(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }

export function normalizeHiddenWindows(value: unknown): Partial<Record<string, string[]>> {
  if (typeof value !== "object" || value === null) return {};
  const source = value as Record<string, unknown>;
  const normalized: Partial<Record<string, string[]>> = {};
  for (const [key, list] of Object.entries(source)) {
    if (!isValidProviderId(key)) continue;
    if (Array.isArray(list)) {
      normalized[key] = list.filter((title): title is string => typeof title === "string");
    }
  }
  return normalized;
}

function normalizeAlerts(value: unknown): AlertSettings {
  if (typeof value !== "object" || value === null) return defaults.alerts;
  const candidate = value as Partial<AlertSettings>;
  const caution = Math.max(1, Math.min(98, Math.round(numberOr(candidate.cautionThreshold, defaults.alerts.cautionThreshold))));
  const warning = Math.max(caution + 1, Math.min(99, Math.round(numberOr(candidate.warningThreshold, defaults.alerts.warningThreshold))));
  const critical = Math.max(warning + 1, Math.min(100, Math.round(numberOr(candidate.criticalThreshold, defaults.alerts.criticalThreshold))));
  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : defaults.alerts.enabled,
    cautionThreshold: caution, warningThreshold: warning, criticalThreshold: critical,
    cautionColor: typeof candidate.cautionColor === "string" ? candidate.cautionColor : defaults.alerts.cautionColor,
    warningColor: typeof candidate.warningColor === "string" ? candidate.warningColor : defaults.alerts.warningColor,
    criticalColor: typeof candidate.criticalColor === "string" ? candidate.criticalColor : defaults.alerts.criticalColor
  };
}
