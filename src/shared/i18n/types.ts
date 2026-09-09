export interface TranslationDictionary {
  common: {
    enable: string;
    disable: string;
    setup: string;
    close: string;
    save: string;
    quit: string;
    uninstall: string;
    diagnose: string;
    reconnect: string;
    checking: string;
    installing: string;
    windows: string;
    wslDistro: string;
  };
  dashboard: {
    title: string;
    refreshTooltip: string;
    settingsTooltip: string;
    loadingUsage: string;
    refreshingUsage: string;
    errorUsage: string;
    updatedAt: string;
    allWindowsHidden: string;
  };
  settings: {
    title: string;
    close: string;
    appSection: {
      title: string;
      version: string;
      platform: string;
      dataPath: string;
    };
    displaySection: {
      title: string;
      showWidget: string;
      showTray: string;
      showAccountLabels: string;
      behavior: string;
      behaviorPinned: string;
      behaviorAutoHide: string;
      position: string;
      posRight: string;
      posLeft: string;
      posTop: string;
      posBottom: string;
      size: string;
      sizeSmall: string;
      sizeMedium: string;
      sizeLarge: string;
      monitor: string;
      activeDisplay: string;
      opacity: string;
      language: string;
      langSystem: string;
      langEn: string;
      langPt: string;
    };
    refreshSection: {
      title: string;
      usageEvery: string;
      minUnit: string;
    };
    alertsSection: {
      title: string;
      colorAlerts: string;
      caution: string;
      warning: string;
      critical: string;
    };
    dataSourceSection: {
      title: string;
      description: string;
    };
    providersSection: {
      title: string;
      useProvider: string;
      showWindow: string;
      diagnose: string;
      reconnect: string;
      lastUpdate: string;
      keepOneNotice: string;
    };
    updatesSection: {
      title: string;
      checkUpdates: string;
      checking: string;
      restartAndInstall: string;
    };
    startupSection: {
      title: string;
      launchesAtLogin: string;
      startsManually: string;
    };
    dangerSection: {
      uninstall: string;
      quitApp: string;
    };
  };
  sourceModal: {
    title: string;
    description: string;
  };
  card: {
    percentUsed: string;
    waitingData: string;
    allWindowsHidden: string;
    noResetData: string;
  };
  widget: {
    hoverToOpen: string;
  };
  tray: {
    openDashboard: string;
    refresh: string;
    settings: string;
    restartAndInstall: string;
    checkForUpdates: string;
    quit: string;
    noUsageYet: string;
    updated: string;
  };
  windowTitles: Record<string, string>;
}
