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

test("formatResetDate formats absolute date and handles null", () => {
  const dateStr = "2026-09-09T12:00:00.000Z";
  const enFormatted = formatResetDate(dateStr, "en-US");
  const ptFormatted = formatResetDate(dateStr, "pt-BR");
  assert.ok(enFormatted.startsWith("Resets "));
  assert.ok(ptFormatted.startsWith("Reinicia em "));
  assert.equal(formatResetDate(null, "en-US"), "No reset time available");
  assert.equal(formatResetDate(null, "pt-BR"), "Sem horário de reinício");
});

test("getTranslations returns correct dictionary", () => {
  assert.equal(getTranslations("en-US"), enUS);
  assert.equal(getTranslations("pt-BR"), ptBR);
});
