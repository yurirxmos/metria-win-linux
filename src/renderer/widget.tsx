import { useEffect, useRef, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { clampPercent, DEFAULT_WIDGET_Y_OFFSET, parseProviderId, PROVIDER_LOGOS, WIDGET_ITEM_HEIGHT } from "../shared/types";
import type { ProviderKind, ProviderUsage } from "../shared/types";
import "./app.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

const ACCENT: Record<ProviderKind, string> = {
  "Claude": "#ff9f0a",
  "Codex": "#0a84ff",
  "OpenCode Go": "#ffffff",
  "Cursor": "#8e8e93",
  "Antigravity": "#3b82f6"
};

function primary(provider: ProviderUsage): number { return provider.windows[0]?.percent ?? 0; }

function Ring({ provider, alert }: { provider: ProviderUsage; alert: { enabled: boolean; cautionThreshold: number; warningThreshold: number; criticalThreshold: number; cautionColor: string; warningColor: string; criticalColor: string } }): JSX.Element {
  const clamped = clampPercent(primary(provider));
  const r = 17;
  const c = 2 * Math.PI * r;
  const stroke = alert.enabled && clamped >= alert.criticalThreshold
    ? alert.criticalColor
    : alert.enabled && clamped >= alert.warningThreshold
      ? alert.warningColor
      : alert.enabled && clamped >= alert.cautionThreshold
        ? alert.cautionColor
        : provider.kind === "Codex"
          ? "url(#codex-ring)"
          : provider.kind === "Cursor"
            ? "url(#cursor-ring)"
            : ACCENT[provider.kind];
  return (
    <span className="relative block h-[38px] w-[38px]">
      <svg className="absolute inset-0" width="38" height="38" viewBox="0 0 38 38">
        {provider.kind === "Codex" && (
          <defs>
            <linearGradient id="codex-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#0a84ff" />
              <stop offset="1" stopColor="#bf5af2" />
            </linearGradient>
          </defs>
        )}
        {provider.kind === "Cursor" && (
          <defs>
            <linearGradient id="cursor-ring" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8e8e93" />
              <stop offset="1" stopColor="#ffffff" />
            </linearGradient>
          </defs>
        )}
        <circle cx="19" cy="19" r={r} fill="none" stroke="#2c2c2c" strokeWidth="5" />
        <circle
          cx="19" cy="19" r={r} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round"
          strokeDasharray={`${c.toFixed(2)} ${c.toFixed(2)}`}
          strokeDashoffset={(c * (1 - clamped / 100)).toFixed(2)}
          transform="rotate(-90 19 19)"
        />
      </svg>
      <img className="pointer-events-none absolute inset-0 m-auto h-[15px] w-[15px] object-contain" src={`./${PROVIDER_LOGOS[provider.kind]}`} alt="" />
    </span>
  );
}

const DRAG_THRESHOLD = 4;

function Widget(): JSX.Element {
  // The dashboard can enable/disable providers at any time; refresh our cached
  // settings/usage as soon as the main process broadcasts a change so the notch
  // picks up the new provider immediately instead of waiting for the poll cycle.
  useEffect(() => {
    window.metria.onSettingsChanged(() => { void queryClient.invalidateQueries(); });
    window.metria.onUsageChanged(() => { void queryClient.invalidateQueries({ queryKey: ["usage"] }); });
  }, []);
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.metria.getSettings() });
  const [hovered, setHovered] = useState(false);
  const position = settings.data?.widgetPosition ?? "right";
  const vertical = position === "left" || position === "right";
  const autoHide = settings.data?.widgetBehavior === "auto-hide";
  const size = settings.data?.widgetSize ?? "medium";
  const usage = useQuery({
    queryKey: ["usage"],
    queryFn: () => window.metria.getUsage(),
    refetchInterval: settings.data ? settings.data.refreshIntervalSeconds * 1000 : undefined
  });
  const drag = useRef<{ startScreen: number; startOffset: number } | null>(null);
  const moved = useRef(false);
  const offsetRef = useRef(DEFAULT_WIDGET_Y_OFFSET);
  const pendingTarget = useRef<number | null>(null);
  const frameScheduled = useRef(false);
  useEffect(() => { if (settings.data) offsetRef.current = settings.data.widgetAlongEdgeOffset || settings.data.widgetYOffset; }, [settings.data]);
  const scheduleMove = (target: number): void => {
    pendingTarget.current = target;
    if (frameScheduled.current) return;
    frameScheduled.current = true;
    requestAnimationFrame(() => {
      frameScheduled.current = false;
      const value = pendingTarget.current;
      pendingTarget.current = null;
      if (value === null) return;
      // Keep the drag base in sync with the persisted (clamped) value so each
      // new drag starts from the widget's actual position instead of a stale one.
      void window.metria.setWidgetYOffset(value).then((settings) => { offsetRef.current = settings.widgetYOffset; });
    });
  };
  const visible = (usage.data ?? []).filter((provider) => {
    if (!settings.data) return true;
    return settings.data.enabledProviders.includes(provider.id) || settings.data.enabledProviders.includes(provider.kind);
  });
  // Keep provider items mounted while auto-hide is active so the rail remains
  // discoverable and can recover even when a window manager misses hover events.
  const displayed = visible;
  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    moved.current = false;
    // Use screenY, not clientY: the widget window moves while dragging, so
    // viewport-relative coordinates shift on their own and make the drag
    // oscillate (ghost effect). screenY is global and stays stable.
    drag.current = { startScreen: vertical ? event.screenY : event.screenX, startOffset: offsetRef.current };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const dragState = drag.current;
    if (!dragState) return;
    const delta = Math.round((vertical ? event.screenY : event.screenX) - dragState.startScreen);
    if (Math.abs(delta) > DRAG_THRESHOLD) {
      if (!moved.current) void window.metria.setProviderHover(null);
      moved.current = true;
      scheduleMove(dragState.startOffset + delta);
    }
  };
  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    drag.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Not captured. */ }
    if (moved.current) {
      // The widget moved while dragging; re-assess the hover so the card shows
      // again for the item now under the cursor instead of staying stale/hidden.
      const hit = document.elementsFromPoint(event.clientX, event.clientY)
        .find((element) => element instanceof HTMLElement && element.dataset.index !== undefined);
      void window.metria.setProviderHover(hit instanceof HTMLElement ? Number(hit.dataset.index) : null);
    }
  };
  return (
    <main className={`notch-rail relative flex h-full w-full select-none overflow-hidden transition-opacity duration-200 ${vertical ? "flex-col py-3" : "flex-row px-3"} cursor-grab active:cursor-grabbing notch-${position}`} style={{ opacity: (settings.data?.widgetOpacity ?? 1) * (autoHide && !hovered ? 0.55 : 1) }} onContextMenu={(event) => { event.preventDefault(); void window.metria.openWidgetMenu(); }} onMouseEnter={() => setHovered(true)} onMouseMove={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {autoHide && !hovered && <span className="notch-hidden-hint absolute inset-0 flex items-center justify-center text-xs" aria-label="Hover to open widget">{position === "right" ? "<" : position === "left" ? ">" : position === "top" ? "v" : "^"}</span>}
      <section className={`notch-provider-list flex min-h-0 min-w-0 flex-1 items-center justify-center ${vertical ? "flex-col" : "flex-row"}`}>
        {displayed.map((provider, index) => {
          const parsed = parseProviderId(provider.id || provider.kind);
          return (
            <div
              key={provider.id || provider.kind}
              data-index={index}
              title={parsed.displayName}
              className={`notch-provider-item flex shrink-0 cursor-pointer items-center justify-center gap-[3px] ${vertical ? "w-16 flex-col" : "h-16 flex-col"} ${size === "small" ? "scale-90" : size === "large" ? "scale-110" : ""}`}
              style={{ width: vertical ? 64 : WIDGET_ITEM_HEIGHT, height: vertical ? WIDGET_ITEM_HEIGHT : 64 }}
              onClick={() => { if (!moved.current) void window.metria.openDashboard(); }}
              onMouseEnter={() => { void window.metria.setProviderHover(index); }}
            >
              <Ring provider={provider} alert={settings.data?.alerts ?? { enabled: true, cautionThreshold: 40, warningThreshold: 65, criticalThreshold: 85, cautionColor: "#ffd60a", warningColor: "#ff9f0a", criticalColor: "#ff453a" }} />
              <span className="notch-provider-percent text-[11px] leading-none text-white">
                {Math.round(clampPercent(primary(provider)))}%
              </span>
            </div>
          );
        })}
      </section>
    </main>
  );
}

function Root(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Widget />
    </QueryClientProvider>
  );
}

document.body.addEventListener("mouseleave", () => { void window.metria.setProviderHover(null); });
createRoot(document.body).render(<Root />);
