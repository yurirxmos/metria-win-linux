export type ProviderKind = "Claude" | "Codex" | "OpenCode Go" | "Cursor" | "Antigravity";

export interface UsageWindow {
  title: string;
  percent: number;
  resetDate: string | null;
}

export interface ProviderUsage {
  id: string;
  kind: ProviderKind;
  accountLabel: string | null;
  windows: UsageWindow[];
  updatedAt: string | null;
  error: string | null;
  available: boolean;
  setupHint: string;
}

export type WidgetPosition = "top" | "bottom" | "left" | "right";
export type WidgetSize = "small" | "medium" | "large";
export type WidgetBehavior = "pinned" | "auto-hide";

export interface AlertSettings {
  enabled: boolean;
  cautionThreshold: number;
  warningThreshold: number;
  criticalThreshold: number;
  cautionColor: string;
  warningColor: string;
  criticalColor: string;
}

export interface AppSettings {
  refreshIntervalSeconds: number;
  enabledProviders: ProviderKind[];
  widgetYOffset: number;
  widgetAlongEdgeOffset: number;
  showWidget: boolean;
  showTray: boolean;
  showAccountLabels: boolean;
  widgetBehavior: WidgetBehavior;
  widgetPosition: WidgetPosition;
  widgetSize: WidgetSize;
  widgetOpacity: number;
  widgetDisplayId: string | null;
  providerSource: Partial<Record<ProviderKind, ProviderSourceChoice>>;
  hiddenUsageWindowTitles: Partial<Record<ProviderKind, string[]>>;
  alerts: AlertSettings;
}

export interface CardShowPayload {
  index: number;
  kind: ProviderKind;
}

export interface MetriaApi {
  getUsage(): Promise<ProviderUsage[]>;
  refresh(): Promise<ProviderUsage[]>;
  getSettings(): Promise<AppSettings>;
  openDashboard(): Promise<void>;
  openWidgetMenu(): Promise<void>;
  setProviderHover(index: number | null): Promise<void>;
  resizeCard(height: number): Promise<void>;
  onSettingsChanged(callback: () => void): void;
  onUsageChanged(callback: () => void): void;
  onOpenSettings(callback: () => void): void;
  onCardShow(callback: (payload: CardShowPayload) => void): void;
  onCardHide(callback: () => void): void;
  setProviderEnabled(kind: ProviderKind, enabled: boolean): Promise<AppSettings>;
  reconnect(kind: ProviderKind): Promise<{ command: string; message: string }>;
  setWidgetYOffset(offsetY: number): Promise<AppSettings>;
  setWidgetPreferences(preferences: Partial<Pick<AppSettings, "showWidget" | "showTray" | "showAccountLabels" | "widgetBehavior" | "widgetPosition" | "widgetSize" | "widgetOpacity" | "widgetDisplayId" | "alerts">>): Promise<AppSettings>;
  setWindowVisible(kind: ProviderKind, title: string, visible: boolean): Promise<AppSettings>;
  diagnose(kind: ProviderKind): Promise<string>;
  getLoginItemStatus(): Promise<LoginItemStatus>;
  setLaunchAtLogin(enabled: boolean): Promise<LoginItemStatus>;
  getAppInfo(): Promise<AppInfo>;
  getDisplays(): Promise<DisplayInfo[]>;
  checkUpdates(): Promise<UpdateCheckResult>;
  installUpdate(): Promise<void>;
  uninstall(): Promise<UninstallResult>;
  quit(): Promise<void>;
  setRefreshInterval(seconds: number): Promise<AppSettings>;
  getProviderSources(): Promise<ProviderSourceInfo[]>;
  setProviderSource(kind: ProviderKind, source: ProviderSourceChoice): Promise<AppSettings>;
}

export interface DisplayInfo { id: string; label: string; }

export interface LoginItemStatus { available: boolean; enabled: boolean; message: string; }

export interface AppInfo {
  version: string;
  platform: string;
  packaged: boolean;
  dataPath: string;
}

export interface UpdateCheckResult {
  status: "up-to-date" | "downloaded" | "unavailable" | "error";
  message: string;
}

export interface UninstallResult {
  opened: boolean;
  message: string;
}

export interface ProviderSourceChoice {
  location: "host" | "wsl";
  distro?: string;
}

export interface WslPresence {
  distro: string;
  present: boolean;
}

export interface ProviderSourceInfo {
  kind: ProviderKind;
  host: boolean;
  wsl: WslPresence[];
  source: ProviderSourceChoice | null;
  needsChoice: boolean;
}

export interface ProviderID {
  kind: ProviderKind;
  slug?: string;
  id: string;
  displayName: string;
}

export const ALL_PROVIDER_KINDS: ProviderKind[] = [
  "Claude",
  "Codex",
  "OpenCode Go",
  "Cursor",
  "Antigravity"
];

export function isProviderKind(value: unknown): value is ProviderKind {
  return (
    value === "Claude" ||
    value === "Codex" ||
    value === "OpenCode Go" ||
    value === "Cursor" ||
    value === "Antigravity"
  );
}

export const PROVIDER_LOGOS: Record<ProviderKind, string> = {
  "Claude": "claude-logo.png",
  "Codex": "codex-logo.png",
  "OpenCode Go": "opencode-logo.png",
  "Cursor": "cursor-logo.png",
  "Antigravity": "antigravity-logo.png"
};

export function parseProviderId(raw: string): ProviderID {
  for (const kind of ALL_PROVIDER_KINDS) {
    if (raw === kind) {
      return { kind, slug: undefined, id: kind, displayName: kind };
    }
    const prefix = `${kind}-`;
    if (raw.startsWith(prefix)) {
      const slug = raw.slice(prefix.length);
      return {
        kind,
        slug,
        id: raw,
        displayName: `${kind} (${slug})`
      };
    }
  }
  return { kind: "Claude", slug: undefined, id: raw, displayName: raw };
}

export function providerShortLabel(kind: ProviderKind): string {
  return kind === "OpenCode Go" ? "Go" : kind;
}

export function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function gaugeColor(percent: number): string {
  return percent >= 85 ? "#ff453a" : percent >= 65 ? "#ff9f0a" : percent >= 40 ? "#ffd60a" : "#30d158";
}

export function statusDotColor(hasError: boolean): string {
  return hasError ? "#ff9f0a" : "#30d158";
}

// Keep the compact rail dimensions aligned with the native notch.
export const WIDGET_WIDTH = 80;
export const WIDGET_ITEM_HEIGHT = 64;
export const WIDGET_ITEM_GAP = 10;
export const WIDGET_PADDING = 12;
export const CARD_WIDTH = 316;
export const DEFAULT_WIDGET_Y_OFFSET = 12;
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 300;
export const PRESENCE_CACHE_TTL_MS = 30_000;
