import { useEffect, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { CARD_WIDTH, clampPercent, gaugeColor, parseProviderId, PROVIDER_LOGOS, statusDotColor } from "../shared/types";
import type { AppSettings, CardShowPayload, ProviderUsage, UsageWindow } from "../shared/types";
import { formatResetText, getTranslations, resolveLocale, translateWindowTitle } from "../shared/i18n";
import type { SupportedLocale } from "../shared/i18n";
import "./app.css";

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } });

// The main process can emit `metria:card-show` before React mounts (first hover
// after the window is created); buffer the last payload so the effect can apply
// it immediately instead of waiting for the next hover.
type ShowListener = (payload: CardShowPayload | null) => void;
let bufferedShow: CardShowPayload | null = null;
const showListeners = new Set<ShowListener>();
window.metria.onCardShow((payload) => { bufferedShow = payload; showListeners.forEach((listener) => listener(payload)); });
window.metria.onCardHide(() => { bufferedShow = null; showListeners.forEach((listener) => listener(null)); });


function WindowRow({ window: row, alerts, locale, t }: { window: UsageWindow; alerts?: AppSettings["alerts"]; locale: SupportedLocale; t: ReturnType<typeof getTranslations> }): JSX.Element {
  const percent = clampPercent(row.percent);
  const color = alerts?.enabled && percent >= alerts.criticalThreshold ? alerts.criticalColor : alerts?.enabled && percent >= alerts.warningThreshold ? alerts.warningColor : alerts?.enabled && percent >= alerts.cautionThreshold ? alerts.cautionColor : gaugeColor(percent);
  return (
    <div className="mt-[18px] first:mt-0">
      <div className="flex items-baseline justify-between gap-3 text-[13px] leading-[1.2]">
        <span>{translateWindowTitle(row.title, locale)}</span>
        <span className="whitespace-nowrap text-xs text-mute">{formatResetText(row.resetDate, locale)}</span>
      </div>
      <div className="my-2 h-[7px] overflow-hidden rounded-[99px] bg-[#2c2c2c]">
       <i className="block h-full rounded-[99px]" style={{ background: color, width: `${percent}%` }} />
      </div>
      <div className="mt-2 text-[13px] font-semibold leading-none text-[#e8e8e8]">{Math.round(percent)}% {t.card.percentUsed}</div>
    </div>
  );
}

function Card(): JSX.Element {
  const [payload, setPayload] = useState<CardShowPayload | null>(bufferedShow);
  const usage = useQuery({
    queryKey: ["usage"],
    queryFn: () => window.metria.getUsage(),
    refetchOnWindowFocus: false
  });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.metria.getSettings() });
  const choice = settings.data?.locale ?? "system";
  const locale = resolveLocale(choice, typeof navigator !== "undefined" ? navigator.language : undefined);
  const t = getTranslations(locale);
  useEffect(() => {
    window.metria.onSettingsChanged(() => { void queryClient.invalidateQueries({ queryKey: ["settings"] }); });
    window.metria.onUsageChanged(() => { void queryClient.invalidateQueries({ queryKey: ["usage"] }); });
  }, []);
  const visible = (usage.data ?? []).filter((candidate) =>
    settings.data ? (
      settings.data.enabledProviders.includes(candidate.id) ||
      (candidate.id === candidate.kind && settings.data.enabledProviders.includes(candidate.kind))
    ) : true
  );
  const provider = (payload !== null && payload.index !== undefined && visible[payload.index])
    ? visible[payload.index]
    : usage.data?.find((candidate) => candidate.kind === payload?.kind);
  const hidden = provider
    ? (settings.data?.hiddenUsageWindowTitles[provider.id] ?? settings.data?.hiddenUsageWindowTitles[provider.kind] ?? [])
    : [];
  const visibleWindows = provider?.windows.filter((row) => !hidden.includes(row.title)) ?? [];

  useEffect(() => {
    const apply = (next: CardShowPayload | null): void => setPayload(next);
    // Never re-send a hover from inside the card: it cancels the pending hide and
    // keeps the card open when the pointer merely crosses it while leaving the widget.
    const leave = (): void => { void window.metria.setProviderHover(null); };
    showListeners.add(apply);
    document.body.addEventListener("mouseleave", leave);
    return () => {
      showListeners.delete(apply);
      document.body.removeEventListener("mouseleave", leave);
    };
  }, []);

  useEffect(() => {
    if (!payload) return;
    requestAnimationFrame(() => {
      const card = document.querySelector<HTMLElement>(".notch-card");
      if (card) void window.metria.resizeCard(Math.ceil(card.getBoundingClientRect().height));
    });
  }, [payload, provider, usage.data, settings.data?.widgetPosition]);

  const content = provider ? (
    provider.windows.length === 0 ? (
      <>
        <div className="flex items-center gap-2 text-[13px] leading-[1.4] text-mute">
          {provider.error ?? t.card.waitingData}
        </div>
        {provider.error && <p className="mt-3 text-[12px] leading-[1.4] text-[#ff8d6c]">{provider.error}</p>}
      </>
    ) : visibleWindows.length === 0 ? (
      <div className="text-[13px] leading-[1.4] text-mute">{t.card.allWindowsHidden}</div>
    ) : (
      visibleWindows.map((row) => <WindowRow key={row.title} window={row} alerts={settings.data?.alerts} locale={locale} t={t} />)
    )
  ) : (
    <div className="flex items-center gap-2 text-[13px] leading-[1.4] text-mute">{t.card.waitingData}</div>
  );

  const position = settings.data?.widgetPosition ?? "right";
  const parsed = provider ? parseProviderId(provider.id || provider.kind) : null;
  const card = (
     <main className="notch-card-body relative flex h-fit select-none flex-col px-5 py-5" style={{ width: CARD_WIDTH - 16 }}>
       <h2 className="m-0 mb-4 flex items-center gap-2.5 p-0 text-[18px] font-medium leading-none">
        {provider && (
          <>
             <img className="h-[19px] w-[19px] shrink-0 object-contain" src={`./${PROVIDER_LOGOS[provider.kind]}`} alt="" />
            <span>{parsed?.displayName ?? provider.kind}</span>
            {settings.data?.showAccountLabels && provider.accountLabel && <span className="min-w-0 truncate text-xs text-mute">{provider.accountLabel}</span>}
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: statusDotColor(provider.error !== null) }} />
          </>
        )}
      </h2>
      <div>{content}</div>
     </main>
  );
  return (
    <div className={`notch-card notch-card-${position}`}>
      {position === "left" || position === "top" ? <span className="notch-pointer" aria-hidden="true" /> : null}
      {card}
      {position === "right" || position === "bottom" ? <span className="notch-pointer" aria-hidden="true" /> : null}
    </div>
  );
}

function Root(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Card />
    </QueryClientProvider>
  );
}

createRoot(document.body).render(<Root />);
