import { useCallback, useState, useSyncExternalStore } from "react";
import {
  parseThemePreference,
  resolveScheme,
  THEME_STORAGE_KEY,
  type ResolvedScheme,
  type ThemePreference,
} from "@/features/appearance/themePreference";

/**
 * Il tema della dashboard (2026-11-18): controparte web di
 * `src/providers/Theme.tsx`. La scelta sta in `localStorage` (preferenza del
 * computer, non dell'account) e si applica con `data-theme` su `<html>`, che
 * `index.css` legge prima di `prefers-color-scheme`.
 *
 * ⚠️ Lo script in `web/index.html` fa la stessa cosa prima del primo disegno,
 * con la stessa chiave: se cambia la chiave o la regola, cambiano insieme.
 */
export function loadWebTheme(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

export function applyWebTheme(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === "system") delete root.dataset.theme;
  else root.dataset.theme = preference;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeSystem(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const systemScheme = (): ResolvedScheme =>
  window.matchMedia(DARK_QUERY).matches ? "dark" : "light";

/** La scelta, lo schema che si vede adesso e come cambiarla. */
export function useWebTheme(): {
  preference: ThemePreference;
  scheme: ResolvedScheme;
  setPreference: (preference: ThemePreference) => void;
} {
  const [preference, setState] = useState<ThemePreference>(loadWebTheme);
  const system = useSyncExternalStore(subscribeSystem, systemScheme, () => "light" as const);

  const setPreference = useCallback((next: ThemePreference) => {
    setState(next);
    applyWebTheme(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Navigazione privata: vale per questa visita.
    }
  }, []);

  return { preference, scheme: resolveScheme(preference, system), setPreference };
}
