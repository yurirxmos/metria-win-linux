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
