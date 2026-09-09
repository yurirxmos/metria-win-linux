import type { TranslationDictionary } from "./types";

export const ptBR: TranslationDictionary = {
  common: {
    enable: "Ativar",
    disable: "Desativar",
    setup: "Configurar",
    close: "Fechar",
    save: "Salvar",
    quit: "Sair",
    uninstall: "Desinstalar",
    diagnose: "Diagnosticar",
    reconnect: "Reconectar",
    checking: "Verificando…",
    installing: "A atualização está sendo instalada…",
    windows: "Windows",
    wslDistro: "WSL"
  },
  dashboard: {
    title: "Metria",
    refreshTooltip: "Atualizar uso",
    settingsTooltip: "Configurações",
    loadingUsage: "Carregando uso dos provedores…",
    refreshingUsage: "Atualizando uso…",
    errorUsage: "Metria não conseguiu atualizar o uso.",
    updatedAt: "Atualizado",
    allWindowsHidden: "Todas as janelas de uso estão ocultas. Ative uma nas Configurações."
  },
  settings: {
    title: "Configurações",
    close: "Fechar configurações",
    appSection: {
      title: "Aplicativo",
      version: "Versão",
      platform: "Plataforma",
      dataPath: "Pasta de dados"
    },
    displaySection: {
      title: "Exibição",
      showWidget: "Exibir widget de uso",
      showTray: "Exibir na bandeja do sistema",
      showAccountLabels: "Exibir conta do provedor",
      behavior: "Comportamento",
      behaviorPinned: "Fixado",
      behaviorAutoHide: "Ocultar automaticamente",
      position: "Posição",
      posRight: "Direita",
      posLeft: "Esquerda",
      posTop: "Superior",
      posBottom: "Inferior",
      size: "Tamanho",
      sizeSmall: "Pequeno",
      sizeMedium: "Médio",
      sizeLarge: "Grande",
      monitor: "Monitor",
      activeDisplay: "Tela ativa",
      opacity: "Opacidade",
      language: "Idioma",
      langSystem: "Sistema (Automático)",
      langEn: "English",
      langPt: "Português (Brasil)"
    },
    refreshSection: {
      title: "Atualização",
      usageEvery: "Uso a cada",
      minUnit: "min"
    },
    alertsSection: {
      title: "Alertas de uso",
      colorAlerts: "Colorir alertas de uso",
      caution: "Atenção",
      warning: "Alerta",
      critical: "Crítico"
    },
    dataSourceSection: {
      title: "Fonte de dados do provedor",
      description: "O Metria encontrou o mesmo provedor no Windows e no WSL. Escolha quais dados monitorar."
    },
    providersSection: {
      title: "Provedores",
      useProvider: "Usar este provedor",
      showWindow: "Exibir",
      diagnose: "Diagnosticar",
      reconnect: "Reconectar",
      lastUpdate: "Última atualização",
      keepOneNotice: "Mantenha pelo menos um provedor ativado e uma janela de uso visível por provedor."
    },
    updatesSection: {
      title: "Atualizações",
      checkUpdates: "Verificar atualizações",
      checking: "Verificando…",
      restartAndInstall: "Reiniciar e instalar atualização"
    },
    startupSection: {
      title: "Inicialização",
      launchesAtLogin: "Inicia com o sistema",
      startsManually: "Inicia manualmente"
    },
    dangerSection: {
      uninstall: "Desinstalar",
      quitApp: "Encerrar Metria Electron"
    }
  },
  sourceModal: {
    title: "Onde estão os dados do provedor?",
    description: "O Metria encontrou o mesmo provedor no Windows e no WSL. Escolha quais dados monitorar."
  },
  card: {
    percentUsed: "Utilizado",
    waitingData: "Aguardando dados de uso...",
    allWindowsHidden: "Todas as janelas de uso estão ocultas. Ative uma nas Configurações.",
    noResetData: "Sem dados de reinício"
  },
  widget: {
    hoverToOpen: "Passe o mouse para abrir o widget"
  },
  tray: {
    openDashboard: "Abrir painel",
    refresh: "Atualizar",
    settings: "Configurações",
    restartAndInstall: "Reiniciar e instalar atualização",
    checkForUpdates: "Verificar atualizações…",
    quit: "Encerrar Metria Electron",
    noUsageYet: "Nenhum dado de uso ainda",
    updated: "Atualizado"
  },
  windowTitles: {
    "Current session": "Sessão atual",
    "All models": "Todos os modelos",
    "5-hour Gemini": "Gemini (5 horas)",
    "Weekly Gemini": "Gemini semanal",
    "Cursor models": "Modelos Cursor",
    "API usage": "Uso de API",
    "This cycle": "Este ciclo",
    "This week": "Esta semana",
    "This month": "Este mês",
    "5-hour other models": "Outros modelos (5 horas)",
    "Weekly other models": "Outros modelos semanal",
    "Session": "Sessão"
  }
};
