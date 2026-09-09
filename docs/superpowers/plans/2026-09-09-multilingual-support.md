# Multilingual Support (en-US and pt-BR) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full multilingual support (en-US and pt-BR) across Metria Electron's Main Process (Tray, tooltips, context menus) and Renderer views (Dashboard, SettingsModal, Notch Card, and Widget) with zero new runtime dependencies.

**Architecture:** A lightweight, strictly typed isomorphic TypeScript translation module in `src/shared/i18n/` defines dictionaries for `en-US` and `pt-BR`. An updated `AppSettings.locale` (`"system" | "en-US" | "pt-BR"`) persists user preference, automatically resolves system locale via `app.getLocale()` (Main) or `navigator.language` (Renderer), and broadcasts changes in real time via existing IPC.

**Tech Stack:** TypeScript, Electron, React 19, @tanstack/react-query, Vite, Node.js test runner (`node:test`, `node:assert/strict`).

**Spec:** `docs/superpowers/specs/2026-09-09-multilingual-support-design.md`

## Global Constraints

- Zero new external runtime dependencies added to `package.json`.
- Compile-time type safety: `pt-BR` and `en-US` must satisfy `TranslationDictionary` so `npm run check` catches any missing key.
- Canonical IDs and titles (e.g., `"Current session"`, `"Claude"`, `hiddenUsageWindowTitles`) remain untouched in settings and data flows; translation of usage window titles occurs strictly at the presentation layer via `translateWindowTitle()`.
- System locale detection defaults to `"en-US"` if system language is not Portuguese.
- All code must pass `npm run check` (`tsc`, Vite build, and `node --test`).

---

### Task 1: Add `locale` to `AppSettings` in `src/shared/types.ts` and `src/main/settings.ts` with tests

**Files:**
- Modify: `src/shared/types.ts:40-75`
- Modify: `src/main/settings.ts:9-55`
- Create: `src/test/settings.test.ts`

**Interfaces:**
- Consumes: None
- Produces:
  ```typescript
  export type SupportedLocale = "en-US" | "pt-BR";
  export type LocaleChoice = "system" | "en-US" | "pt-BR";
  export interface AppSettings {
    // ...
    locale: LocaleChoice;
  }
  ```

- [ ] **Step 1: Write the failing test for `SettingsStore` locale handling**

Create `src/test/settings.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { SettingsStore } from "../main/settings";

test("SettingsStore defaults locale to 'system'", () => {
  const store = new SettingsStore();
  const settings = store.load();
  assert.equal(settings.locale, "system");
});

test("SettingsStore normalizes invalid locale to 'system'", () => {
  const store = new SettingsStore();
  // @ts-expect-error testing invalid input
  const updated = store.setWidgetPreferences({ locale: "fr-FR" });
  assert.equal(updated.locale, "system");
});

test("SettingsStore persists valid locale choices", () => {
  const store = new SettingsStore();
  const pt = store.setWidgetPreferences({ locale: "pt-BR" });
  assert.equal(pt.locale, "pt-BR");
  const en = store.setWidgetPreferences({ locale: "en-US" });
  assert.equal(en.locale, "en-US");
  const sys = store.setWidgetPreferences({ locale: "system" });
  assert.equal(sys.locale, "system");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/settings.test.js`
Expected: FAIL because `locale` is not defined on `AppSettings` or `SettingsStore`.

- [ ] **Step 3: Write minimal implementation in `src/shared/types.ts` and `src/main/settings.ts`**

In `src/shared/types.ts`:
```typescript
export type SupportedLocale = "en-US" | "pt-BR";
export type LocaleChoice = "system" | "en-US" | "pt-BR";
```
Add `locale: LocaleChoice;` to `interface AppSettings`.

In `src/main/settings.ts`:
Update `defaults`:
```typescript
locale: "system"
```
In `load()`:
```typescript
locale: parsed.locale === "en-US" || parsed.locale === "pt-BR" || parsed.locale === "system" ? parsed.locale : defaults.locale,
```
In `setWidgetPreferences`:
Allow `locale` in the `Partial<Pick<AppSettings, ... | "locale">>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/settings.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/settings.ts src/test/settings.test.ts
git commit -m "feat: add locale setting to AppSettings and SettingsStore"
```

---

### Task 2: Implement i18n types, dictionaries (`en-US`, `pt-BR`), helpers, and unit tests

**Files:**
- Create: `src/shared/i18n/types.ts`
- Create: `src/shared/i18n/en-US.ts`
- Create: `src/shared/i18n/pt-BR.ts`
- Create: `src/shared/i18n/index.ts`
- Create: `src/test/i18n.test.ts`

**Interfaces:**
- Consumes: `SupportedLocale`, `LocaleChoice` from `src/shared/types.ts`
- Produces:
  ```typescript
  export type TranslationDictionary = { ... };
  export function resolveLocale(choice: LocaleChoice, systemLocale?: string): SupportedLocale;
  export function getTranslations(locale: SupportedLocale): TranslationDictionary;
  export function translateWindowTitle(title: string, locale: SupportedLocale): string;
  export function formatResetText(resetDate: string | null, locale: SupportedLocale, now?: number): string;
  export function formatResetDate(resetDate: string | null, locale: SupportedLocale): string;
  ```

- [ ] **Step 1: Write the failing unit tests for i18n**

Create `src/test/i18n.test.ts`:
```typescript
import test from "node:test";
import assert from "node:assert/strict";
import { resolveLocale, getTranslations, translateWindowTitle, formatResetText, formatResetDate } from "../shared/i18n";
import { enUS } from "../shared/i18n/en-US";
import { ptBR } from "../shared/i18n/pt-BR";

test("en-US and pt-BR dictionaries have identical keys", () => {
  const getKeys = (obj: any, prefix = ""): string[] => {
    return Object.keys(obj).flatMap((key) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return typeof obj[key] === "object" && obj[key] !== null
        ? getKeys(obj[key], path)
        : [path];
    });
  };
  const enKeys = getKeys(enUS).sort();
  const ptKeys = getKeys(ptBR).sort();
  assert.deepEqual(ptKeys, enKeys);
});

test("resolveLocale correctly handles user choices and system locales", () => {
  assert.equal(resolveLocale("en-US", "pt-BR"), "en-US");
  assert.equal(resolveLocale("pt-BR", "en-US"), "pt-BR");
  assert.equal(resolveLocale("system", "pt-BR"), "pt-BR");
  assert.equal(resolveLocale("system", "pt"), "pt-BR");
  assert.equal(resolveLocale("system", "pt-PT"), "pt-BR");
  assert.equal(resolveLocale("system", "en-US"), "en-US");
  assert.equal(resolveLocale("system", "fr-FR"), "en-US");
  assert.equal(resolveLocale("system", undefined), "en-US");
});

test("translateWindowTitle translates known window titles and falls back to original", () => {
  assert.equal(translateWindowTitle("Current session", "pt-BR"), "Sessão atual");
  assert.equal(translateWindowTitle("All models", "pt-BR"), "Todos os modelos");
  assert.equal(translateWindowTitle("5-hour Gemini", "pt-BR"), "Gemini (5 horas)");
  assert.equal(translateWindowTitle("Weekly Gemini", "pt-BR"), "Gemini semanal");
  assert.equal(translateWindowTitle("Cursor models", "pt-BR"), "Modelos Cursor");
  assert.equal(translateWindowTitle("API usage", "pt-BR"), "Uso de API");
  assert.equal(translateWindowTitle("This cycle", "pt-BR"), "Este ciclo");
  assert.equal(translateWindowTitle("Current session", "en-US"), "Current session");
  assert.equal(translateWindowTitle("Custom Window", "pt-BR"), "Custom Window");
});

test("formatResetText formats relative time in hours and minutes", () => {
  const now = new Date("2026-09-09T12:00:00Z").getTime();
  const resetIn2Hours = new Date("2026-09-09T14:15:00Z").toISOString();
  assert.equal(formatResetText(resetIn2Hours, "en-US", now), "Resets in 2 hr 15 min");
  assert.equal(formatResetText(resetIn2Hours, "pt-BR", now), "Reinicia em 2 h 15 min");

  const resetIn30Min = new Date("2026-09-09T12:30:00Z").toISOString();
  assert.equal(formatResetText(resetIn30Min, "en-US", now), "Resets in 30 min");
  assert.equal(formatResetText(resetIn30Min, "pt-BR", now), "Reinicia em 30 min");

  assert.equal(formatResetText(null, "en-US", now), "No reset data");
  assert.equal(formatResetText(null, "pt-BR", now), "Sem dados de reinício");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test dist/test/i18n.test.js`
Expected: FAIL because `src/shared/i18n` does not exist yet.

- [ ] **Step 3: Implement `types.ts`, `en-US.ts`, `pt-BR.ts`, and `index.ts`**

1. Create `src/shared/i18n/types.ts`: Define strict `TranslationDictionary` interface covering:
   - `common`: `enable`, `disable`, `setup`, `close`, `save`, `quit`, `uninstall`, `diagnose`, `reconnect`, `checking`, `installing`, `windows`, `wslDistro`.
   - `dashboard`: `title`, `refreshTooltip`, `settingsTooltip`, `loadingUsage`, `refreshingUsage`, `errorUsage`, `updatedAt`, `allWindowsHidden`.
   - `settings`:
     - `title`, `close`
     - `appSection`: `title`, `version`, `platform`, `dataPath`
     - `displaySection`: `title`, `showWidget`, `showTray`, `showAccountLabels`, `behavior`, `behaviorPinned`, `behaviorAutoHide`, `position`, `posRight`, `posLeft`, `posTop`, `posBottom`, `size`, `sizeSmall`, `sizeMedium`, `sizeLarge`, `monitor`, `activeDisplay`, `opacity`, `language`, `langSystem`, `langEn`, `langPt`
     - `refreshSection`: `title`, `usageEvery`, `minUnit`
     - `alertsSection`: `title`, `colorAlerts`, `caution`, `warning`, `critical`
     - `dataSourceSection`: `title`, `description`
     - `providersSection`: `title`, `useProvider`, `showWindow`, `diagnose`, `reconnect`, `lastUpdate`, `keepOneNotice`
     - `updatesSection`: `title`, `checkUpdates`, `checking`, `restartAndInstall`
     - `startupSection`: `title`, `launchesAtLogin`, `startsManually`
     - `dangerSection`: `uninstall`, `quitApp`
   - `sourceModal`: `title`, `description`
   - `card`: `percentUsed`, `waitingData`, `allWindowsHidden`, `noResetData`
   - `widget`: `hoverToOpen`
   - `tray`: `openDashboard`, `refresh`, `settings`, `restartAndInstall`, `checkForUpdates`, `quit`, `noUsageYet`, `updated`
   - `windowTitles`: mapping of known titles.

2. Create `src/shared/i18n/en-US.ts` with English strings.
3. Create `src/shared/i18n/pt-BR.ts` with Brazilian Portuguese strings.
4. Create `src/shared/i18n/index.ts` implementing `resolveLocale`, `getTranslations`, `translateWindowTitle`, `formatResetText`, `formatResetDate`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test dist/test/i18n.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/i18n src/test/i18n.test.ts
git commit -m "feat: add i18n dictionary and helpers for en-US and pt-BR"
```

---

### Task 3: Integrate i18n into Main Process (`src/main/index.ts`)

**Files:**
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `getTranslations`, `resolveLocale` from `src/shared/i18n`
- Produces: Localized Tray menu, localized Tray tooltips, localized widget context menu, and badges.

- [ ] **Step 1: Inspect `src/main/index.ts` references and prepare changes**

Lines to update in `src/main/index.ts`:
- Import `getTranslations`, `resolveLocale` from `../shared/i18n`.
- Helper function `currentLocale(): SupportedLocale` returning `resolveLocale(settings.load().locale, app.getLocale())`.
- In `buildTrayMenu(rows: UsageRow[])`:
  - `const t = getTranslations(currentLocale());`
  - Translate `"No usage data yet"` -> `t.tray.noUsageYet`
  - Translate `"Open dashboard"` -> `t.tray.openDashboard`
  - Translate `"Refresh"` -> `t.tray.refresh`
  - Translate `"Restart & install update"` -> `t.tray.restartAndInstall`
  - Translate `"Check for updates…"` -> `t.tray.checkForUpdates`
  - Translate `"Quit Metria Electron"` -> `t.tray.quit`
- In `updateTray(providers)`:
  - Formatter `Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit" })`
  - `t.tray.updated` in tooltip
- In `showWidgetMenu()`:
  - `const t = getTranslations(currentLocale());`
  - Labels: `t.tray.openDashboard`, `t.tray.refresh`, `t.tray.settings`, `t.tray.quit`
- In `badgeTemplate()`:
  - `const t = getTranslations(currentLocale());`
  - Labels: `t.tray.openDashboard`, `t.tray.refresh`
- In `broadcastSettings()`:
  - Call `updateTray(lastUsage);` and `updateBadges(lastUsage);` so that when `locale` changes, the tray updates immediately.

- [ ] **Step 2: Apply changes to `src/main/index.ts`**

- [ ] **Step 3: Run typecheck and test**

Run: `npm run typecheck && npm run test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: localize main process tray, menus, and tooltips"
```

---

### Task 4: Localize Dashboard and Settings Modal (`src/renderer/index.tsx`)

**Files:**
- Modify: `src/renderer/index.tsx`

**Interfaces:**
- Consumes: `getTranslations`, `resolveLocale`, `translateWindowTitle`, `formatResetDate` from `src/shared/i18n`
- Produces: Language selector UI in `SettingsModal`, translated Dashboard, ProviderCards, and WSL SourceChoiceModal.

- [ ] **Step 1: Implement `useI18n` in `src/renderer/index.tsx`**

```typescript
function useI18n() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => window.metria.getSettings() });
  const choice = settings.data?.locale ?? "system";
  const locale = resolveLocale(choice, typeof navigator !== "undefined" ? navigator.language : undefined);
  const t = getTranslations(locale);
  return {
    choice,
    locale,
    t,
    translateTitle: (title: string) => translateWindowTitle(title, locale)
  };
}
```

- [ ] **Step 2: Add Language Selector in `SettingsModal`**

Under section "App" or section "Display":
```tsx
<label className="grid gap-1 text-dim">
  {t.settings.displaySection.language}
  <select
    className="border border-line2 bg-surface px-2.5 py-1.5 text-fg"
    value={settingsData?.locale ?? "system"}
    onChange={(event) => setPreferences.mutate({ locale: event.target.value as LocaleChoice })}
  >
    <option value="system">{t.settings.displaySection.langSystem}</option>
    <option value="en-US">{t.settings.displaySection.langEn}</option>
    <option value="pt-BR">{t.settings.displaySection.langPt}</option>
  </select>
</label>
```

- [ ] **Step 3: Replace hardcoded strings in `src/renderer/index.tsx` with `t` and `translateTitle`**

- `UsageRow`: format reset date using `formatResetDate(row.resetDate, locale)`, render `translateTitle(row.title)`.
- `ProviderCard`: button labels `!enabled ? t.common.enable : provider.available ? t.common.disable : t.common.setup`, `t.dashboard.allWindowsHidden`.
- `SourceChoiceModal`: modal title `t.sourceModal.title`, description `t.sourceModal.description`.
- `SettingsModal`: headers, labels, update buttons, login button texts (`loginItem.data?.enabled ? t.settings.startupSection.launchesAtLogin : t.settings.startupSection.startsManually`).
- `Dashboard`: header `aria-label`s, status messages (`t.dashboard.loadingUsage`, `t.dashboard.refreshingUsage`, `t.dashboard.errorUsage`, formatted `t.dashboard.updatedAt`).

- [ ] **Step 4: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/renderer/index.tsx
git commit -m "feat: localize Dashboard and Settings modal with language selector"
```

---

### Task 5: Localize Notch Card (`src/renderer/card.tsx`) and Widget (`src/renderer/widget.tsx`)

**Files:**
- Modify: `src/renderer/card.tsx`
- Modify: `src/renderer/widget.tsx`

**Interfaces:**
- Consumes: `getTranslations`, `resolveLocale`, `translateWindowTitle`, `formatResetText` from `src/shared/i18n`
- Produces: Fully localized Notch Card and floating Widget.

- [ ] **Step 1: Update `src/renderer/card.tsx`**

- In `Card`:
  ```typescript
  const choice = settings.data?.locale ?? "system";
  const locale = resolveLocale(choice, typeof navigator !== "undefined" ? navigator.language : undefined);
  const t = getTranslations(locale);
  ```
- In `WindowRow`:
  - Pass `locale` and `t` to `WindowRow`.
  - Use `translateWindowTitle(row.title, locale)` for the row title.
  - Use `formatResetText(row.resetDate, locale)` instead of old English hardcoded `resetText`.
  - Display `${Math.round(percent)}% ${t.card.percentUsed}`.
- In empty/hidden states:
  - Display `t.card.waitingData` and `t.card.allWindowsHidden`.

- [ ] **Step 2: Update `src/renderer/widget.tsx`**

- In `Widget`:
  ```typescript
  const choice = settings.data?.locale ?? "system";
  const locale = resolveLocale(choice, typeof navigator !== "undefined" ? navigator.language : undefined);
  const t = getTranslations(locale);
  ```
- In `notch-hidden-hint`:
  - `aria-label={t.widget.hoverToOpen}`

- [ ] **Step 3: Run typecheck and build**

Run: `npm run typecheck && npm run build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/card.tsx src/renderer/widget.tsx
git commit -m "feat: localize Notch Card and floating Widget"
```

---

### Task 6: Full System Verification and Smoke Test

**Files:**
- None (verification across all touched files)

**Interfaces:**
- Consumes: All implementations from Tasks 1-5

- [ ] **Step 1: Run complete check suite**

Run: `npm run check`
Expected: All TypeScript typechecks pass, Vite builds the renderer chunks without warning or error, and all 90+ tests pass cleanly.

- [ ] **Step 2: Verify git status and diff**

Run: `git status`
Expected: Working tree clean, all changes tracked and committed.
