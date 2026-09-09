import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, shell, Tray } from "electron";
import { autoUpdater } from "electron-updater";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { ALL_PROVIDER_KINDS, CARD_WIDTH, isProviderKind, isValidProviderId, parseProviderId, PROVIDER_LOGOS, providerShortLabel, WIDGET_ITEM_GAP, WIDGET_ITEM_HEIGHT, WIDGET_PADDING, WIDGET_WIDTH } from "../shared/types";
import { ProviderService } from "./providers";
import { SettingsStore } from "./settings";
import { buildReconnectCommand, diagnoseProvider } from "./diagnostics";
import type { AppSettings, ProviderKind, ProviderSourceChoice, ProviderUsage } from "../shared/types";

let window: BrowserWindow | undefined;
let widgetWindow: BrowserWindow | undefined;
let cardWindow: BrowserWindow | undefined;
let cardActiveIndex: number | null = null;
let pendingCardHide: NodeJS.Timeout | undefined;
let tray: Tray | undefined;
let refreshTimer: NodeJS.Timeout | undefined;
let isQuitting = false;
let lastUsage: Awaited<ReturnType<ProviderService["fetch"]>> = [];
let badgeTrays = new Map<string, Tray>();
let updateState: "idle" | "downloaded" = "idle";
let updateTimer: NodeJS.Timeout | undefined;
let pendingOpenSettings = false;
const settings = new SettingsStore();
const providers = new ProviderService(() => settings.load());

function createWindow(): BrowserWindow {
  const next = new BrowserWindow({
    width: 760, height: 680, minWidth: 480, minHeight: 560, show: false, skipTaskbar: true,
    title: "Metria Electron",
    icon: findAsset("metria-mascot.png"),
    backgroundColor: "#0d1117",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true }
  });
  next.removeMenu();
  next.loadFile(join(__dirname, "../renderer/index.html"));
  next.webContents.once("did-finish-load", () => {
    if (!pendingOpenSettings) return;
    pendingOpenSettings = false;
    setTimeout(() => next.webContents.send("metria:open-settings"), 0);
  });
  if (process.env.METRIA_SMOKE === "1") next.webContents.once("did-finish-load", () => {
    void next.webContents.executeJavaScript("typeof window.metria === 'object' && typeof window.metria.getUsage === 'function'")
      .then((ready) => console.log(`METRIA_SMOKE_PRELOAD=${ready}`));
  });
  next.once("ready-to-show", () => next.show());
  next.on("close", (event) => { if (!isQuitting) { event.preventDefault(); next.hide(); } });
  next.on("minimize", () => next.hide());
  return next;
}

function showDashboard(): void { if (!window) window = createWindow(); window.show(); window.focus(); }
function showDashboardSettings(): void {
  pendingOpenSettings = true;
  showDashboard();
  if (window && !window.webContents.isLoading()) {
    pendingOpenSettings = false;
    window.webContents.send("metria:open-settings");
  }
}

/** Opaque compact widget that stays visible on Windows and Linux. Linux needs
 * it because the system tray is unavailable to some GUI environments; Windows
 * uses it as the primary provider surface instead of separate tray badges. */
function supportsWidget(): boolean { return process.platform === "win32" || process.platform === "linux"; }
function display(): Electron.Display {
  const selected = settings.load().widgetDisplayId;
  return screen.getAllDisplays().find((candidate) => String(candidate.id) === selected) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}
function displayArea(): Electron.Rectangle {
  return display().workArea;
}

function roundedRows(x: number, y: number, width: number, height: number, radius: number): Electron.Rectangle[] {
  const rows: Electron.Rectangle[] = [];
  const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
  for (let row = 0; row < height; row += 1) {
    const distance = row < r ? r - row - 0.5 : row >= height - r ? row - (height - r) + 0.5 : 0;
    const inset = distance > 0 ? Math.ceil(r - Math.sqrt(Math.max(0, r * r - distance * distance))) : 0;
    rows.push({ x: x + inset, y: y + row, width: Math.max(1, width - inset * 2), height: 1 });
  }
  return rows;
}

function widgetShape(bounds: Electron.Rectangle, position: AppSettings["widgetPosition"]): Electron.Rectangle[] {
  const radius = Math.min(40, Math.floor((position === "left" || position === "right" ? bounds.width : bounds.height) / 2));
  const rows: Electron.Rectangle[] = [];
  for (let y = 0; y < bounds.height; y += 1) {
    const roundedY = position === "top" ? y >= bounds.height - radius : position === "bottom" ? y < radius : true;
    const distance = y < radius ? radius - y - 0.5 : y >= bounds.height - radius ? y - (bounds.height - radius) + 0.5 : 0;
    const inset = roundedY && distance > 0 ? Math.ceil(radius - Math.sqrt(Math.max(0, radius * radius - distance * distance))) : 0;
    const leftInset = position === "right" || position === "top" || position === "bottom" ? inset : 0;
    const rightInset = position === "left" || position === "top" || position === "bottom" ? inset : 0;
    rows.push({ x: leftInset, y, width: Math.max(1, bounds.width - leftInset - rightInset), height: 1 });
  }
  return rows;
}

function cardShape(width: number, height: number, position: AppSettings["widgetPosition"]): Electron.Rectangle[] {
  const pointerWidth = 16;
  const pointerHeight = 34;
  const horizontal = position === "left" || position === "right";
  const bodyX = position === "left" ? pointerWidth : horizontal ? 0 : 8;
  const bodyY = position === "top" ? pointerWidth : 0;
  const bodyWidth = horizontal ? width - pointerWidth : width - 16;
  const bodyHeight = horizontal ? height : height - pointerWidth;
  const shape = roundedRows(bodyX, bodyY, bodyWidth, bodyHeight, 24);

  for (let step = 0; step < pointerHeight; step += 1) {
    const distance = Math.abs(step - (pointerHeight - 1) / 2);
    const extent = Math.max(1, Math.round(pointerWidth * (1 - distance / (pointerHeight / 2))));
    if (position === "right") shape.push({ x: bodyX + bodyWidth, y: Math.floor((height - pointerHeight) / 2) + step, width: extent, height: 1 });
    else if (position === "left") shape.push({ x: pointerWidth - extent, y: Math.floor((height - pointerHeight) / 2) + step, width: extent, height: 1 });
  }
  if (!horizontal) {
    for (let step = 0; step < pointerWidth; step += 1) {
      const halfWidth = Math.max(1, Math.round((pointerHeight / 2) * (position === "top" ? (step + 1) / pointerWidth : (pointerWidth - step) / pointerWidth)));
      shape.push({ x: Math.floor(width / 2) - halfWidth, y: position === "top" ? step : bodyHeight + step, width: halfWidth * 2, height: 1 });
    }
  }
  return shape;
}

function widgetBounds(area: Electron.Rectangle, providerCount: number): Electron.Rectangle {
  const current = settings.load();
  const scale = current.widgetSize === "small" ? 0.85 : current.widgetSize === "large" ? 1.15 : 1;
  const thickness = Math.round(WIDGET_WIDTH * scale);
  const extent = Math.max(80, Math.round(providerCount * WIDGET_ITEM_HEIGHT * scale + Math.max(0, providerCount - 1) * WIDGET_ITEM_GAP * scale + WIDGET_PADDING * 2 * scale));
  const vertical = current.widgetPosition === "left" || current.widgetPosition === "right";
  const width = vertical ? thickness : extent;
  const height = vertical ? extent : thickness;
  const offset = current.widgetAlongEdgeOffset || current.widgetYOffset;
  const along = vertical ? Math.min(Math.max(area.y + offset, area.y), Math.max(area.y, area.y + area.height - height)) : Math.min(Math.max(area.x + offset, area.x), Math.max(area.x, area.x + area.width - width));
  const x = current.widgetPosition === "left" ? area.x : current.widgetPosition === "right" ? area.x + area.width - width : along;
  const y = current.widgetPosition === "top" ? area.y : current.widgetPosition === "bottom" ? area.y + area.height - height : along;
  return { x, y, width, height };
}
function createWidgetWindow(): BrowserWindow {
  const initial = widgetBounds(displayArea(), 0);
  const widget = new BrowserWindow({
    x: initial.x, y: initial.y, width: initial.width, height: initial.height, frame: false, resizable: false, movable: false,
    backgroundColor: "#00000000", transparent: true, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, type: "notification", title: "Metria usage widget",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  widget.loadFile(join(__dirname, "../renderer/widget.html"));
  // Same re-assert on mapping as the card: compositors may override pre-show bounds.
  widget.on("show", () => { widget.setAlwaysOnTop(true, "floating"); widget.moveTop(); updateWidgetBounds(lastUsage); });
  widget.on("blur", () => { widget.setAlwaysOnTop(true, "floating"); widget.moveTop(); });
  widget.on("closed", () => { widgetWindow = undefined; hideCard(); });
  widget.setAlwaysOnTop(true, "floating");
  widget.setHasShadow(false);
  return widget;
}
function updateWidgetBounds(values: typeof lastUsage): void {
  if (!widgetWindow) return;
  const count = visibleProviders(values).length;
  const bounds = widgetBounds(displayArea(), count);
  widgetWindow.setBounds(bounds);
  widgetWindow.setShape(widgetShape(bounds, settings.load().widgetPosition));
  if (cardActiveIndex !== null) positionCard(cardActiveIndex);
}

/** Hover card shown to the left of the widget while pointing at a provider. */
const CARD_SPACING = 12;

export function visibleProviders(
  providers: typeof lastUsage = lastUsage,
  enabled: string[] = settings.load().enabledProviders
): typeof lastUsage {
  return providers.filter(
    (provider) =>
      enabled.includes(provider.id) ||
      (provider.id === provider.kind && enabled.includes(provider.kind))
  );
}

function createCardWindow(): BrowserWindow {
  const initial = cardBounds(cardActiveIndex ?? 0);
  const card = new BrowserWindow({
    x: initial.x, y: initial.y, width: initial.width, height: initial.height,
    frame: false, transparent: true, resizable: false, movable: false,
    skipTaskbar: true, alwaysOnTop: true, hasShadow: false, type: "notification", show: false, title: "Metria usage card",
    webPreferences: { preload: join(__dirname, "../preload/index.js"), contextIsolation: true, sandbox: true, nodeIntegration: false }
  });
  card.loadFile(join(__dirname, "../renderer/card.html"));
  // The card may be shown again before it finishes loading; deliver the payload on load.
  card.webContents.on("did-finish-load", () => refreshCard());
  // Frameless/transparent windows can be centered by some Linux compositors
  // when first mapped, overriding the pre-show bounds; re-assert after mapping.
  card.on("show", () => { if (cardActiveIndex !== null) positionCard(cardActiveIndex); });
  card.on("closed", () => { cardWindow = undefined; });
  return card;
}

function showCard(index: number): void {
  clearTimeout(pendingCardHide);
  const provider = visibleProviders()[index];
  if (!provider) return;
  // Already visible: keep-alive signals must not re-show, but the card may be
  // stale if the widget moved under the cursor (e.g. after a drag), so re-assert.
  if (cardWindow?.isVisible() && cardActiveIndex === index) { positionCard(index); return; }
  const changed = cardActiveIndex !== index || !cardWindow;
  cardActiveIndex = index;
  if (!cardWindow) cardWindow = createCardWindow();
  if (changed) cardWindow.webContents.send("metria:card-show", { index, kind: provider.kind });
  positionCard(index);
  cardWindow.showInactive();
}

function hideCard(): void {
  cardActiveIndex = null;
  cardWindow?.webContents.send("metria:card-hide");
  cardWindow?.hide();
}

function scheduleCardHide(): void {
  clearTimeout(pendingCardHide);
  pendingCardHide = setTimeout(hideCard, 200);
}

function refreshCard(): void {
  if (cardActiveIndex === null || !cardWindow) return;
  const provider = visibleProviders()[cardActiveIndex];
  if (!provider) { hideCard(); return; }
  cardWindow.webContents.send("metria:card-show", { index: cardActiveIndex, kind: provider.kind });
  positionCard(cardActiveIndex);
}

/** Card sits to the left of the widget, vertically centred on the hovered item.
 * If the widget is gone, anchor to the display's right edge so the card never
 * falls back to the centered default position of a fresh BrowserWindow. */
function cardBounds(index: number, height?: number): Electron.Rectangle {
  const area = widgetWindow?.getBounds();
  const workArea = displayArea();
  const cardHeight = height ?? 200;
  const current = settings.load();
  const vertical = current.widgetPosition === "left" || current.widgetPosition === "right";
  const itemOffset = WIDGET_PADDING + index * (WIDGET_ITEM_HEIGHT + WIDGET_ITEM_GAP) + WIDGET_ITEM_HEIGHT / 2;
  if (vertical) {
    const itemCenterY = (area ?? workArea).y + itemOffset;
    const minY = workArea.y + 8;
    const maxY = workArea.y + workArea.height - cardHeight - 8;
    const y = Math.min(Math.max(itemCenterY - cardHeight / 2, minY), Math.max(minY, maxY));
    const anchorX = area?.x ?? (current.widgetPosition === "right" ? workArea.x + workArea.width : workArea.x);
    const x = current.widgetPosition === "right" ? anchorX - CARD_SPACING - CARD_WIDTH : anchorX + (area?.width ?? 0) + CARD_SPACING;
    return { x, y, width: CARD_WIDTH, height: cardHeight };
  }
  const itemCenterX = (area ?? workArea).x + itemOffset;
  const minX = workArea.x + 8;
  const maxX = workArea.x + workArea.width - CARD_WIDTH - 8;
  const x = Math.min(Math.max(itemCenterX - CARD_WIDTH / 2, minX), Math.max(minX, maxX));
  const anchorY = area?.y ?? (current.widgetPosition === "bottom" ? workArea.y + workArea.height : workArea.y);
  const y = current.widgetPosition === "bottom" ? anchorY - CARD_SPACING - cardHeight : anchorY + (area?.height ?? 0) + CARD_SPACING;
  return { x, y, width: CARD_WIDTH, height: cardHeight };
}

function positionCard(index: number, height?: number): void {
  if (!cardWindow) return;
  const bounds = cardBounds(index, height ?? cardWindow.getBounds().height);
  cardWindow.setBounds(bounds, false);
  cardWindow.setShape(cardShape(bounds.width, bounds.height, settings.load().widgetPosition));
}

interface UsageRow { name: string; percent: number; reset: string; logo: string; }
function formatReset(resetDate: string | null): string {
  if (!resetDate) return "";
  const seconds = (new Date(resetDate).getTime() - Date.now()) / 1000;
  if (seconds > 0 && seconds < 86400) { const totalMinutes = Math.floor(seconds / 60); const hours = Math.floor(totalMinutes / 60); const minutes = totalMinutes % 60; return hours > 0 ? (minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`) : `${minutes} min`; }
  return new Date(resetDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
function findAsset(name: string): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "MetriaPWA", name)]
    : [join(app.getAppPath(), "resources", "assets", name)];
  return candidates.find((candidate) => existsSync(candidate));
}
const FALLBACK_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxOCIgaGVpZ2h0PSIxOCIgdmlld0JveD0iMCAwIDE4IDE4Ij48cmVjdCB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSI0IiBmaWxsPSIjMDAwIi8+PHBhdGggZD0iTTMgMTNoMlY5SDN6bTQgMGgyVjVIOXptNCAwaDJWN0gxMXptNCAwaDJWM0gxNXoiIGZpbGw9IiNmNGY2ZjgiLz48L3N2Zz4=";
function trayMenuIcon(name: string): Electron.NativeImage | undefined {
  const path = findAsset(name);
  return path ? nativeImage.createFromPath(path).resize({ width: 16, height: 16 }) : undefined;
}
function usageRows(providers: typeof lastUsage): UsageRow[] {
  return visibleProviders(providers).filter((provider) => provider.windows[0]).map((provider) => {
    const parsed = parseProviderId(provider.id || provider.kind);
    const name = parsed.slug ? `${providerShortLabel(provider.kind)} (${parsed.slug})` : providerShortLabel(provider.kind);
    return {
      name,
      percent: Math.round(Math.max(0, Math.min(100, provider.windows[0]!.percent))),
      reset: formatReset(provider.windows[0]!.resetDate),
      logo: PROVIDER_LOGOS[provider.kind]
    };
  });
}
function buildTrayMenu(rows: UsageRow[]): Menu {
  const template: Electron.MenuItemConstructorOptions[] = rows.length
    ? rows.map((row) => ({ label: `${row.name} — ${row.percent}%${row.reset ? ` · ${row.reset}` : ""}`, enabled: false, icon: trayMenuIcon(row.logo) }))
    : [{ label: "No usage data yet", enabled: false }];
  template.push({ type: "separator" });
  template.push({ label: "Open dashboard", click: showDashboard });
  template.push({ label: "Refresh", click: () => { void usage(); } });
  if (updateState === "downloaded") template.push({ label: "Restart & install update", click: () => { autoUpdater.quitAndInstall(); } });
  template.push({ label: "Check for updates…", click: () => { void autoUpdater.checkForUpdates().catch(() => undefined); } });
  template.push({ type: "separator" });
  template.push({ label: "Quit Metria Electron", click: () => { isQuitting = true; app.quit(); } });
  return Menu.buildFromTemplate(template);
}

/** Silent auto-update mirroring the native Sparkle flow: download in the
 * background and install on quit, exposed through the tray menu only. macOS
 * stays out because electron-updater needs a signed app there. */
function initAutoUpdater(): void {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.on("update-downloaded", () => { updateState = "downloaded"; updateTray(lastUsage); });
  autoUpdater.on("error", (error) => { console.error("Metria auto-update failed:", error.message); });
  const check = (): void => { void autoUpdater.checkForUpdates().catch(() => undefined); };
  setTimeout(check, 20_000);
  updateTimer = setInterval(check, 6 * 60 * 60 * 1000);
}
function restartRefreshTimer(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => { void usage(); }, settings.load().refreshIntervalSeconds * 1000);
}
function updateTray(providers: typeof lastUsage): void {
  if (!tray) return;
  const rows = usageRows(providers);
  const summary = rows.map((row) => `${row.name} ${row.percent}%`).join(" · ");
  const updated = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date());
  tray.setToolTip(summary ? `${summary} · Updated ${updated}` : `Metria Electron · Updated ${updated}`);
  tray.setContextMenu(buildTrayMenu(rows));
}

function broadcastSettings(): void {
  for (const target of [window, widgetWindow, cardWindow]) target?.webContents.send("metria:settings-changed");
}

function recreateWidget(): void {
  if (!settings.load().showWidget) {
    widgetWindow?.destroy();
    widgetWindow = undefined;
    hideCard();
    return;
  }
  widgetWindow?.destroy();
  widgetWindow = createWidgetWindow();
  updateWidgetBounds(lastUsage);
  widgetWindow.showInactive();
}

function updateTrayVisibility(): void {
  if (settings.load().showTray) {
    if (!tray) createTray();
  } else if (tray) {
    tray.destroy();
    tray = undefined;
  }
}

function showWidgetMenu(): void {
  if (!widgetWindow) return;
  Menu.buildFromTemplate([
    { label: "Open dashboard", click: showDashboard },
    { label: "Refresh", click: () => { void usage(); } },
    { label: "Settings", click: showDashboardSettings },
    { label: "Quit", click: quitApp }
  ]).popup({ window: widgetWindow });
}

function quitApp(): void {
  isQuitting = true;
  window?.destroy();
  widgetWindow?.destroy();
  cardWindow?.destroy();
  app.quit();
}

function createTray(): void {
  const assetIcon = findAsset("metria-mascot.png");
  const icon = assetIcon
    ? nativeImage.createFromPath(assetIcon).resize({ width: 16, height: 16 })
    : nativeImage.createFromDataURL(FALLBACK_ICON);
  tray = new Tray(icon);
  updateTray(lastUsage);
}

/**
 * Each enabled and available provider gets its own tray badge sitting next to
 * the Metria tray icon. The badge shows the provider logo and reports the
 * primary window percentage in its tooltip, then opens the dashboard on click.
 */
function badgeStatus(provider: ProviderUsage): { percent: number; reset: string } {
  const first = provider.windows[0];
  return { percent: Math.round(Math.max(0, Math.min(100, first?.percent ?? 0))), reset: formatReset(first?.resetDate ?? null) };
}
function badgeTemplate(): Electron.MenuItemConstructorOptions[] {
  return [
    { label: "Open dashboard", click: showDashboard },
    { label: "Refresh", click: () => { void usage(); } }
  ];
}
function updateBadges(providers: typeof lastUsage): void {
  const active = visibleProviders(providers).filter((provider) => provider.available);
  for (const [id, badge] of badgeTrays) {
    if (!active.some((provider) => (provider.id || provider.kind) === id)) {
      badge.destroy();
      badgeTrays.delete(id);
    }
  }
  for (const provider of active) {
    const id = provider.id || provider.kind;
    const { percent, reset } = badgeStatus(provider);
    const tooltip = `${parseProviderId(id).displayName} — ${percent}%${reset ? ` · ${reset}` : ""}`;
    const existing = badgeTrays.get(id);
    if (existing) {
      existing.setToolTip(tooltip);
      continue;
    }
    const icon = trayMenuIcon(PROVIDER_LOGOS[provider.kind]) ?? nativeImage.createFromDataURL(FALLBACK_ICON);
    const badge = new Tray(icon);
    badge.setToolTip(tooltip);
    badge.setContextMenu(Menu.buildFromTemplate(badgeTemplate()));
    badge.on("click", showDashboard);
    badgeTrays.set(id, badge);
  }
}

function validProviderSource(value: unknown): value is ProviderSourceChoice {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  if (source.location === "host") return true;
  return source.location === "wsl" && typeof source.distro === "string" && source.distro.length > 0;
}
function trustedWindow(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url;
  if (!url) return false;
  const owners = [window?.webContents, widgetWindow?.webContents, cardWindow?.webContents];
  return owners.some((owner) => !!owner && event.sender === owner && url === owner.mainFrame.url);
}
function requireTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (!trustedWindow(event)) throw new Error("Untrusted IPC sender.");
}
// The dashboard must show every provider (enabled or not) so users can re-enable
// from there; taps, badges, and the widget keep filtering by enabledProviders.
async function usage() {
  const targets = providers.getProviders().map((p) => p.id);
  const values = (await providers.fetch(targets)).map((value) => {
    const cached = lastUsage.find((entry) => entry.id === value.id) ?? (value.id === value.kind ? lastUsage.find((entry) => entry.kind === value.kind) : undefined);
    return value.error && cached?.windows.length ? { ...value, accountLabel: value.accountLabel ?? cached.accountLabel, windows: cached.windows, updatedAt: cached.updatedAt } : value;
  });
  lastUsage = values;
  const fresh = values.filter((value) => value.windows.length && !value.error);
  if (fresh.length) saveCachedUsage(values);
  for (const target of [window, widgetWindow, cardWindow]) target?.webContents.send("metria:usage-updated");
  updateTray(values); if (supportsWidget()) { updateWidgetBounds(values); refreshCard(); } else updateBadges(values); return values;
}
function cachePath(): string { return join(app.getPath("userData"), "usage-cache.json"); }
function loadCachedUsage(): ProviderUsage[] {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as unknown;
    return Array.isArray(parsed)
      ? parsed
          .filter(
            (value): value is ProviderUsage =>
              typeof value === "object" &&
              value !== null &&
              isProviderKind((value as ProviderUsage).kind) &&
              Array.isArray((value as ProviderUsage).windows)
          )
          .map((value) => ({
            ...value,
            id: (value as any).id || (value as ProviderUsage).kind,
            error: null,
            available: true
          }))
      : [];
  } catch {
    return [];
  }
}
function saveCachedUsage(values: ProviderUsage[]): void {
  try {
    mkdirSync(join(app.getPath("userData")), { recursive: true });
    const cached = values
      .filter((value) => value.windows.length)
      .map((value) => ({
        id: value.id || value.kind,
        kind: value.kind,
        accountLabel: value.accountLabel,
        windows: value.windows,
        updatedAt: value.updatedAt
      }));
    const temporary = `${cachePath()}.tmp`;
    writeFileSync(temporary, JSON.stringify(cached, null, 2), { mode: 0o600 });
    renameSync(temporary, cachePath());
  } catch { /* Cache is an enhancement; usage must continue without it. */ }
}
function loginItemStatus(): { available: boolean; enabled: boolean; message: string } {
  if (process.platform === "linux") { const path = linuxAutostartPath(); return { available: true, enabled: existsSync(path), message: existsSync(path) ? "Metria Electron starts through your desktop autostart entry." : "Metria Electron does not start automatically." }; }
  const enabled = app.getLoginItemSettings().openAtLogin;
  return { available: true, enabled, message: enabled ? "Metria Electron starts when you sign in." : "Metria Electron does not start automatically." };
}
function linuxAutostartPath(): string { return join(process.env.XDG_CONFIG_HOME || join(app.getPath("home"), ".config"), "autostart", "metria-electron.desktop"); }
function setLinuxAutostart(enabled: boolean): void {
  const path = linuxAutostartPath();
  const legacyPath = join(process.env.XDG_CONFIG_HOME || join(app.getPath("home"), ".config"), "autostart", "metria-desktop.desktop");
  if (!enabled) { try { unlinkSync(path); } catch { /* Not enabled. */ } return; }
  try { if (legacyPath !== path) unlinkSync(legacyPath); } catch { /* No legacy entry. */ }
  const executable = process.execPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
  const content = `[Desktop Entry]\nType=Application\nName=Metria Electron\nComment=AI coding assistant usage\nExec="${executable}"\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`;
  mkdirSync(join(path, ".."), { recursive: true });
  const temporary = `${path}.tmp`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, path);
}

app.setName("Metria Electron");
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => { showDashboard(); });
}
const isWslg = process.platform === "linux"
  && Boolean(process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME)
  && Boolean(process.env.WAYLAND_DISPLAY || process.env.WSL2_GUI_APPS_ENABLED);
if (process.platform === "linux" && !isWslg) {
  // Reduced-compositing Linux environments can crash the GPU process. WSLg is
  // excluded because software compositing breaks transparent window alpha there.
  app.disableHardwareAcceleration();
}
if (hasSingleInstanceLock) app.whenReady().then(() => {
  lastUsage = loadCachedUsage();
  if (settings.load().showTray) createTray(); initAutoUpdater();
  if (supportsWidget() && settings.load().showWidget) {
    widgetWindow = createWidgetWindow();
    widgetWindow.setBounds(widgetBounds(displayArea(), 0));
    widgetWindow.showInactive();
  }
  void usage();
  ipcMain.handle("metria:get-usage", (event) => { requireTrustedSender(event); return lastUsage.length ? lastUsage : usage(); });
  ipcMain.handle("metria:open-dashboard", (event) => { requireTrustedSender(event); showDashboard(); });
  ipcMain.handle("metria:widget-context-menu", (event) => { requireTrustedSender(event); showWidgetMenu(); });
  ipcMain.handle("metria:provider-hover", (event, index: unknown) => {
    requireTrustedSender(event);
    if (index === null) { scheduleCardHide(); return; }
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= visibleProviders().length) throw new Error("Invalid provider index.");
    showCard(index);
  });
  ipcMain.handle("metria:card-resize", (event, height: unknown) => {
    requireTrustedSender(event);
    if (typeof height !== "number" || !Number.isFinite(height)) throw new Error("Invalid card height.");
    if (cardActiveIndex !== null) positionCard(cardActiveIndex, height);
  });
  ipcMain.handle("metria:refresh", (event) => { requireTrustedSender(event); return usage(); });
  ipcMain.handle("metria:get-settings", (event) => { requireTrustedSender(event); return settings.load(); });
  ipcMain.handle("metria:set-provider-enabled", (event, kind: unknown, enabled: unknown) => {
    requireTrustedSender(event); if (!isValidProviderId(kind) || typeof enabled !== "boolean") throw new Error("Invalid provider setting.");
    const next = settings.setProviderEnabled(kind, enabled);
    // The widget (notch) keeps its own settings snapshot; refresh it and the bounds now.
    updateWidgetBounds(lastUsage);
    broadcastSettings();
    return next;
  });
  ipcMain.handle("metria:reconnect", async (event, rawId: unknown) => {
    requireTrustedSender(event);
    if (!isValidProviderId(rawId)) throw new Error("Invalid provider.");
    const { command, message } = buildReconnectCommand(String(rawId));
    await shell.openPath(app.getPath("home"));
    return { command, message };
  });
  ipcMain.handle("metria:set-widget-y-offset", (event, offsetY: unknown) => {
    requireTrustedSender(event);
    if (typeof offsetY !== "number" || !Number.isFinite(offsetY)) throw new Error("Invalid widget offset.");
    // Persist the clamped value (like the native app derives its stored offset
    // from the clamped frame), so drags always restart from a valid position
    // and never accumulate an offset outside the work area.
    const area = displayArea();
    const height = widgetWindow?.getBounds().height ?? 120;
    const vertical = settings.load().widgetPosition === "left" || settings.load().widgetPosition === "right";
    const extent = vertical ? height : (widgetWindow?.getBounds().width ?? 120);
    const limit = vertical ? area.height - extent : area.width - extent;
    const clamped = Math.max(0, Math.min(Math.round(offsetY), Math.max(0, limit)));
    const next = settings.setWidgetYOffset(clamped);
    updateWidgetBounds(lastUsage); refreshCard();
    return next;
  });
  ipcMain.handle("metria:set-widget-preferences", (event, preferences: unknown) => {
    requireTrustedSender(event);
    if (typeof preferences !== "object" || preferences === null) throw new Error("Invalid widget preferences.");
    const next = settings.setWidgetPreferences(preferences as Partial<Pick<AppSettings, "showWidget" | "showTray" | "showAccountLabels" | "widgetBehavior" | "widgetPosition" | "widgetSize" | "widgetOpacity" | "widgetDisplayId" | "alerts">>);
    recreateWidget();
    updateTrayVisibility();
    broadcastSettings();
    return next;
  });
  ipcMain.handle("metria:set-window-visible", (event, kind: unknown, title: unknown, visible: unknown) => {
    requireTrustedSender(event);
    if (!isValidProviderId(kind) || typeof title !== "string" || !title || typeof visible !== "boolean") throw new Error("Invalid usage window setting.");
    const next = settings.setWindowVisible(kind, title, visible);
    broadcastSettings();
    return next;
  });
  ipcMain.handle("metria:diagnose", async (event, rawId: unknown) => {
    requireTrustedSender(event);
    if (!isValidProviderId(rawId)) throw new Error("Invalid provider.");
    const parsed = parseProviderId(String(rawId));
    const info = (await providers.sources([parsed.id]))[0];
    const usage = lastUsage.find((entry) => entry.id === parsed.id) ?? (parsed.id === parsed.kind ? lastUsage.find((entry) => entry.kind === parsed.kind) : undefined);
    return diagnoseProvider({
      providerId: parsed.id,
      sourceInfo: info,
      usage,
      paths: providers.paths
    });
  });
  ipcMain.handle("metria:get-login-item-status", (event) => { requireTrustedSender(event); return loginItemStatus(); });
  ipcMain.handle("metria:app-info", (event) => {
    requireTrustedSender(event);
    return { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged, dataPath: app.getPath("userData") };
  });
  ipcMain.handle("metria:get-displays", (event) => {
    requireTrustedSender(event);
    return screen.getAllDisplays().map((item) => ({ id: String(item.id), label: `${item.label || "Display"} (${item.bounds.width}x${item.bounds.height})` }));
  });
  ipcMain.handle("metria:check-updates", async (event) => {
    requireTrustedSender(event);
    if (!app.isPackaged) return { status: "unavailable", message: "Automatic updates are only available in packaged builds." };
    try {
      await autoUpdater.checkForUpdates();
      if (updateState === "downloaded") return { status: "downloaded", message: "An update was downloaded and will install on quit." };
      return { status: "up-to-date", message: "Metria Electron is up to date." };
    } catch (error) {
      return { status: "error", message: `Update check failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  });
  ipcMain.handle("metria:install-update", (event) => {
    requireTrustedSender(event);
    if (updateState !== "downloaded") throw new Error("No downloaded update.");
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });
  ipcMain.handle("metria:uninstall", (event) => {
    requireTrustedSender(event);
    if (process.platform === "win32") {
      const uninstaller = join(dirname(process.execPath), "Uninstall Metria Electron.exe");
      if (!existsSync(uninstaller)) return { opened: false, message: "The uninstaller was not found next to the app. You can uninstall Metria Electron from the Windows Settings app." };
      void shell.openPath(uninstaller);
      return { opened: true, message: "The uninstaller is starting." };
    }
    if (process.platform === "linux") {
      shell.showItemInFolder(process.execPath);
      return { opened: true, message: "To uninstall, delete the Metria Electron file and its autostart entry." };
    }
    return { opened: false, message: "Uninstall is only available on Windows and Linux." };
  });
  ipcMain.handle("metria:quit", (event) => { requireTrustedSender(event); quitApp(); });
  ipcMain.handle("metria:set-launch-at-login", (event, enabled: unknown) => {
    requireTrustedSender(event);
    if (typeof enabled !== "boolean") throw new Error("Invalid launch-at-login setting.");
    if (process.platform === "linux") setLinuxAutostart(enabled);
    else app.setLoginItemSettings({ openAtLogin: enabled });
    return loginItemStatus();
  });
  ipcMain.handle("metria:set-refresh-interval", (event, seconds: unknown) => {
    requireTrustedSender(event);
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 60) throw new Error("Invalid refresh interval.");
    const next = settings.setRefreshInterval(seconds);
    restartRefreshTimer();
    return next;
  });
  ipcMain.handle("metria:get-provider-sources", (event) => {
    requireTrustedSender(event);
    return providers.sources(providers.getProviders().map((p) => p.id));
  });
  ipcMain.handle("metria:set-provider-source", (event, kind: unknown, source: unknown) => {
    requireTrustedSender(event);
    if (!isValidProviderId(kind) || !validProviderSource(source)) throw new Error("Invalid provider source.");
    const next = settings.setProviderSource(kind, source);
    updateWidgetBounds(lastUsage);
    widgetWindow?.webContents.send("metria:settings-changed");
    void usage();
    return next;
  });
  restartRefreshTimer();
});
app.on("window-all-closed", () => { /* Metria remains available through the tray. */ });
app.on("before-quit", () => { isQuitting = true; if (refreshTimer) clearInterval(refreshTimer); if (updateTimer) clearInterval(updateTimer); });
