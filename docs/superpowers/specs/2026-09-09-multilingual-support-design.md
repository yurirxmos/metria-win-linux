# Design Specification: Suporte Multilíngue (en-US e pt-BR) no Metria Electron

**Data:** 2026-09-09  
**Status:** Aprovado para Planejamento  
**Branch Base:** `feat/missing-providers`  

---

## 1. Visão Geral e Objetivos

O objetivo deste projeto é dotar o **Metria Electron** de suporte multilíngue (internacionalização/i18n), iniciando com os idiomas **Inglês (en-US)** e **Português do Brasil (pt-BR)**.

O suporte abrangerá toda a experiência do usuário:
- Menus de sistema e da bandeja (Tray), tooltips e menus de contexto no processo principal (`main`).
- Toda a interface gráfica nos processos de renderização (`renderer`): Dashboard, Modal de Configurações (Settings), Modal de Escolha de Fonte de Dados WSL (SourceChoiceModal), Widget flutuante de uso e Notch Card.
- Títulos exibidos das janelas de uso dos modelos de IA (*Current session*, *All models*, *5-hour Gemini*, *This week*, etc.), preservando estritamente os identificadores internos e a persistência em `hiddenUsageWindowTitles`.
- Formatações de data, hora e tempo relativo de reset ("Reinicia em 2 h 30 min" vs "Resets in 2 hr 30 min").

---

## 2. Decisões Arquiteturais

1. **Abordagem Isomórfica Zero Dependências:**
   - Para manter o Metria Electron extremamente leve e rápido, não serão adicionadas bibliotecas externas pesadas como `i18next`.
   - Um módulo compartilhado em TypeScript em `src/shared/i18n/` proverá dicionários estritamente tipados (`satisfies TranslationDictionary`).
   - O TypeScript garantirá em tempo de compilação que nenhuma chave falte em nenhum dos idiomas.

2. **Comportamento de Detecção e Seleção de Idioma:**
   - O usuário pode optar por `"system"` (Automático/Sistema), `"en-US"` ou `"pt-BR"`.
   - O valor padrão é `"system"`.
   - Quando configurado como `"system"`, o aplicativo detecta o locale do sistema operacional (`app.getLocale()` no processo principal e `navigator.language` no navegador/renderer). Se o locale iniciar com `"pt"` (ex: `pt-BR`, `pt-PT`), o idioma ativo será `"pt-BR"`; caso contrário, fallback para `"en-US"`.
   - A preferência é salva no arquivo de configurações do usuário (`settings.json`).

3. **Reatividade Instantânea sem Recarregamento:**
   - Ao alterar o idioma no modal de configurações, a mutação salva a preferência e emite o evento IPC `metria:settings-changed`.
   - O processo principal atualiza imediatamente os menus da bandeja (`Tray`) e badges de provedor.
   - Os renderers (`Dashboard`, `Widget`, `Card`) reagem imediatamente ao evento e re-renderizam os textos no novo idioma sem necessidade de recarregar a janela ou reiniciar a aplicação.

4. **Preservação de Identificadores Canônicos:**
   - Títulos de janelas de uso (ex: `"Current session"`) continuam com suas strings canônicas em inglês nos dados de backend e na chave `hiddenUsageWindowTitles` do `AppSettings`.
   - Um helper `translateWindowTitle(canonicalTitle, locale)` é usado exclusivamente na camada de renderização visual.

---

## 3. Modelo de Dados e Configuração

### 3.1. Tipos Compartilhados (`src/shared/types.ts`)
```typescript
export type SupportedLocale = "en-US" | "pt-BR";
export type LocaleChoice = "system" | "en-US" | "pt-BR";

export interface AppSettings {
  // ... campos existentes ...
  locale: LocaleChoice;
}
```

### 3.2. Configurações Padrão e Sanitização (`src/main/settings.ts`)
- `defaults.locale = "system"`
- Função de normalização para validar se o valor lido do `settings.json` é um `LocaleChoice` válido (`"system"`, `"en-US"` ou `"pt-BR"`), caindo para `"system"` em caso de valor inválido.
- Suporte a atualização via `setWidgetPreferences({ locale })`.

---

## 4. Estrutura do Módulo i18n (`src/shared/i18n/`)

```text
src/shared/i18n/
├── types.ts          # Schema rigoroso de tipos (TranslationDictionary)
├── en-US.ts          # Dicionário em inglês
├── pt-BR.ts          # Dicionário em português brasileiro
└── index.ts          # Helpers: resolveLocale, getTranslations, formatadores e translateWindowTitle
```

### 4.1. Escopo das Chaves de Tradução
- **`common`**: Rótulos genéricos como `enable`, `disable`, `setup`, `close`, `save`, `quit`, `uninstall`, `diagnose`, `reconnect`.
- **`dashboard`**: Cabeçalho, botões de ação, status de carregamento, recarga e erro.
- **`settings`**: Títulos de seções (App, Display, Refresh, Usage Alerts, Provider Data Source, Providers, Updates, Startup), opções de seletores (Pinned/Auto-hide, Right/Left/Top/Bottom, Small/Medium/Large, System/English/Português), legendas e textos de ajuda.
- **`sourceModal`**: Textos do modal de escolha de dados do WSL versus host Windows.
- **`card`**: Indicadores de `% Used` / `% Utilizado`, mensagens de espera por dados e avisos de janelas ocultas.
- **`widget`**: Textos acessíveis e tooltips do widget flutuante.
- **`tray`**: Menus de contexto da bandeja, opções de menu de contexto do widget e tooltips.
- **`windowTitles`**: Mapeamento de títulos de janelas de métricas de todos os provedores suportados.

### 4.2. Helpers Utilitários (`src/shared/i18n/index.ts`)
- `resolveLocale(choice: LocaleChoice, systemLocale?: string): SupportedLocale`: Resolve o idioma efetivo com base na escolha do usuário e locale do sistema.
- `getTranslations(locale: SupportedLocale): TranslationDictionary`: Retorna o dicionário de traduções correspondente.
- `translateWindowTitle(canonicalTitle: string, locale: SupportedLocale): string`: Mapeia títulos canônicos conhecidos para o idioma correspondente ou retorna o título original se não houver tradução específica.
- `formatResetText(resetDate: string | null, locale: SupportedLocale): string`: Formata o tempo restante ou a data futura de reset em tempo relativo ("Reinicia em X h Y min" / "Resets in X hr Y min").
- `formatDateTime(date: Date | string | number, locale: SupportedLocale, options?: Intl.DateTimeFormatOptions): string`: Formatação padronizada de data/hora.

---

## 5. Integração com Processos

### 5.1. Main Process (`src/main/index.ts`)
- Utiliza `resolveLocale(settings.load().locale, app.getLocale())` para obter o locale ativo.
- Menus da bandeja (`buildTrayMenu`) e badges (`badgeTemplate`, `updateBadges`) utilizam as strings do dicionário correspondente.
- Tooltips de status na bandeja são formatados com a data/hora no idioma ativo.
- O menu de contexto do widget flutuante (`showWidgetMenu`) utiliza os rótulos no idioma ativo.
- Emissões de notificação de atualização (`updateState`) utilizam textos traduzidos.

### 5.2. Renderers (`src/renderer/`)
- Criado o hook `useI18n()` que consulta as configurações reativamente via `@tanstack/react-query` e detecta o locale do sistema via `navigator.language`.
- **`src/renderer/index.tsx`**:
  - Seletor de idioma adicionado na seção **Display** ou **App** do `SettingsModal`.
  - Todas as strings da interface do Dashboard e do Modal substituídas por chamadas a `t`.
  - Títulos de janelas nas listas de provedores renderizados via `translateTitle(title)`.
- **`src/renderer/card.tsx`**:
  - `WindowRow` exibe `translateTitle(row.title)`.
  - Textos de reset e percentual (`% Utilizado` / `% Used`) utilizam os helpers do `i18n`.
- **`src/renderer/widget.tsx`**:
  - Rótulos de acessibilidade do botão de recolhimento/abertura utilizam os helpers do `i18n`.

---

## 6. Estratégia de Testes

1. **Testes Unitários de i18n (`test/i18n.test.ts`):**
   - Garantir que `en-US` e `pt-BR` possuam exatamente as mesmas chaves e estruturas (verificação recursiva de paridade).
   - Testar o comportamento da função `resolveLocale` para combinações de preferência do usuário e locales do sistema.
   - Testar a tradução de títulos de janelas de todos os provedores suportados.
   - Testar a formatação de tempo relativo de reset nos dois idiomas.
2. **Testes de Configuração (`test/settings.test.ts`):**
   - Validar persistência, carregamento e sanitização do novo campo `locale` em `SettingsStore`.
3. **Pipeline de Verificação (`npm run check`):**
   - Validação de tipagem do Main e Renderer com TypeScript (`tsc --noEmit`).
   - Compilação dos bundles com Vite.
   - Execução de todos os testes unitários (`node --test dist/test/*.test.js`).
