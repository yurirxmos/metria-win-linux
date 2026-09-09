import { useEffect, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { clampPercent, DEFAULT_REFRESH_INTERVAL_SECONDS, gaugeColor, parseProviderId, PROVIDER_LOGOS, statusDotColor } from "../shared/types";
import type { AppSettings, ProviderKind, ProviderSourceChoice, ProviderUsage, UsageWindow } from "../shared/types";
import "./app.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });
const SOURCES_KEY = ["provider-sources"] as const;
const WINDOW_TITLES: Record<ProviderKind, string[]> = {
  Claude: ["Current session", "All models"],
  Codex: ["Current session", "All models"],
  "OpenCode Go": ["Current session", "This week", "This month"],
  Cursor: ["Cursor models", "API usage", "This cycle"],
  Antigravity: [
    "5-hour Gemini",
    "Weekly Gemini",
    "5-hour other models",
    "Weekly other models"
  ]
};

function useProviderSources() {
  return useQuery({ queryKey: SOURCES_KEY, queryFn: () => window.metria.getProviderSources() });
}
function parseSource(value: string): ProviderSourceChoice {
  return value === "host" ? { location: "host" } : { location: "wsl", distro: value.slice(4) };
}
function sourceValue(source: ProviderSourceChoice | null): string {
  return source?.location === "wsl" ? `wsl:${source.distro ?? ""}` : "host";
}

function percentage(value: number): string { return `${clampPercent(value).toFixed(0)}%`; }
function date(value: string | null): string { return value ? `Resets ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))}` : "No reset time available"; }

function usageColor(percent: number, alerts?: AppSettings["alerts"]): string {
  if (!alerts?.enabled) return gaugeColor(percent);
  if (percent >= alerts.criticalThreshold) return alerts.criticalColor;
  if (percent >= alerts.warningThreshold) return alerts.warningColor;
  if (percent >= alerts.cautionThreshold) return alerts.cautionColor;
  return gaugeColor(percent);
}

function UsageRow({ window: row, alerts }: { window: UsageWindow; alerts?: AppSettings["alerts"] }): JSX.Element {
  return (
    <div className="mt-[18px] first:mt-0">
      <div className="flex justify-between gap-4">
        <span>{row.title}</span>
        <strong className="font-mono text-lg">{percentage(row.percent)}</strong>
      </div>
      <div className="my-[9px] h-2 overflow-hidden rounded-[99px] bg-[#1c1c1e]">
       <i className="block h-full rounded-[99px]" style={{ background: usageColor(row.percent, alerts), width: percentage(row.percent) }} />
      </div>
      <small className="text-dim">{date(row.resetDate)}</small>
    </div>
  );
}

function ProviderCard({ provider, enabled, showAccount, hiddenWindows, alerts, onStatus }: { provider: ProviderUsage; enabled: boolean; showAccount: boolean; hiddenWindows: string[]; alerts?: AppSettings["alerts"]; onStatus: (message: string) => void }): JSX.Element {
  const parsed = parseProviderId(provider.id || provider.kind);
  const setEnabled = useMutation({
    mutationFn: (value: boolean) => window.metria.setProviderEnabled(provider.id || provider.kind, value),
    onSuccess: (settings) => {
      queryClient.setQueryData(["settings"], settings);
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    }
  });
  const setup = useMutation({
    mutationFn: () => window.metria.reconnect(provider.id || provider.kind),
    onSuccess: (result) => onStatus(result.message)
  });
  const pending = setEnabled.isPending || setup.isPending;
  const onClick = (): void => {
    if (!enabled) setEnabled.mutate(true);
    else if (provider.available) setEnabled.mutate(false);
    else setup.mutate();
  };
  return (
    <article className={`my-3.5 px-3 py-4 ${enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between gap-[18px]">
        <div className="flex items-center gap-2.5">
          <img className="h-[22px] w-[22px] object-contain" src={`./${PROVIDER_LOGOS[provider.kind]}`} alt="" />
           <h2 className="m-0 text-xl font-semibold">{parsed.displayName}</h2>
           {showAccount && provider.accountLabel && <span className="text-xs text-mute">{provider.accountLabel}</span>}
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: statusDotColor(provider.error !== null) }} />
        </div>
        <button
          type="button"
          className="cursor-pointer border border-line2 bg-transparent px-3 py-[7px] text-[#d8d8dc] disabled:opacity-55"
          onClick={onClick}
          disabled={pending}
        >
          {!enabled ? "Enable" : provider.available ? "Disable" : "Setup"}
        </button>
      </div>
      {!provider.available && <p className="m-0 mt-4 leading-relaxed text-dim">{provider.setupHint}</p>}
      {provider.error && <p className="m-0 mt-4 leading-relaxed text-dim">{provider.error}</p>}
       {provider.windows.filter((row) => !hiddenWindows.includes(row.title)).map((row) => <UsageRow key={row.title} window={row} alerts={alerts} />)}
       {provider.windows.length > 0 && provider.windows.every((row) => hiddenWindows.includes(row.title)) && <p className="mt-4 text-dim">All usage windows are hidden. Enable one in Settings.</p>}
    </article>
  );
}

function SourceChoiceModal(): JSX.Element {
  const sources = useProviderSources();
  const choice = useMutation({
    mutationFn: (variables: { kind: ProviderKind | string; source: ProviderSourceChoice }) => window.metria.setProviderSource(variables.kind, variables.source),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      void queryClient.invalidateQueries({ queryKey: SOURCES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    }
  });
  const pending = (sources.data ?? []).filter((info) => info.needsChoice);
  if (!pending.length) return <></>;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Provider data source" className="max-h-[85vh] w-[min(560px,100%)] overflow-y-auto bg-surface p-6 shadow-2xl">
        <h2 className="m-0 text-2xl font-semibold tracking-[-0.05em]">Where is your provider data?</h2>
        <p className="m-0 mt-3 leading-relaxed text-dim">Metria found the same provider here in Windows and inside WSL. Pick which data to track.</p>
        {pending.map((info) => {
          const infoId = info.id ?? info.kind;
          const parsed = parseProviderId(infoId);
          return (
            <section key={infoId} className="mt-6 border-t border-line pt-4">
              <h3 className="m-0 text-lg font-semibold">{parsed.displayName}</h3>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {info.host && (
                  <button type="button" className="cursor-pointer border border-line2 bg-transparent px-4 py-2 text-[#d8d8dc] disabled:opacity-55"
                    onClick={() => choice.mutate({ kind: infoId, source: { location: "host" } })} disabled={choice.isPending}>
                    Windows
                  </button>
                )}
                {info.wsl.filter((entry) => entry.present).map((entry) => (
                  <button key={entry.distro} type="button" className="cursor-pointer border border-line2 bg-transparent px-4 py-2 text-[#d8d8dc] disabled:opacity-55"
                    onClick={() => choice.mutate({ kind: infoId, source: { location: "wsl", distro: entry.distro } })} disabled={choice.isPending}>
                    WSL: {entry.distro}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const REFRESH_OPTIONS = [300, 600, 900, 1800];
const PLATFORM_LABEL: Record<string, string> = { win32: "Windows", linux: "Linux", darwin: "macOS" };

function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const [notice, setNotice] = useState("");
  const [updateStatus, setUpdateStatus] = useState<"idle" | "downloaded">("idle");
  const appInfo = useQuery({ queryKey: ["app-info"], queryFn: () => window.metria.getAppInfo() });
  const loginItem = useQuery({ queryKey: ["login-item"], queryFn: () => window.metria.getLoginItemStatus() });
  const checkUpdates = useMutation({
    mutationFn: () => window.metria.checkUpdates(),
    onSuccess: (result) => { setUpdateStatus(result.status === "downloaded" ? "downloaded" : "idle"); setNotice(result.message); }
  });
  const installUpdate = useMutation({
    mutationFn: () => window.metria.installUpdate(),
    onSuccess: () => setNotice("The update is installing…")
  });
  const setRefreshInterval = useMutation({
    mutationFn: (seconds: number) => window.metria.setRefreshInterval(seconds),
    onSuccess: (next) => queryClient.setQueryData(["settings"], next)
  });
  const setLoginItem = useMutation({
    mutationFn: (enabled: boolean) => window.metria.setLaunchAtLogin(enabled),
    onSuccess: (status) => { queryClient.setQueryData(["login-item"], status); setNotice(status.message); }
  });
  const uninstall = useMutation({
    mutationFn: () => window.metria.uninstall(),
    onSuccess: (result) => setNotice(result.message)
  });
  const quit = useMutation({ mutationFn: () => window.metria.quit() });
  const settingsData = useQuery({ queryKey: ["settings"], queryFn: () => window.metria.getSettings() }).data;
  const currentInterval = settingsData?.refreshIntervalSeconds ?? DEFAULT_REFRESH_INTERVAL_SECONDS;
  const usageData = useQuery({ queryKey: ["usage"], queryFn: () => window.metria.getUsage() }).data ?? [];
  const displays = useQuery({ queryKey: ["displays"], queryFn: () => window.metria.getDisplays() });
  const setPreferences = useMutation({
    mutationFn: (preferences: Partial<Pick<AppSettings, "showWidget" | "showTray" | "showAccountLabels" | "widgetBehavior" | "widgetPosition" | "widgetSize" | "widgetOpacity" | "widgetDisplayId" | "alerts">>) => window.metria.setWidgetPreferences(preferences),
    onSuccess: (next) => { queryClient.setQueryData(["settings"], next); void queryClient.invalidateQueries({ queryKey: ["usage"] }); }
  });
  const setWindowVisible = useMutation({
    mutationFn: (value: { kind: ProviderKind | string; title: string; visible: boolean }) => window.metria.setWindowVisible(value.kind, value.title, value.visible),
    onSuccess: (next) => queryClient.setQueryData(["settings"], next)
  });
  const diagnose = useMutation({ mutationFn: (kind: ProviderKind | string) => window.metria.diagnose(kind), onSuccess: (message) => setNotice(message) });
  const providerSources = useProviderSources();
  const setProviderSource = useMutation({
    mutationFn: (variables: { kind: ProviderKind | string; source: ProviderSourceChoice }) => window.metria.setProviderSource(variables.kind, variables.source),
    onSuccess: (next) => {
      queryClient.setQueryData(["settings"], next);
      void queryClient.invalidateQueries({ queryKey: SOURCES_KEY });
      void queryClient.invalidateQueries({ queryKey: ["usage"] });
    }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const intervalOptions = REFRESH_OPTIONS.includes(currentInterval) ? REFRESH_OPTIONS : [currentInterval, ...REFRESH_OPTIONS].sort((a, b) => a - b);
  const wslDetected = (providerSources.data ?? []).some((entry) => entry.wsl.length > 0);
  const sourceOptions = (providerSources.data ?? []).filter((entry) => entry.wsl.some((candidate) => candidate.present) || entry.source?.location === "wsl");
  const info = appInfo.data;
  const loginMessage = loginItem.data?.message;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Settings" className="max-h-[85vh] w-[min(600px,100%)] overflow-y-auto bg-surface p-6 shadow-2xl">
        <div className="flex items-center justify-between border-b border-line pb-4">
          <h2 className="m-0 text-2xl font-semibold tracking-[-0.05em]">Settings</h2>
          <button type="button" aria-label="Close settings" className="cursor-pointer border border-line2 bg-transparent px-3 py-1.5 text-dim hover:text-fg" onClick={onClose}>Close</button>
        </div>

        <section className="mt-5">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">App</h3>
          <dl className="mt-2 leading-relaxed">
            <div className="flex justify-between gap-4"><dt className="m-0 text-dim">Version</dt><dd className="m-0 font-mono">{info?.version ?? "…"}</dd></div>
            <div className="flex justify-between gap-4"><dt className="m-0 text-dim">Platform</dt><dd className="m-0">{info ? PLATFORM_LABEL[info.platform] ?? info.platform : "…"}</dd></div>
            {info && <div className="mt-2"><dt className="m-0 text-dim">Data folder</dt><dd className="m-0 mt-1 break-all font-mono text-xs text-mute">{info.dataPath}</dd></div>}
          </dl>
        </section>

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Display</h3>
          <div className="mt-3 grid gap-3">
            <label className="flex items-center justify-between gap-4 text-dim">Show usage widget <input type="checkbox" checked={settingsData?.showWidget ?? true} onChange={(event) => setPreferences.mutate({ showWidget: event.target.checked })} /></label>
            <label className="flex items-center justify-between gap-4 text-dim">Show in system tray <input type="checkbox" checked={settingsData?.showTray ?? true} onChange={(event) => setPreferences.mutate({ showTray: event.target.checked })} /></label>
            <label className="flex items-center justify-between gap-4 text-dim">Show provider account <input type="checkbox" checked={settingsData?.showAccountLabels ?? true} onChange={(event) => setPreferences.mutate({ showAccountLabels: event.target.checked })} /></label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="grid gap-1 text-dim">Behavior<select className="border border-line2 bg-surface px-2.5 py-1.5 text-fg" value={settingsData?.widgetBehavior ?? "pinned"} onChange={(event) => setPreferences.mutate({ widgetBehavior: event.target.value as AppSettings["widgetBehavior"] })}><option value="pinned">Pinned</option><option value="auto-hide">Auto-hide</option></select></label>
            <label className="grid gap-1 text-dim">Position<select className="border border-line2 bg-surface px-2.5 py-1.5 text-fg" value={settingsData?.widgetPosition ?? "right"} onChange={(event) => setPreferences.mutate({ widgetPosition: event.target.value as AppSettings["widgetPosition"] })}><option value="right">Right</option><option value="left">Left</option><option value="top">Top</option><option value="bottom">Bottom</option></select></label>
            <label className="grid gap-1 text-dim">Size<select className="border border-line2 bg-surface px-2.5 py-1.5 text-fg" value={settingsData?.widgetSize ?? "medium"} onChange={(event) => setPreferences.mutate({ widgetSize: event.target.value as AppSettings["widgetSize"] })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
            <label className="grid gap-1 text-dim">Monitor<select className="border border-line2 bg-surface px-2.5 py-1.5 text-fg" value={settingsData?.widgetDisplayId ?? ""} onChange={(event) => setPreferences.mutate({ widgetDisplayId: event.target.value || null })}><option value="">Active display</option>{(displays.data ?? []).map((display) => <option key={display.id} value={display.id}>{display.label}</option>)}</select></label>
          </div>
          <label className="mt-4 grid gap-1 text-dim">Opacity: {Math.round((settingsData?.widgetOpacity ?? 1) * 100)}%<input type="range" min="35" max="100" value={Math.round((settingsData?.widgetOpacity ?? 1) * 100)} onChange={(event) => setPreferences.mutate({ widgetOpacity: Number(event.target.value) / 100 })} /></label>
        </section>

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Refresh</h3>
          <div className="mt-2.5 flex items-center gap-2.5">
            <label className="text-dim" htmlFor="refresh-interval">Usage every</label>
            <select id="refresh-interval" className="cursor-pointer border border-line2 bg-surface px-2.5 py-1.5 text-fg"
              value={currentInterval}
              onChange={(event) => setRefreshInterval.mutate(Number(event.target.value))}
              disabled={setRefreshInterval.isPending}
            >
              {intervalOptions.map((seconds) => <option key={seconds} value={seconds}>{Math.round(seconds / 60)} min</option>)}
            </select>
          </div>
        </section>

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Usage alerts</h3>
          <label className="mt-3 flex items-center justify-between gap-4 text-dim">Color usage alerts <input type="checkbox" checked={settingsData?.alerts.enabled ?? true} onChange={(event) => setPreferences.mutate({ alerts: { ...(settingsData?.alerts ?? { cautionThreshold: 40, warningThreshold: 65, criticalThreshold: 85, cautionColor: "#ffd60a", warningColor: "#ff9f0a", criticalColor: "#ff453a" }), enabled: event.target.checked } })} /></label>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {(["caution", "warning", "critical"] as const).map((level) => {
              const alerts = settingsData?.alerts ?? { enabled: true, cautionThreshold: 40, warningThreshold: 65, criticalThreshold: 85, cautionColor: "#ffd60a", warningColor: "#ff9f0a", criticalColor: "#ff453a" };
              const thresholdKey = `${level}Threshold` as "cautionThreshold" | "warningThreshold" | "criticalThreshold";
              const colorKey = `${level}Color` as "cautionColor" | "warningColor" | "criticalColor";
              return <label key={level} className="grid gap-1 text-xs capitalize text-dim">{level}<input type="number" min="1" max="100" value={alerts?.[thresholdKey] ?? 0} onChange={(event) => setPreferences.mutate({ alerts: { ...(alerts!), [thresholdKey]: Number(event.target.value) } })} /><input type="color" value={alerts?.[colorKey] ?? "#ffffff"} onChange={(event) => setPreferences.mutate({ alerts: { ...(alerts!), [colorKey]: event.target.value } })} /></label>;
            })}
          </div>
        </section>

        {wslDetected && sourceOptions.length > 0 && (
          <section className="mt-6">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Provider data source</h3>
            {sourceOptions.map((entry) => {
              const entryId = entry.id ?? entry.kind;
              const parsed = parseProviderId(entryId);
              return (
                <div key={entryId} className="mt-2.5 flex items-center gap-2.5">
                  <label className="min-w-24 text-dim" htmlFor={`source-${entryId}`}>{parsed.displayName}</label>
                  <select id={`source-${entryId}`} className="cursor-pointer border border-line2 bg-surface px-2.5 py-1.5 text-fg"
                    value={sourceValue(entry.source)}
                    onChange={(event) => setProviderSource.mutate({ kind: entryId, source: parseSource(event.target.value) })}
                    disabled={setProviderSource.isPending}
                  >
                    <option value="host">Windows</option>
                    {entry.wsl.filter((candidate) => candidate.present).map((candidate) => (
                      <option key={candidate.distro} value={`wsl:${candidate.distro}`}>WSL: {candidate.distro}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </section>
        )}

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Providers</h3>
          {usageData.map((provider) => {
            const parsed = parseProviderId(provider.id || provider.kind);
            const enabled = settingsData ? (
              settingsData.enabledProviders.includes(provider.id) ||
              (provider.id === provider.kind && settingsData.enabledProviders.includes(provider.kind))
            ) : true;
            const hidden = settingsData?.hiddenUsageWindowTitles[provider.id] ?? settingsData?.hiddenUsageWindowTitles[provider.kind] ?? [];
            const titles = WINDOW_TITLES[provider.kind] ?? [];
            return <article key={provider.id || provider.kind} className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-3"><strong>{parsed.displayName}</strong><label className="flex items-center gap-2 text-dim"><input type="checkbox" checked={enabled} onChange={(event) => void window.metria.setProviderEnabled(provider.id || provider.kind, event.target.checked).then((next) => queryClient.setQueryData(["settings"], next))} /> Use this provider</label></div>
              <div className="mt-2 grid gap-2">{titles.map((title) => <label key={title} className="flex items-center gap-2 text-sm text-dim"><input type="checkbox" checked={!hidden.includes(title)} onChange={(event) => setWindowVisible.mutate({ kind: provider.id || provider.kind, title, visible: event.target.checked })} /> Show {title}</label>)}</div>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="border border-line2 bg-transparent px-3 py-1.5 text-fg" onClick={() => void diagnose.mutate(provider.id || provider.kind)}>Diagnose</button><button type="button" className="border border-line2 bg-transparent px-3 py-1.5 text-fg" onClick={() => void window.metria.reconnect(provider.id || provider.kind).then((result) => setNotice(result.message))}>Reconnect</button></div>
              {provider.error && <p className="mt-2 text-accent">{provider.error}</p>}
              <p className="mt-2 text-xs text-dim">{provider.updatedAt ? `Last update: ${new Date(provider.updatedAt).toLocaleString()}` : provider.setupHint}</p>
            </article>;
          })}
          <p className="mt-3 text-xs text-dim">Keep at least one provider enabled and one usage window visible per provider.</p>
        </section>

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Updates</h3>
          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
            <button type="button" className="cursor-pointer border border-line2 bg-transparent px-3 py-1.5 text-[#d8d8dc] disabled:opacity-55"
              onClick={() => void checkUpdates.mutate()} disabled={checkUpdates.isPending}>
              {checkUpdates.isPending ? "Checking…" : "Check for updates"}
            </button>
            {updateStatus === "downloaded" &&
              <button type="button" className="cursor-pointer border border-accent px-3 py-1.5 text-accent"
                onClick={() => void installUpdate.mutate()} disabled={installUpdate.isPending}>Restart &amp; install update</button>}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wider text-dim">Startup</h3>
          <button type="button" role="switch" aria-checked={loginItem.data?.enabled ?? false}
            className="mt-2.5 cursor-pointer border border-line2 bg-transparent px-3 py-1.5 text-[#d8d8dc] disabled:opacity-55"
            onClick={() => setLoginItem.mutate(!(loginItem.data?.enabled ?? false))}
            disabled={setLoginItem.isPending}>
            {loginItem.data?.enabled ? "Launches at login" : "Starts manually"}
          </button>
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="flex flex-wrap gap-2.5">
            {(info?.platform === "win32" || info?.platform === "linux") && (
              <button type="button" className="cursor-pointer border border-[#ff453a]/60 px-3 py-1.5 text-[#ff6961]"
                onClick={() => void uninstall.mutate()} disabled={uninstall.isPending}>Uninstall</button>
            )}
            <button type="button" className="cursor-pointer border border-line2 bg-transparent px-3 py-1.5 text-[#d8d8dc]"
              onClick={() => void quit.mutate()} disabled={quit.isPending}>Quit Metria Electron</button>
          </div>
        </section>

        {(notice || loginMessage) && <p className="m-0 mt-5 leading-relaxed text-dim" role="status">{notice || loginMessage}</p>}
      </div>
    </div>
  );
}

function Dashboard(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState("Loading provider usage…");
  const usage = useQuery({
    queryKey: ["usage"],
    queryFn: () => window.metria.refresh()
  });
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => window.metria.getSettings()
  });
  const sources = useProviderSources();
  const needsSourceChoice = (sources.data ?? []).some((info) => info.needsChoice);
  useEffect(() => {
    if (usage.isFetching) setStatus("Refreshing usage…");
    else if (usage.isError) setStatus("Metria could not refresh usage.");
    else if (usage.isSuccess) setStatus(`Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`);
  }, [usage.status, usage.isFetching, usage.isSuccess, usage.isError]);
  useEffect(() => { window.metria.onOpenSettings(() => setSettingsOpen(true)); }, []);
  return (
    <main className="mx-auto max-w-[880px] px-[clamp(24px,5vw,56px)] py-[clamp(24px,5vw,56px)]">
      <header className="flex items-center justify-between gap-6 border-b border-line pb-[22px]">
        <h1 className="m-0 text-[clamp(28px,4.6vw,46px)] leading-none tracking-[-0.07em]">
          <img className="mr-2.5 inline h-10 w-10 object-contain align-[-7px]" src="./metria-logo.png" alt="Metria" />
          Metria
        </h1>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Refresh usage"
            className="cursor-pointer rounded-full bg-[#e8edf3] p-2.5 text-[#10151b] focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-accent disabled:opacity-55"
            onClick={() => void usage.refetch()}
            disabled={usage.isFetching}
          >
            <svg aria-hidden="true" viewBox="0 0 512 512" fill="currentColor" className={`h-3.5 w-3.5 ${usage.isFetching ? "animate-spin" : ""}`}>
              <path d="M65.9 228.5c13.3-93 93.4-164.5 190.1-164.5 53 0 101 21.5 135.8 56.2 .2 .2 .4 .4 .6 .6l7.6 7.2-47.9 0c-17.7 0-32 14.3-32 32s14.3 32 32 32l128 0c17.7 0 32-14.3 32-32l0-128c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 53.4-11.3-10.7C390.5 28.6 326.5 0 256 0 127 0 20.3 95.4 2.6 219.5 .1 237 12.2 253.2 29.7 255.7s33.7-9.7 36.2-27.1zm443.5 64c2.5-17.5-9.7-33.7-27.1-36.2s-33.7 9.7-36.2 27.1c-13.3 93-93.4 164.5-190.1 164.5-53 0-101-21.5-135.8-56.2-.2-.2-.4-.4-.6-.6l-7.6-7.2 47.9 0c-17.7 0-32 14.3-32 32s14.3 32 32 32L32 320c-8.5 0-16.7 3.4-22.7 9.5S-.1 343.7 0 352.3l1 127c.1 17.7 14.6 31.9 32.3 31.7S65.2 496.4 65 478.7l-.4-51.5 10.7 10.1c46.3 46.1 110.2 74.7 180.7 74.7 129 0 235.7-95.4 253.4-219.5z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Settings"
            className="cursor-pointer rounded-full border border-line2 p-2.5 text-[#d8d8dc] focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-accent"
            onClick={() => setSettingsOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 512 512" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M495.9 166.6c3.2 8.7 .5 18.4-6.4 24.6l-43.3 39.4c1.1 8.3 1.7 16.8 1.7 25.4s-.6 17.1-1.7 25.4l43.3 39.4c6.9 6.2 9.6 15.9 6.4 24.6c-4.4 11.9-9.7 23.3-15.8 34.3l-4.7 8.1c-6.6 11-14 21.4-22.1 31.2c-2.9 3.5-6.8 5.9-11 7.3c-4.4 1.4-9.1 1.5-13.6 .3l-44.5-12.2c-12.4 7.1-25.7 13.5-39.7 19l-8.1 42.8c-1.5 7.6-6.7 14.1-14 17.5c-11.4 5.3-23.3 9.8-35.7 13.3c-8.3 2.4-17.3-.3-23.2-7.2l-29-33.3c-14.4 1.5-29.1 1.5-43.6 0l-29 33.3c-5.9 6.9-14.9 9.6-23.2 7.2c-12.4-3.5-24.3-7.9-35.7-13.3c-7.3-3.4-12.5-9.9-14-17.5l-8.1-42.8c-14-5.5-27.3-11.9-39.7-19l-44.5 12.2c-4.5 1.2-9.2 1.1-13.6-.3c-4.2-1.4-8.1-3.8-11-7.3c-8.1-9.8-15.5-20.2-22.1-31.2l-4.7-8.1c-6.1-11-11.4-22.4-15.8-34.3c-3.2-8.7-.5-18.4 6.4-24.6l43.3-39.4C17.4 263.6 16.8 255 16.8 246.4s.6-17.1 1.7-25.4l-43.3-39.4C-28 175.4-25.3 165.7-22.1 156.9c4.4-11.9 9.7-23.3 15.8-34.3l4.7-8.1c6.6-11 14-21.4 22.1-31.2c2.9-3.5 6.8-5.9 11-7.3c4.4-1.4 9.1-1.5 13.6-.3l44.5 12.2c12.4-7.1 25.7-13.5 39.7-19l8.1-42.8c1.5-7.6 6.7-14.1 14-17.5c11.4-5.3 23.3-9.8 35.7-13.3c8.3-2.4 17.3 .3 23.2 7.2l29 33.3c14.4-1.5 29.1-1.5 43.6 0l29-33.3c5.9-6.9 14.9-9.6 23.2-7.2c12.4 3.5 24.3 7.9 35.7 13.3c7.3 3.4 12.5 9.9 14 17.5l8.1 42.8c14 5.5 27.3 11.9 39.7 19l44.5-12.2c4.5-1.2 9.2-1.1 13.6 .3c4.2 1.4 8.1 3.8 11 7.3c8.1 9.8 15.5 20.2 22.1 31.2l4.7 8.1c6.1 11 11.4 22.4 15.8 34.3zM256 336a89.6 89.6 0 1 0 0-179.2A89.6 89.6 0 1 0 256 336z" />
            </svg>
          </button>
        </div>
      </header>
      <p className="mb-[30px] mt-[18px] text-dim" role="status">{status}</p>
      <section aria-live="polite">
        {(usage.data ?? []).map((provider) => {
          const enabled = settings.data ? (
            settings.data.enabledProviders.includes(provider.id) ||
            (provider.id === provider.kind && settings.data.enabledProviders.includes(provider.kind))
          ) : true;
          const hiddenWindows = settings.data?.hiddenUsageWindowTitles[provider.id] ?? settings.data?.hiddenUsageWindowTitles[provider.kind] ?? [];
          return (
            <ProviderCard
              key={provider.id || provider.kind}
              provider={provider}
              enabled={enabled}
              showAccount={settings.data?.showAccountLabels ?? true}
              hiddenWindows={hiddenWindows}
              alerts={settings.data?.alerts}
              onStatus={setStatus}
            />
          );
        })}
      </section>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {needsSourceChoice && <SourceChoiceModal />}
    </main>
  );
}

function Root(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  );
}

createRoot(document.body).render(<Root />);
