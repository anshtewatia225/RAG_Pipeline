"use client";

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const listeners = new Set<() => void>();
let cachedTheme: Theme = "dark";
let initialized = false;

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): Theme {
  if (!initialized && typeof window !== "undefined") {
    const saved = localStorage.getItem("theme") as Theme | null;
    cachedTheme =
      saved ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.classList.toggle("dark", cachedTheme === "dark");
    initialized = true;
  }
  return cachedTheme;
}

function setTheme(next: Theme) {
  cachedTheme = next;
  initialized = true;
  if (typeof window !== "undefined") {
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }
  emit();
}

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, (): Theme => "dark");
  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}
