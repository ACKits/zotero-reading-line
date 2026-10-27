import { config } from "../../package.json";

export function getPref(key: string): any {
  return Zotero.Prefs.get(`${config.prefsPrefix}.${key}`, true);
}

export function setPref(key: string, value: any): void {
  Zotero.Prefs.set(`${config.prefsPrefix}.${key}`, value, true);
}

export function clearPref(key: string): void {
  Zotero.Prefs.clear(`${config.prefsPrefix}.${key}`, true);
}