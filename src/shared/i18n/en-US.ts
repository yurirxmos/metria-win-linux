import type { TranslationDictionary } from "./types";

export const enUS: TranslationDictionary = {
  common: {
    enable: "Enable",
    disable: "Disable",
    setup: "Setup",
    close: "Close",
    save: "Save",
    quit: "Quit",
    uninstall: "Uninstall",
    diagnose: "Diagnose",
    reconnect: "Reconnect",
    checking: "Checking…",
    installing: "The update is installing…",
    windows: "Windows",
    wslDistro: "WSL"
  },
  dashboard: {
    title: "Metria",
    refreshTooltip: "Refresh usage",
    settingsTooltip: "Settings",
    loadingUsage: "Loading provider usage…",
    refreshingUsage: "Refreshing usage…",
    errorUsage: "Metria could not refresh usage.",
    updatedAt: "Updated",
    allWindowsHidden: "All usage windows are hidden. Enable one in Settings."
  },
  settings: {
    title: "Settings",
    close: "Close settings",
    appSection: {
      title: "App",
      version: "Version",
      platform: "Platform",
      dataPath: "Data folder"
    },
    displaySection: {
      title: "Display",
      showWidget: "Show usage widget",
      showTray: "Show in system tray",
      showAccountLabels: "Show provider account",
      behavior: "Behavior",
      behaviorPinned: "Pinned",
      behaviorAutoHide: "Auto-hide",
      position: "Position",
      posRight: "Right",
      posLeft: "Left",
      posTop: "Top",
      posBottom: "Bottom",
      size: "Size",
      sizeSmall: "Small",
      sizeMedium: "Medium",
      sizeLarge: "Large",
      monitor: "Monitor",
      activeDisplay: "Active display",
      opacity: "Opacity",
      language: "Language",
      langSystem: "System (Auto)",
      langEn: "English",
      langPt: "Português (Brasil)"
    },
    refreshSection: {
      title: "Refresh",
      usageEvery: "Usage every",
      minUnit: "min"
    },
    alertsSection: {
      title: "Usage alerts",
      colorAlerts: "Color usage alerts",
      caution: "Caution",
      warning: "Warning",
      critical: "Critical"
    },
    dataSourceSection: {
      title: "Provider data source",
      description: "Metria found the same provider here in Windows and inside WSL. Pick which data to track."
    },
    providersSection: {
      title: "Providers",
      useProvider: "Use this provider",
      showWindow: "Show",
      diagnose: "Diagnose",
      reconnect: "Reconnect",
      lastUpdate: "Last update",
      keepOneNotice: "Keep at least one provider enabled and one usage window visible per provider."
    },
    updatesSection: {
      title: "Updates",
      checkUpdates: "Check for updates",
      checking: "Checking…",
      restartAndInstall: "Restart & install update"
    },
    startupSection: {
      title: "Startup",
      launchesAtLogin: "Launches at login",
      startsManually: "Starts manually"
    },
    dangerSection: {
      uninstall: "Uninstall",
      quitApp: "Quit Metria Electron"
    }
  },
  sourceModal: {
    title: "Where is your provider data?",
    description: "Metria found the same provider here in Windows and inside WSL. Pick which data to track."
  },
  card: {
    percentUsed: "Used",
    waitingData: "Waiting for usage data...",
    allWindowsHidden: "All usage windows are hidden. Enable one in Settings.",
    noResetData: "No reset data"
  },
  widget: {
    hoverToOpen: "Hover to open widget"
  },
  tray: {
    openDashboard: "Open dashboard",
    refresh: "Refresh",
    settings: "Settings",
    restartAndInstall: "Restart & install update",
    checkForUpdates: "Check for updates…",
    quit: "Quit Metria Electron",
    noUsageYet: "No usage data yet",
    updated: "Updated"
  },
  windowTitles: {
    "Current session": "Current session",
    "All models": "All models",
    "5-hour Gemini": "5-hour Gemini",
    "Weekly Gemini": "Weekly Gemini",
    "Cursor models": "Cursor models",
    "API usage": "API usage",
    "This cycle": "This cycle",
    "This week": "This week",
    "This month": "This month",
    "5-hour other models": "5-hour other models",
    "Weekly other models": "Weekly other models",
    "Session": "Session"
  }
};
