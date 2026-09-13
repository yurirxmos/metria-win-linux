import type { LocaleChoice, SupportedLocale } from "../types";
import type { TranslationDictionary } from "./types";
import { enUS } from "./en-US";
import { ptBR } from "./pt-BR";

export type { TranslationDictionary } from "./types";
export type { SupportedLocale, LocaleChoice } from "../types";
export { enUS } from "./en-US";
export { ptBR } from "./pt-BR";

export function resolveLocale(choice: LocaleChoice, systemLocale?: string): SupportedLocale {
  if (choice === "en-US" || choice === "pt-BR") {
    return choice;
  }
  if (systemLocale && systemLocale.toLowerCase().startsWith("pt")) {
    return "pt-BR";
  }
  return "en-US";
}

export function getTranslations(locale: SupportedLocale): TranslationDictionary {
  return locale === "pt-BR" ? ptBR : enUS;
}

export function translateWindowTitle(title: string, locale: SupportedLocale): string {
  const dictionary = getTranslations(locale);
  return dictionary.windowTitles[title] ?? title;
}

export function formatResetText(resetDate: string | null, locale: SupportedLocale, now: number = Date.now()): string {
  const dictionary = getTranslations(locale);
  if (!resetDate) {
    return dictionary.card.noResetData;
  }
  const targetTime = new Date(resetDate).getTime();
  if (Number.isNaN(targetTime)) {
    return dictionary.card.noResetData;
  }
  const seconds = (targetTime - now) / 1000;
  if (seconds > 0 && seconds < 86400) {
    const totalMinutes = Math.floor(seconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      if (locale === "pt-BR") {
        return minutes > 0 ? `Reinicia em ${hours} h ${minutes} min` : `Reinicia em ${hours} h`;
      }
      return minutes > 0 ? `Resets in ${hours} hr ${minutes} min` : `Resets in ${hours} hr`;
    }
    if (locale === "pt-BR") {
      return `Reinicia em ${minutes} min`;
    }
    return `Resets in ${minutes} min`;
  }
  const dateObj = new Date(resetDate);
  if (locale === "pt-BR") {
    return `Reinicia em ${dateObj.toLocaleString("pt-BR", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  }
  return `Resets ${dateObj.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

export function formatResetDate(resetDate: string | null, locale: SupportedLocale): string {
  if (!resetDate) {
    return locale === "pt-BR" ? "Sem horário de reinício" : "No reset time available";
  }
  const dateObj = new Date(resetDate);
  if (Number.isNaN(dateObj.getTime())) {
    return locale === "pt-BR" ? "Sem horário de reinício" : "No reset time available";
  }
  const formatted = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(dateObj);
  return locale === "pt-BR" ? `Reinicia em ${formatted}` : `Resets ${formatted}`;
}
