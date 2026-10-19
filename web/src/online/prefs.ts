import { useSyncExternalStore } from 'react';

// Small per-device settings of the online section.

export interface Prefs {
  /** Show the name of your made hand (Pair of Kings …) in Practice too. */
  handName: boolean;
  /** Play voice messages at the table as soon as they arrive. */
  autoplayVoice: boolean;
}

const KEY = 'poker-online-prefs';
const DEFAULTS: Prefs = { handName: true, autoplayVoice: true };
const listeners = new Set<() => void>();
let prefs = read();

function read(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return DEFAULTS;
  }
}

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* kept for this visit only */
  }
  for (const l of listeners) l();
}

export function getPrefs(): Prefs {
  return prefs;
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
